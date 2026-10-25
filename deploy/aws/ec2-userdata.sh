#!/bin/bash
# EC2 user-data: bootstraps a fresh Amazon Linux 2023 instance to run the ParentPulse API + frontend.
# Runs once, automatically, on first boot.
set -euo pipefail

dnf update -y
# The AWS SDK v3 locked in backend/package-lock.json requires Node >= 20, but
# AL2023's default "nodejs" package is v18 - install the versioned package and
# make it the default node/npm on PATH.
dnf install -y nginx nodejs20 nodejs20-npm
ln -sf "$(command -v node-20)" /usr/local/bin/node
ln -sf "$(command -v npm-20)" /usr/local/bin/npm
ln -sf "$(command -v npx-20)" /usr/local/bin/npx

/usr/local/bin/npm install -g pm2
ln -sf "$(/usr/local/bin/npm prefix -g)/bin/pm2" /usr/local/bin/pm2

mkdir -p /opt/parentpulse/backend /opt/parentpulse/frontend
chown -R ec2-user:ec2-user /opt/parentpulse

systemctl enable nginx
systemctl start nginx

echo "Bootstrap complete." > /opt/parentpulse/bootstrap.log
