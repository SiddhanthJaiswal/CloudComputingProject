#!/usr/bin/env bash
# Tears down the EC2 instance, IAM role/instance profile, security group, and
# key pair. Run this when you're done to avoid ongoing charges on your
# friend's AWS account.
#
# DynamoDB tables are deliberately NOT deleted here: on-demand (PAY_PER_REQUEST)
# billing means idle tables cost nothing, unlike EC2/RDS which bill per hour
# whether used or not. If you want to delete the data too, see the end of this
# script's output for the command.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/00-config.sh"

echo "This will PERMANENTLY delete the ParentPulse EC2 instance, CloudFront distribution,"
echo "IAM role/instance profile, security group and key pair under AWS profile '$AWS_PROFILE' in region '$REGION'."
read -r -p "Type 'destroy' to confirm: " CONFIRM
if [ "$CONFIRM" != "destroy" ]; then
  echo "Aborted."
  exit 1
fi

DIST_ID=$(cat "$STATE_DIR/cloudfront_distribution_id" 2>/dev/null || echo "")
if [ -n "$DIST_ID" ]; then
  echo "Disabling CloudFront distribution $DIST_ID (required before it can be deleted)..."
  GET_OUTPUT=$(aws_cli cloudfront get-distribution-config --id "$DIST_ID")
  ETAG=$(echo "$GET_OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).ETag))")
  DISABLED_CONFIG=$(echo "$GET_OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const c=JSON.parse(d).DistributionConfig;c.Enabled=false;console.log(JSON.stringify(c))})")
  aws_cli cloudfront update-distribution --id "$DIST_ID" --distribution-config "$DISABLED_CONFIG" --if-match "$ETAG" >/dev/null
  echo "Waiting for the disable to finish deploying (this can take several minutes)..."
  aws_cli cloudfront wait distribution-deployed --id "$DIST_ID"
  NEW_ETAG=$(aws_cli cloudfront get-distribution-config --id "$DIST_ID" --query ETag --output text)
  aws_cli cloudfront delete-distribution --id "$DIST_ID" --if-match "$NEW_ETAG"
  echo "Deleted CloudFront distribution: $DIST_ID"
fi

INSTANCE_ID=$(cat "$STATE_DIR/instance_id" 2>/dev/null || echo "")
if [ -n "$INSTANCE_ID" ]; then
  echo "Terminating EC2 instance $INSTANCE_ID..."
  aws_cli ec2 terminate-instances --instance-ids "$INSTANCE_ID" >/dev/null
  aws_cli ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
fi

ROLE_NAME=$(cat "$STATE_DIR/iam_role_name" 2>/dev/null || echo "${PROJECT_NAME}-ec2-role")
PROFILE_NAME=$(cat "$STATE_DIR/iam_profile_name" 2>/dev/null || echo "${PROJECT_NAME}-ec2-profile")

if aws_cli iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  aws_cli iam remove-role-from-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME" 2>/dev/null || true
  aws_cli iam delete-instance-profile --instance-profile-name "$PROFILE_NAME" 2>/dev/null || true
  echo "Deleted IAM instance profile: $PROFILE_NAME"
fi

if aws_cli iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws_cli iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "${PROJECT_NAME}-dynamodb-access" 2>/dev/null || true
  aws_cli iam delete-role --role-name "$ROLE_NAME" 2>/dev/null || true
  echo "Deleted IAM role: $ROLE_NAME"
fi

APP_SG_ID=$(cat "$STATE_DIR/app_sg_id" 2>/dev/null || echo "")
[ -n "$APP_SG_ID" ] && aws_cli ec2 delete-security-group --group-id "$APP_SG_ID" 2>/dev/null || true

aws_cli ec2 delete-key-pair --key-name "$KEY_NAME" 2>/dev/null || true

rm -f "$STATE_DIR"/instance_id "$STATE_DIR"/public_ip "$STATE_DIR"/app_sg_id "$STATE_DIR"/vpc_id \
      "$STATE_DIR"/iam_role_name "$STATE_DIR"/iam_profile_name \
      "$STATE_DIR"/cloudfront_distribution_id "$STATE_DIR"/cloudfront_domain

echo ""
echo "EC2/CloudFront/IAM/network resources removed."
echo ""
echo "DynamoDB tables were left in place (they cost nothing while idle). To delete"
echo "them too, run for each table name ('parentpulse_<entity>_prod' or '_dev'):"
echo "  aws dynamodb delete-table --table-name <name> --profile $AWS_PROFILE --region $REGION"
