#!/usr/bin/env bash
# Launches the EC2 instance that will run the ParentPulse API + frontend.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/00-config.sh"

APP_SG_ID=$(cat "$STATE_DIR/app_sg_id" 2>/dev/null || echo "")
VPC_ID=$(cat "$STATE_DIR/vpc_id" 2>/dev/null || echo "")
if [ -z "$APP_SG_ID" ] || [ -z "$VPC_ID" ]; then
  echo "Run 01-network.sh first." >&2
  exit 1
fi

EXISTING=$(aws_cli ec2 describe-instances \
  --filters "Name=tag:Name,Values=$EC2_INSTANCE_NAME" "Name=instance-state-name,Values=pending,running,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo "None")

if [ "$EXISTING" != "None" ] && [ -n "$EXISTING" ]; then
  echo "Instance already exists: $EXISTING"
  echo "$EXISTING" > "$STATE_DIR/instance_id"
else
  # Latest Amazon Linux 2023 AMI (queried directly rather than via the SSM public
  # parameter alias, which isn't resolvable in every account/region).
  AMI_ID=$(aws_cli ec2 describe-images \
    --owners amazon \
    --filters "Name=name,Values=al2023-ami-2023.*-x86_64" "Name=state,Values=available" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)

  SUBNET_ID=$(aws_cli ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=default-for-az,Values=true" \
    --query 'Subnets[0].SubnetId' --output text)

  # If 03-create-dynamodb-role.sh already ran, attach its instance profile at
  # launch so the app has DynamoDB access from the first boot. Otherwise, run
  # 03-create-dynamodb-role.sh again afterward to associate it retroactively.
  IAM_PROFILE_NAME=$(cat "$STATE_DIR/iam_profile_name" 2>/dev/null || echo "")
  IAM_ARGS=()
  if [ -n "$IAM_PROFILE_NAME" ]; then
    IAM_ARGS=(--iam-instance-profile "Name=$IAM_PROFILE_NAME")
  fi

  echo "Launching EC2 instance ($EC2_INSTANCE_TYPE, AMI $AMI_ID)..."
  # Pass user-data as literal text rather than file:// - the AWS CLI is a native
  # Windows executable here and can't resolve Git Bash's /c/... style paths.
  USER_DATA_CONTENT=$(cat "$DEPLOY_DIR/ec2-userdata.sh")
  INSTANCE_ID=$(aws_cli ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$EC2_INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$APP_SG_ID" \
    --subnet-id "$SUBNET_ID" \
    --associate-public-ip-address \
    --user-data "$USER_DATA_CONTENT" \
    "${IAM_ARGS[@]}" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$EC2_INSTANCE_NAME}]" \
    --query 'Instances[0].InstanceId' --output text)

  echo "$INSTANCE_ID" > "$STATE_DIR/instance_id"
  echo "Launched instance: $INSTANCE_ID"
  if [ -z "$IAM_PROFILE_NAME" ]; then
    echo "No IAM instance profile yet - run 03-create-dynamodb-role.sh next to grant DynamoDB access."
  fi
fi

INSTANCE_ID=$(cat "$STATE_DIR/instance_id")
echo "Waiting for instance to be running..."
aws_cli ec2 wait instance-running --instance-ids "$INSTANCE_ID"

PUBLIC_IP=$(aws_cli ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "$PUBLIC_IP" > "$STATE_DIR/public_ip"

echo "Instance is running."
echo "  Instance ID: $INSTANCE_ID"
echo "  Public IP:   $PUBLIC_IP"
echo ""
echo "Bootstrap (installing Node/nginx/pm2) runs automatically via user-data and takes ~1-2 minutes."
echo "Next: run 05-deploy-app.sh to upload and start the application."
