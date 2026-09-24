#!/usr/bin/env bash
# Creates the app-server security group (EC2) in the default VPC. There is no
# database security group - DynamoDB is a managed service reached over the
# public AWS API endpoint, secured by IAM (see 03-create-dynamodb-role.sh),
# not by network placement.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/00-config.sh"

VPC_ID=$(aws_cli ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
if [ "$VPC_ID" == "None" ] || [ -z "$VPC_ID" ]; then
  echo "No default VPC found. You'll need to create/specify a VPC manually." >&2
  exit 1
fi
echo "Default VPC: $VPC_ID"
echo "$VPC_ID" > "$STATE_DIR/vpc_id"

MY_IP=$(curl -s https://checkip.amazonaws.com)/32
echo "Your current public IP (used to restrict SSH): $MY_IP"

# --- App security group (EC2): SSH from your IP, HTTP from anywhere ---
APP_SG_ID=$(aws_cli ec2 describe-security-groups \
  --filters Name=group-name,Values="$APP_SG_NAME" Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")

if [ "$APP_SG_ID" == "None" ] || [ -z "$APP_SG_ID" ]; then
  APP_SG_ID=$(aws_cli ec2 create-security-group \
    --group-name "$APP_SG_NAME" \
    --description "ParentPulse app server (EC2)" \
    --vpc-id "$VPC_ID" \
    --query 'GroupId' --output text)
  aws_cli ec2 authorize-security-group-ingress --group-id "$APP_SG_ID" \
    --protocol tcp --port 22 --cidr "$MY_IP"
  aws_cli ec2 authorize-security-group-ingress --group-id "$APP_SG_ID" \
    --protocol tcp --port 80 --cidr 0.0.0.0/0
  aws_cli ec2 authorize-security-group-ingress --group-id "$APP_SG_ID" \
    --protocol tcp --port 443 --cidr 0.0.0.0/0
  echo "Created app security group: $APP_SG_ID"
else
  echo "App security group already exists: $APP_SG_ID"
fi
echo "$APP_SG_ID" > "$STATE_DIR/app_sg_id"

echo "Network setup complete."
