#!/usr/bin/env bash
# Closes public HTTP/HTTPS access to the EC2 instance and allows port 80 only
# from CloudFront's origin-facing IP ranges (AWS-managed prefix list). Together
# with the X-Origin-Verify header check in nginx, all traffic must come through
# CloudFront, i.e. over HTTPS. SSH (your IP only) is left untouched.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/00-config.sh"

APP_SG_ID=$(cat "$STATE_DIR/app_sg_id" 2>/dev/null || echo "")
if [ -z "$APP_SG_ID" ]; then
  echo "Run 01-network.sh first." >&2
  exit 1
fi
if [ ! -f "$STATE_DIR/cloudfront_distribution_id" ]; then
  echo "Run 06-create-cloudfront.sh first - this would otherwise make the site unreachable." >&2
  exit 1
fi

PREFIX_LIST_ID=$(aws_cli ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query 'PrefixLists[0].PrefixListId' --output text)
echo "CloudFront origin-facing prefix list: $PREFIX_LIST_ID"

for PORT in 80 443; do
  aws_cli ec2 revoke-security-group-ingress --group-id "$APP_SG_ID" \
    --protocol tcp --port "$PORT" --cidr 0.0.0.0/0 >/dev/null 2>&1 \
    && echo "Removed public access on port $PORT" || true
done

aws_cli ec2 authorize-security-group-ingress --group-id "$APP_SG_ID" \
  --ip-permissions "IpProtocol=tcp,FromPort=80,ToPort=80,PrefixListIds=[{PrefixListId=$PREFIX_LIST_ID,Description=CloudFront}]" \
  >/dev/null 2>&1 && echo "Allowed port 80 from CloudFront only" || echo "CloudFront rule already present"

echo "Done. The site is now reachable only at https://$(cat "$STATE_DIR/cloudfront_domain")"
