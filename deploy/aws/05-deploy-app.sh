#!/usr/bin/env bash
# Builds the frontend, packages the backend, ships both to the EC2 instance over SSH,
# installs dependencies, creates/verifies the DynamoDB tables, seeds demo data,
# and (re)starts the app. DynamoDB access on the server comes from the IAM
# instance profile (see 03-create-dynamodb-role.sh) - no database credentials
# are ever written to disk.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/00-config.sh"

PUBLIC_IP=$(cat "$STATE_DIR/public_ip" 2>/dev/null || echo "")
PEM_PATH="$STATE_DIR/${KEY_NAME}.pem"

if [ -z "$PUBLIC_IP" ]; then
  echo "Missing public_ip in $STATE_DIR. Run 04-create-ec2.sh first." >&2
  exit 1
fi

if [ ! -f "$STATE_DIR/iam_profile_name" ]; then
  echo "No IAM instance profile recorded. Run 03-create-dynamodb-role.sh before deploying," >&2
  echo "otherwise the app on EC2 won't be able to reach DynamoDB." >&2
  exit 1
fi

# Home/mobile ISPs commonly rotate the public IP between a small pool of
# addresses, which silently locks SSH out (the security group only allows the
# IP it was last set to). Refresh it to the current IP before every deploy so
# this doesn't have to be fixed by hand each time.
APP_SG_ID=$(cat "$STATE_DIR/app_sg_id" 2>/dev/null || echo "")
if [ -n "$APP_SG_ID" ]; then
  CURRENT_IP=$(curl -s https://checkip.amazonaws.com)/32
  EXISTING_SSH_CIDR=$(aws_cli ec2 describe-security-groups --group-ids "$APP_SG_ID" \
    --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[0].CidrIp' --output text 2>/dev/null || echo "")
  if [ -n "$CURRENT_IP" ] && [ "$CURRENT_IP" != "$EXISTING_SSH_CIDR" ]; then
    echo "==> Your public IP changed ($EXISTING_SSH_CIDR -> $CURRENT_IP) - updating the SSH security group rule..."
    [ -n "$EXISTING_SSH_CIDR" ] && aws_cli ec2 revoke-security-group-ingress --group-id "$APP_SG_ID" \
      --protocol tcp --port 22 --cidr "$EXISTING_SSH_CIDR" >/dev/null 2>&1 || true
    aws_cli ec2 authorize-security-group-ingress --group-id "$APP_SG_ID" \
      --protocol tcp --port 22 --cidr "$CURRENT_IP" >/dev/null
  fi
fi

# Persist a JWT secret across redeploys instead of generating a new one each time.
JWT_SECRET_FILE="$STATE_DIR/jwt_secret"
if [ ! -f "$JWT_SECRET_FILE" ]; then
  openssl rand -hex 32 > "$JWT_SECRET_FILE"
fi
JWT_SECRET=$(cat "$JWT_SECRET_FILE")

CLOUDFRONT_DOMAIN=$(cat "$STATE_DIR/cloudfront_domain" 2>/dev/null || echo "")
CORS_ORIGINS="http://$PUBLIC_IP"
if [ -n "$CLOUDFRONT_DOMAIN" ]; then
  CORS_ORIGINS="$CORS_ORIGINS,https://$CLOUDFRONT_DOMAIN"
fi

ROOT_DIR="$(cd "$DEPLOY_DIR/../.." && pwd)"
BUILD_DIR="$STATE_DIR/build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/backend" "$BUILD_DIR/frontend"

echo "==> Building frontend..."
(
  cd "$ROOT_DIR/frontend"
  # Deliberately NOT setting VITE_API_URL here: Git Bash/MSYS2 on Windows
  # silently rewrites env values that look like absolute Unix paths (e.g. "/api")
  # into a Windows path (e.g. "C:/Program Files/Git/api") before npm/node ever
  # see it, corrupting the build. frontend/src/api/client.js already falls back
  # to '/api' when VITE_API_URL is unset, so just leave it unset.
  npm run build
)
cp -r "$ROOT_DIR/frontend/dist" "$BUILD_DIR/frontend/dist"

echo "==> Packaging backend (excluding node_modules)..."
cp -r "$ROOT_DIR/backend/src" "$BUILD_DIR/backend/src"
cp "$ROOT_DIR/backend/package.json" "$BUILD_DIR/backend/package.json"
[ -f "$ROOT_DIR/backend/package-lock.json" ] && cp "$ROOT_DIR/backend/package-lock.json" "$BUILD_DIR/backend/package-lock.json"

cat > "$BUILD_DIR/backend/.env" <<EOF
PORT=4000
NODE_ENV=production
AWS_REGION=$REGION
TABLE_ENV=$TABLE_ENV
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=8h
CORS_ORIGINS=$CORS_ORIGINS
EOF

SSH_OPTS="-i $PEM_PATH -o StrictHostKeyChecking=accept-new"

echo "==> Waiting for SSH to be ready on $PUBLIC_IP..."
for i in $(seq 1 20); do
  if ssh $SSH_OPTS "ec2-user@$PUBLIC_IP" 'echo ok' >/dev/null 2>&1; then break; fi
  sleep 5
done

echo "==> Uploading application files..."
ssh $SSH_OPTS "ec2-user@$PUBLIC_IP" 'rm -rf /opt/parentpulse/backend/src /opt/parentpulse/frontend/dist'
scp -r $SSH_OPTS "$BUILD_DIR/backend/." "ec2-user@$PUBLIC_IP:/opt/parentpulse/backend/"
scp -r $SSH_OPTS "$BUILD_DIR/frontend/." "ec2-user@$PUBLIC_IP:/opt/parentpulse/frontend/"
scp $SSH_OPTS "$DEPLOY_DIR/nginx-parentpulse.conf" "ec2-user@$PUBLIC_IP:/tmp/parentpulse.conf"

echo "==> Installing dependencies, creating DynamoDB tables, and starting the app on the server..."
ssh $SSH_OPTS "ec2-user@$PUBLIC_IP" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/parentpulse/backend
npm install --omit=dev
node src/db/init.js
node src/db/seed.js || true

sudo cp /tmp/parentpulse.conf /etc/nginx/conf.d/parentpulse.conf
sudo nginx -t
sudo systemctl reload nginx

pm2 delete parentpulse-api >/dev/null 2>&1 || true
pm2 start src/index.js --name parentpulse-api
pm2 save
pm2 startup systemd -u ec2-user --hp /home/ec2-user | tail -1 | sudo bash || true
REMOTE

DIST_ID=$(cat "$STATE_DIR/cloudfront_distribution_id" 2>/dev/null || echo "")
if [ -n "$DIST_ID" ]; then
  echo "==> Invalidating CloudFront cache so this deploy shows up immediately..."
  aws_cli cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
fi

echo ""
echo "Deployment complete."
echo "App URL: http://$PUBLIC_IP"
if [ -n "$CLOUDFRONT_DOMAIN" ]; then
  echo "CDN URL (HTTPS): https://$CLOUDFRONT_DOMAIN"
fi
echo "Demo logins: admin@parentpulse.local / Admin@123 (see backend/src/db/seed.js for the rest)"
