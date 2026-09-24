#!/bin/bash
# EC2 user-data: bootstraps a fresh Amazon Linux 2023 instance to run the ParentPulse API + frontend.
# Runs once, automatically, on first boot.
set -euo pipefail

dnf update -y
dnf install -y nginx nodejs npm

npm install -g pm2

mkdir -p /opt/parentpulse/backend /opt/parentpulse/frontend
chown -R ec2-user:ec2-user /opt/parentpulse

systemctl enable nginx
systemctl start nginx

echo "Bootstrap complete." > /opt/parentpulse/bootstrap.log
