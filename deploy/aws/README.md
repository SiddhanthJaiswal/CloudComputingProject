# ParentPulse — AWS Deployment (EC2 + RDS)

These scripts provision a simple, cheap AWS setup for ParentPulse:

- One **EC2** instance (Amazon Linux 2023) running the Node API (via pm2) and nginx,
  which serves the built React frontend as static files and reverse-proxies `/api/*`
  to the Node process on port 4000.
- One **RDS PostgreSQL** instance, not publicly accessible — only the EC2 instance's
  security group can reach it on port 5432.

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

All scripts read shared settings from `00-config.sh`. Override with environment
variables instead of editing the file, e.g.:

```bash
export AWS_PROFILE=friend
export REGION=us-east-1          # pick the region your friend wants billed
export DB_MASTER_PASSWORD='pick-a-strong-password'
```

Then run, in order:

```bash
./01-network.sh          # security groups in the default VPC
./02-create-key-pair.sh  # EC2 SSH key pair (private key saved to .state/)
./03-create-rds.sh       # RDS Postgres instance (takes several minutes)
./04-create-ec2.sh       # EC2 instance, bootstraps Node/nginx/pm2 via user-data
./05-deploy-app.sh       # builds frontend, ships both apps, runs schema + seed, starts pm2
```

Each script is idempotent-ish: re-running it reuses what already exists instead of
duplicating resources. State (instance IDs, endpoints, the generated JWT secret, the
`.pem` key) is cached in `.state/`, which is git-ignored — **do not commit it**.

After `05-deploy-app.sh` finishes, it prints the app URL (`http://<ec2-public-ip>`)
and the seeded demo logins.

## Cost control

Everything here fits comfortably in the AWS free tier (`t3.micro` EC2, `db.t3.micro`
RDS) for a short-lived class project, but it still runs — and can still bill — until
you tear it down. When you're done:

```bash
./destroy.sh
```

This terminates the EC2 instance, deletes the RDS instance (no final snapshot),
and removes the security groups and key pair. It asks for a typed `destroy`
confirmation before doing anything.

## Redeploying after a code change

Just re-run `05-deploy-app.sh` — it rebuilds the frontend, re-syncs the backend,
re-applies the (idempotent) schema, and restarts the pm2 process. It does not
recreate the EC2/RDS instances.

## Switching which AWS account is targeted

This project's own AWS activity should always run under `AWS_PROFILE=friend`
(or whatever you name that profile) once it's configured — never the `default`
profile that's already logged into your own account. Every script here takes the
profile from the `AWS_PROFILE` environment variable via `00-config.sh`, so you
never need to run `aws configure` interactively inside a script.
