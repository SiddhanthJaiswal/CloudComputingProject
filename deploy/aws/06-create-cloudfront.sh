#!/usr/bin/env bash
# Creates a CloudFront distribution in front of the EC2 instance:
#   - HTTPS to viewers via CloudFront's default *.cloudfront.net certificate
#     (no cert to manage - EC2 itself stays plain HTTP, CloudFront terminates TLS)
#   - /api/* forwarded uncached with all headers/methods (auth, JSON bodies, etc.)
#   - everything else cached (static frontend assets), invalidated on each
#     deploy by 05-deploy-app.sh so redeploys show up immediately
#
# CloudFront is a global service billed per-request/data-transfer with a
# generous free tier - unlike EC2/RDS it has no idle hourly cost, so there's
# nothing to "forget to turn off" between sessions.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/00-config.sh"

INSTANCE_ID=$(cat "$STATE_DIR/instance_id" 2>/dev/null || echo "")
if [ -z "$INSTANCE_ID" ]; then
  echo "No instance_id found in $STATE_DIR. Run 04-create-ec2.sh first." >&2
  exit 1
fi

EXISTING_ID=$(cat "$STATE_DIR/cloudfront_distribution_id" 2>/dev/null || echo "")

if [ -n "$EXISTING_ID" ]; then
  echo "CloudFront distribution already exists: $EXISTING_ID"
else
  EC2_DNS=$(aws_cli ec2 describe-instances --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].PublicDnsName' --output text)
  if [ -z "$EC2_DNS" ] || [ "$EC2_DNS" == "None" ]; then
    echo "Could not resolve the EC2 instance's public DNS name." >&2
    exit 1
  fi
  echo "Origin: $EC2_DNS"

  echo "Looking up AWS managed cache/origin-request policy IDs..."
  CACHE_DISABLED=$(aws_cli cloudfront list-cache-policies --type managed \
    --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='Managed-CachingDisabled'].CachePolicy.Id | [0]" --output text)
  CACHE_OPTIMIZED=$(aws_cli cloudfront list-cache-policies --type managed \
    --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='Managed-CachingOptimized'].CachePolicy.Id | [0]" --output text)
  ORIGIN_ALLVIEWER=$(aws_cli cloudfront list-origin-request-policies --type managed \
    --query "OriginRequestPolicyList.Items[?OriginRequestPolicy.OriginRequestPolicyConfig.Name=='Managed-AllViewer'].OriginRequestPolicy.Id | [0]" --output text)

  if [ -z "$CACHE_DISABLED" ] || [ -z "$CACHE_OPTIMIZED" ] || [ -z "$ORIGIN_ALLVIEWER" ]; then
    echo "Could not resolve one or more AWS managed CloudFront policy IDs." >&2
    exit 1
  fi

  CALLER_REF="${PROJECT_NAME}-$(date +%s)"

  CONFIG=$(cat <<JSON
{
  "CallerReference": "$CALLER_REF",
  "Comment": "ParentPulse",
  "Enabled": true,
  "PriceClass": "PriceClass_100",
  "HttpVersion": "http2",
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "ec2-origin",
      "DomainName": "$EC2_DNS",
      "CustomOriginConfig": {
        "HTTPPort": 80,
        "HTTPSPort": 443,
        "OriginProtocolPolicy": "http-only",
        "OriginSslProtocols": { "Quantity": 1, "Items": ["TLSv1.2"] },
        "OriginReadTimeout": 30,
        "OriginKeepaliveTimeout": 5
      }
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "ec2-origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 7,
      "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
    },
    "CachePolicyId": "$CACHE_OPTIMIZED",
    "Compress": true
  },
  "CacheBehaviors": {
    "Quantity": 1,
    "Items": [{
      "PathPattern": "/api/*",
      "TargetOriginId": "ec2-origin",
      "ViewerProtocolPolicy": "redirect-to-https",
      "AllowedMethods": {
        "Quantity": 7,
        "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
        "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
      },
      "CachePolicyId": "$CACHE_DISABLED",
      "OriginRequestPolicyId": "$ORIGIN_ALLVIEWER",
      "Compress": true
    }]
  }
}
JSON
)

  echo "Creating CloudFront distribution..."
  CREATE_OUTPUT=$(aws_cli cloudfront create-distribution --distribution-config "$CONFIG")
  DIST_ID=$(echo "$CREATE_OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).Distribution.Id))")
  DIST_DOMAIN=$(echo "$CREATE_OUTPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).Distribution.DomainName))")

  echo "$DIST_ID" > "$STATE_DIR/cloudfront_distribution_id"
  echo "$DIST_DOMAIN" > "$STATE_DIR/cloudfront_domain"
  echo "Created distribution: $DIST_ID"
  echo "Domain: $DIST_DOMAIN"
fi

DIST_ID=$(cat "$STATE_DIR/cloudfront_distribution_id")
DIST_DOMAIN=$(cat "$STATE_DIR/cloudfront_domain")

echo "Waiting for the distribution to finish deploying (this typically takes 5-15 minutes)..."
aws_cli cloudfront wait distribution-deployed --id "$DIST_ID"

echo ""
echo "CloudFront distribution is live."
echo "  Distribution ID: $DIST_ID"
echo "  URL: https://$DIST_DOMAIN"
echo ""
echo "Next: re-run 05-deploy-app.sh so the backend's CORS_ORIGINS includes this domain."
