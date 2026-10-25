# ParentPulse — AWS Deployment (EC2 + DynamoDB)

These scripts provision a simple, cheap AWS setup for ParentPulse:

- One **EC2** instance (Amazon Linux 2023) running the Node API (via pm2) and nginx,
  which serves the built React frontend as static files and reverse-proxies `/api/*`
  to the Node process on port 4000.
- **DynamoDB** tables (`parentpulse_<entity>_prod`, on-demand billing), created by
  `backend/src/db/init.js`. The EC2 instance reaches them through an IAM instance role
  scoped to `parentpulse_*` tables — no database credentials are stored anywhere.

Why DynamoDB rather than RDS: the backend is written against DynamoDB already, and
on-demand tables cost nothing while idle, whereas an RDS instance bills every hour.

They are plain `aws` CLI + bash, no Terraform/CloudFormation, so you can read exactly
what each step does before running it.

## Prerequisites

- AWS CLI v2, already installed on this machine.
- A configured AWS CLI profile for the target account, e.g.:
  ```bash
  aws configure --profile friend
  ```
  This prompts for the Access Key ID, Secret Access Key, default region, and output
  format for your friend's account. It does **not** touch your own `default` profile.
- Run these scripts from Git Bash (or WSL) — they're bash, not PowerShell.
- `ssh` and `scp` available (both ship with Git Bash on Windows).

## Usage

All scripts read shared settings from `00-config.sh` (default region `ap-south-1`).
Override with environment variables instead of editing the file, e.g.
`export AWS_PROFILE=friend REGION=us-east-1`.

Then run, in order:

```bash
./01-network.sh                 # app security group in the default VPC
./02-create-key-pair.sh         # EC2 SSH key pair (private key saved to .state/)
./03-create-dynamodb-role.sh    # IAM role + instance profile for DynamoDB access
./04-create-ec2.sh              # EC2 instance, bootstraps Node 20/nginx/pm2 via user-data
./06-create-cloudfront.sh       # HTTPS CloudFront distribution + origin secret (5-15 min)
./08-ssh-via-instance-connect.sh  # SSH via EC2 Instance Connect Endpoint; closes public port 22
./05-deploy-app.sh              # builds + ships the app, creates tables, seeds, starts pm2
./07-restrict-origin.sh         # port 80 open to CloudFront only
```

Each script is idempotent-ish: re-running it reuses what already exists instead of
duplicating resources. State (instance IDs, endpoints, the generated JWT secret and
origin secret, the `.pem` key) is cached in `.state/`, which is git-ignored — **do not
commit it**.

After `05-deploy-app.sh` finishes, it prints the app URL (`https://<id>.cloudfront.net`).

## Security model

- **HTTPS only.** CloudFront terminates TLS and redirects HTTP to HTTPS. The EC2
  security group accepts port 80 only from CloudFront's IP ranges, and nginx also
  rejects any request without the secret `X-Origin-Verify` header CloudFront adds.
- **No public SSH.** Port 22 is reachable only from the EC2 Instance Connect
  Endpoint, so SSH needs both AWS credentials and the key pair.
- **Sessions** are a JWT in an `HttpOnly; Secure; SameSite=Strict` cookie (never
  visible to page scripts). They expire after 15 minutes of inactivity (with an
  in-app warning one minute before) and 8 hours after sign-in at most. Logout or a
  password change revokes every session for that user; deactivating a user takes
  effect on their next request.
- **Brute-force protection:** per-IP rate limits on sign-in/registration, plus a
  15-minute account lockout after 5 wrong passwords.
- **Passwords:** bcrypt-hashed; new passwords need 10+ characters with upper, lower
  and a digit. Self-registered teacher accounts wait for admin approval.
- **Headers:** HSTS, a strict Content-Security-Policy, `X-Frame-Options: DENY`,
  `nosniff`, Referrer-Policy and Permissions-Policy; API responses are `no-store`.
- **Database:** DynamoDB access is via the instance's IAM role, scoped to
  `parentpulse_*` tables. No database credentials exist anywhere.

## Cost control

Everything here fits comfortably in the AWS free tier (`t3.micro` EC2, on-demand
DynamoDB) for a short-lived class project, but it still runs — and can still bill — until
you tear it down. When you're done:

```bash
./destroy.sh
```

This terminates the EC2 instance and removes the IAM role, security group and key
pair. DynamoDB tables are kept (free while idle); the script prints the command to
delete them. It asks for a typed `destroy`
confirmation before doing anything.

## Redeploying after a code change

Just re-run `05-deploy-app.sh` (it SSHes through the Instance Connect tunnel, so it
works from any network) — it rebuilds the frontend, re-syncs the backend,
re-checks the (idempotent) tables, and restarts the pm2 process. It does not
recreate the EC2 instance.

## Switching which AWS account is targeted

This project's own AWS activity should always run under `AWS_PROFILE=friend`
(or whatever you name that profile) once it's configured — never the `default`
profile that's already logged into your own account. Every script here takes the
profile from the `AWS_PROFILE` environment variable via `00-config.sh`, so you
never need to run `aws configure` interactively inside a script.
