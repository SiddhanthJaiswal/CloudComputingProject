#!/usr/bin/env bash
# Moves SSH off the public internet: creates an EC2 Instance Connect Endpoint
# in the VPC, allows port 22 only from that endpoint, and removes the
# "SSH from my IP" rule. SSH then tunnels through the AWS API (authorised by
# your AWS credentials + the key pair), so it works from any network - even
# ones whose public IP keeps changing - with no open SSH port.
# 05-deploy-app.sh switches to the tunnel automatically once this has run.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/00-config.sh"

APP_SG_ID=$(cat "$STATE_DIR/app_sg_id")
VPC_ID=$(cat "$STATE_DIR/vpc_id")
INSTANCE_ID=$(cat "$STATE_DIR/instance_id")
EICE_SG_NAME="${PROJECT_NAME}-eice-sg"

EICE_SG_ID=$(aws_cli ec2 describe-security-groups \
  --filters Name=group-name,Values="$EICE_SG_NAME" Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")
if [ "$EICE_SG_ID" == "None" ] || [ -z "$EICE_SG_ID" ]; then
  EICE_SG_ID=$(aws_cli ec2 create-security-group --group-name "$EICE_SG_NAME" \
    --description "ParentPulse EC2 Instance Connect Endpoint" --vpc-id "$VPC_ID" \
    --query 'GroupId' --output text)
  # Replace the default allow-all egress with SSH to the app server only.
  aws_cli ec2 revoke-security-group-egress --group-id "$EICE_SG_ID" \
    --ip-permissions 'IpProtocol=-1,IpRanges=[{CidrIp=0.0.0.0/0}]' >/dev/null
  aws_cli ec2 authorize-security-group-egress --group-id "$EICE_SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,UserIdGroupPairs=[{GroupId=$APP_SG_ID}]" >/dev/null
  echo "Created endpoint security group: $EICE_SG_ID"
fi
echo "$EICE_SG_ID" > "$STATE_DIR/eice_sg_id"

EICE_ID=$(aws_cli ec2 describe-instance-connect-endpoints \
  --filters Name=vpc-id,Values="$VPC_ID" \
  --query 'InstanceConnectEndpoints[?State!=`delete-complete`]|[0].InstanceConnectEndpointId' --output text 2>/dev/null || echo "None")
if [ "$EICE_ID" == "None" ] || [ -z "$EICE_ID" ]; then
  SUBNET_ID=$(aws_cli ec2 describe-instances --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].SubnetId' --output text)
  EICE_ID=$(aws_cli ec2 create-instance-connect-endpoint --subnet-id "$SUBNET_ID" \
    --security-group-ids "$EICE_SG_ID" --no-preserve-client-ip \
    --query 'InstanceConnectEndpoint.InstanceConnectEndpointId' --output text)
  echo "Creating Instance Connect Endpoint $EICE_ID (takes a few minutes)..."
fi
echo "$EICE_ID" > "$STATE_DIR/eice_id"

until [ "$(aws_cli ec2 describe-instance-connect-endpoints --instance-connect-endpoint-ids "$EICE_ID" \
  --query 'InstanceConnectEndpoints[0].State' --output text)" == "create-complete" ]; do
  sleep 15
done
echo "Endpoint ready: $EICE_ID"

aws_cli ec2 authorize-security-group-ingress --group-id "$APP_SG_ID" \
  --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,UserIdGroupPairs=[{GroupId=$EICE_SG_ID,Description=InstanceConnectEndpoint}]" \
  >/dev/null 2>&1 && echo "Allowed SSH from the endpoint" || echo "Endpoint SSH rule already present"

for CIDR in $(aws_cli ec2 describe-security-groups --group-ids "$APP_SG_ID" \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp' --output text); do
  aws_cli ec2 revoke-security-group-ingress --group-id "$APP_SG_ID" --protocol tcp --port 22 --cidr "$CIDR" >/dev/null
  echo "Removed public SSH rule for $CIDR"
done

echo ""
echo "Done. Connect with:"
echo "  ssh -i $STATE_DIR/${KEY_NAME}.pem -o ProxyCommand='aws ec2-instance-connect open-tunnel --instance-id $INSTANCE_ID --region $REGION --profile $AWS_PROFILE' ec2-user@$INSTANCE_ID"
