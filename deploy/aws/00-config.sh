#!/usr/bin/env bash
# Central configuration for all deploy/aws/*.sh scripts.
# Override any of these by exporting them before running a script, e.g.:
#   AWS_PROFILE=friend REGION=us-east-1 ./01-network.sh

set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-default}"
export REGION="${REGION:-ap-south-1}"

export PROJECT_NAME="parentpulse"
export KEY_NAME="${PROJECT_NAME}-key"
export APP_SG_NAME="${PROJECT_NAME}-app-sg"

export EC2_INSTANCE_TYPE="${EC2_INSTANCE_TYPE:-t3.micro}"
export EC2_INSTANCE_NAME="${PROJECT_NAME}-app"

# DynamoDB table suffix for the deployed app (kept separate from local dev's
# TABLE_ENV=dev tables, which point at the same tables regardless of region -
# DynamoDB table names are already scoped by region+account, no extra config needed).
export TABLE_ENV="${TABLE_ENV:-prod}"

# Directory this file lives in, and where generated state (ids, endpoints) is cached.
export DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export STATE_DIR="$DEPLOY_DIR/.state"
mkdir -p "$STATE_DIR"

aws_cli() {
  aws --profile "$AWS_PROFILE" --region "$REGION" "$@"
}

echo "Using AWS profile: $AWS_PROFILE   region: $REGION" >&2
