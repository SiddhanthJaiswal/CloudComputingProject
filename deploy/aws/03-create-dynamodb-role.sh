#!/usr/bin/env bash
# Creates an IAM role + instance profile granting the EC2 instance access to the
# ParentPulse DynamoDB tables, and attaches it to the running instance. This is
# how the Node app on EC2 authenticates to DynamoDB - no access keys stored on
# the server at all; the AWS SDK picks up temporary credentials automatically
# from the instance's metadata service.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/00-config.sh"

ROLE_NAME="${PROJECT_NAME}-ec2-role"
PROFILE_NAME="${PROJECT_NAME}-ec2-profile"
POLICY_NAME="${PROJECT_NAME}-dynamodb-access"

ACCOUNT_ID=$(aws_cli sts get-caller-identity --query Account --output text)

TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ec2.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}'

# Scoped to just this project's tables (both dev and prod suffixes) and their indexes.
ACCESS_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
      "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem",
      "dynamodb:CreateTable", "dynamodb:DescribeTable"
    ],
    "Resource": [
      "arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/${PROJECT_NAME}_*",
      "arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/${PROJECT_NAME}_*/index/*"
    ]
  }]
}
EOF
)

if aws_cli iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "IAM role already exists: $ROLE_NAME"
else
  aws_cli iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "$TRUST_POLICY" >/dev/null
  echo "Created IAM role: $ROLE_NAME"
fi

aws_cli iam put-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --policy-document "$ACCESS_POLICY"
echo "Attached DynamoDB access policy to role."

if aws_cli iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  echo "Instance profile already exists: $PROFILE_NAME"
else
  aws_cli iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  aws_cli iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME"
  echo "Created instance profile: $PROFILE_NAME"
  echo "Waiting for IAM propagation..."
  sleep 10
fi

INSTANCE_ID=$(cat "$STATE_DIR/instance_id" 2>/dev/null || echo "")
if [ -z "$INSTANCE_ID" ]; then
  echo "No instance_id found in $STATE_DIR - run 04-create-ec2.sh first, or associate the profile manually later."
  exit 0
fi

EXISTING_ASSOC=$(aws_cli ec2 describe-iam-instance-profile-associations \
  --filters "Name=instance-id,Values=$INSTANCE_ID" "Name=state,Values=associated" \
  --query 'IamInstanceProfileAssociations[0].AssociationId' --output text 2>/dev/null || echo "None")

if [ "$EXISTING_ASSOC" != "None" ] && [ -n "$EXISTING_ASSOC" ]; then
  echo "Instance profile already associated with $INSTANCE_ID (association $EXISTING_ASSOC)."
else
  aws_cli ec2 associate-iam-instance-profile \
    --instance-id "$INSTANCE_ID" \
    --iam-instance-profile Name="$PROFILE_NAME" >/dev/null
  echo "Associated instance profile $PROFILE_NAME with instance $INSTANCE_ID."
fi

echo "$ROLE_NAME" > "$STATE_DIR/iam_role_name"
echo "$PROFILE_NAME" > "$STATE_DIR/iam_profile_name"
echo "Done. The EC2 instance can now access DynamoDB tables prefixed '${PROJECT_NAME}_' without any access keys."
