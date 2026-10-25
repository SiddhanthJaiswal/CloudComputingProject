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

# Persist a JWT secret across redeploys instead of generating a new one each time.
JWT_SECRET_FILE="$STATE_DIR/jwt_secret"
if [ ! -f "$JWT_SECRET_FILE" ]; then
  openssl rand -hex 32 > "$JWT_SECRET_FILE"
fi
JWT_SECRET=$(cat "$JWT_SECRET_FILE")

CLOUDFRONT_DOMAIN=$(cat "$STATE_DIR/cloudfront_domain" 2>/dev/null || echo "")
ORIGIN_SECRET=$(cat "$STATE_DIR/origin_secret" 2>/dev/null || echo "")
if [ -z "$CLOUDFRONT_DOMAIN" ] || [ -z "$ORIGIN_SECRET" ]; then
  echo "Run 06-create-cloudfront.sh first: the app is only served over HTTPS via CloudFront." >&2
  exit 1
fi
CORS_ORIGINS="https://$CLOUDFRONT_DOMAIN"

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
sed "s/__ORIGIN_SECRET__/$ORIGIN_SECRET/" "$DEPLOY_DIR/nginx-parentpulse.conf" > "$BUILD_DIR/parentpulse.conf"

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
SESSION_IDLE_MINUTES=15
SESSION_MAX_HOURS=8
TRUST_PROXY_HOPS=2
CORS_ORIGINS=$CORS_ORIGINS
EOF

# SSH goes through the EC2 Instance Connect Endpoint (08-ssh-via-instance-connect.sh):
# no public SSH port, and it works from any network regardless of your IP.
INSTANCE_ID=$(cat "$STATE_DIR/instance_id")
if [ ! -f "$STATE_DIR/eice_id" ]; then
  echo "Run 08-ssh-via-instance-connect.sh first (SSH is only reachable through the endpoint)." >&2
  exit 1
fi
SSH_OPTS="-i $PEM_PATH -o StrictHostKeyChecking=accept-new -o ProxyCommand='aws ec2-instance-connect open-tunnel --instance-id $INSTANCE_ID --region $REGION --profile $AWS_PROFILE'"
ssh_cmd() { eval ssh "$SSH_OPTS" "$@"; }

echo "==> Waiting for SSH to be ready on $INSTANCE_ID..."
for i in $(seq 1 20); do
  if ssh_cmd "ec2-user@$INSTANCE_ID" "'echo ok'" >/dev/null 2>&1; then break; fi
  sleep 5
done

echo "==> Uploading application files..."
# One tar stream into a staging dir (scp over the Instance Connect tunnel can
# hang). Nothing live is touched until the upload has fully arrived.
cp "$DEPLOY_DIR/nginx-security-headers.conf" "$BUILD_DIR/parentpulse-security-headers.conf"
tar -C "$BUILD_DIR" -cf - backend frontend parentpulse.conf parentpulse-security-headers.conf   | ssh_cmd "ec2-user@$INSTANCE_ID" "'rm -rf /tmp/ppdeploy && mkdir -p /tmp/ppdeploy && tar -C /tmp/ppdeploy -xf -'"

echo "==> Installing dependencies, creating DynamoDB tables, and starting the app on the server..."
ssh_cmd "ec2-user@$INSTANCE_ID" bash -s <<'REMOTE'
set -euo pipefail
STAGE=/tmp/ppdeploy
test -f "$STAGE/frontend/dist/index.html" && test -f "$STAGE/backend/src/index.js"

# Swap code into place (node_modules is kept and updated below).
rm -rf /opt/parentpulse/backend/src /opt/parentpulse/frontend/dist
cp -r "$STAGE/backend/." /opt/parentpulse/backend/
cp -r "$STAGE/frontend/." /opt/parentpulse/frontend/

cd /opt/parentpulse/backend
chmod 600 .env
npm install --omit=dev --no-audit --no-fund
node src/db/init.js
node src/db/seed.js || true

sudo cp "$STAGE/parentpulse-security-headers.conf" /etc/nginx/parentpulse-security-headers.conf
sudo install -m 640 -o root -g nginx "$STAGE/parentpulse.conf" /etc/nginx/conf.d/parentpulse.conf
rm -rf "$STAGE"
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
echo "App URL: https://$CLOUDFRONT_DOMAIN"
