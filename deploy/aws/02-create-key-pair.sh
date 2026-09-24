#!/usr/bin/env bash
# Creates an EC2 key pair and saves the private key locally (never committed to git).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/00-config.sh"

PEM_PATH="$STATE_DIR/${KEY_NAME}.pem"

EXISTING=$(aws_cli ec2 describe-key-pairs --key-names "$KEY_NAME" --query 'KeyPairs[0].KeyName' --output text 2>/dev/null || echo "None")

if [ "$EXISTING" == "$KEY_NAME" ]; then
  echo "Key pair '$KEY_NAME' already exists in AWS."
  if [ ! -f "$PEM_PATH" ]; then
    echo "WARNING: local private key file is missing ($PEM_PATH)." >&2
    echo "AWS does not let you re-download a private key. Delete the key pair in AWS and re-run this script if you've lost it." >&2
  fi
  exit 0
fi

aws_cli ec2 create-key-pair --key-name "$KEY_NAME" --query 'KeyMaterial' --output text > "$PEM_PATH"
chmod 400 "$PEM_PATH"
echo "Created key pair '$KEY_NAME'. Private key saved to: $PEM_PATH"
echo "Keep this file safe - it is required to SSH into the EC2 instance."
