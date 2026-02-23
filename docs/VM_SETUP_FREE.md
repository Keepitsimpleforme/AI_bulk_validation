# Set up everything on one VM (no extra charges)

Everything runs on **one VM**: PostgreSQL, Redis, and the Node app. No managed databases, no paid add-ons. You only pay for the VM (or use a free-tier VM and pay nothing).

---

## Cost overview

| What | Where it runs | Extra cost |
|------|----------------|------------|
| **PostgreSQL** | Same VM (apt install) | **$0** |
| **Redis** | Same VM (apt install) | **$0** |
| **Node.js app** | Same VM (PM2) | **$0** |

Only cost is the VM itself. Use a **free-tier VM** (see below) to keep cost at **$0**.

---

## 1. Get a free VM (optional)

Use any provider’s free tier so the VM itself costs nothing:

- **Oracle Cloud Always Free**: 2 AMD VMs or 4 ARM Ampere VMs (e.g. Ubuntu 22.04). No credit card charge if you stay in free tier.
- **Google Cloud**: e2-micro free tier (1 VM, certain regions).
- **AWS**: t2.micro free tier for 12 months.
- **Azure**: B1s etc. (check current free tier).
- **Your own machine**: VirtualBox/VMware with Ubuntu Server = $0.

Create an **Ubuntu 22.04** (or 24.04) VM and note its **public IP**. SSH as root or a user with sudo:

```bash
ssh root@<VM_IP>
# or
ssh ubuntu@<VM_IP>
```

---

## 2. Put the project on the VM

From your laptop (or wherever the code lives):

```bash
# Option A: clone from Git (VM needs Git installed first; see section 9)
ssh root@<VM_IP> "apt-get update && apt-get install -y git && git clone https://github.com/YOUR_ORG/bulk-validation.git /opt/bulk-validation"

# Option B: copy with scp (no Git needed on VM)
scp -r /path/to/Ai\ validation/* root@<VM_IP>:/opt/bulk-validation/
```

Then on the VM:

```bash
cd /opt/bulk-validation
```

If you used **Option B**, install Git on the VM if you need it later: `apt-get update && apt-get install -y git`.

---

## 3. Bootstrap the VM (one time)

This installs **Node 20, PostgreSQL, Redis, Nginx**, creates an app user, and prepares directories. Run as root:

```bash
cd /opt/bulk-validation
sudo bash scripts/vm/bootstrap.sh
```

What this does:

- Installs Node.js 20, PM2, PostgreSQL, Redis, Nginx
- Enables and starts PostgreSQL and Redis (so they start after reboot too)
- Creates user `bulkapp` and directory `/opt/bulk-validation/outputs`
- Configures UFW (firewall) and SSH

No external or paid services are used; everything is on this VM.

---

## 4. Set up the database (one time)

PostgreSQL is already installed. This step creates the **database** and **user** the app will use (all on the same VM):

```bash
cd /opt/bulk-validation
sudo bash scripts/vm/setup_db.sh
```

Defaults:

- Database: `bulk_validation`
- User: `bulk_user`
- Password: `bulk_pass`

To override:

```bash
DB_NAME=my_db DB_USER=my_user DB_PASS=my_secret sudo bash scripts/vm/setup_db.sh
```

**Allow the app to connect from localhost:**  
On Ubuntu, Postgres usually allows password connections from `127.0.0.1` already. If the app later fails with “password authentication failed” or “no pg_hba.conf entry”:

1. Find config: `sudo -u postgres psql -c "SHOW hba_file;"` (often `/etc/postgresql/14/main/pg_hba.conf`).
2. Ensure you have a line like:  
   `host  all  all  127.0.0.1/32  scram-sha-256`  
   (or `md5` on older Postgres). Add it if missing, then reload:  
   `sudo systemctl reload postgresql`.

---

## 5. Configure the app

As the app user (or the user that will run the app):

```bash
cd /opt/bulk-validation
sudo chown -R bulkapp:bulkapp /opt/bulk-validation   # if you copied as root
su - bulkapp                                         # or: sudo -u bulkapp bash
cd /opt/bulk-validation

cp .env.example .env
nano .env   # or vim
```

Set at least:

```bash
# Required
GS1_TOKEN=your_gs1_api_token_here
DATABASE_URL=postgres://bulk_user:bulk_pass@127.0.0.1:5432/bulk_validation
REDIS_URL=redis://127.0.0.1:6379

# When you have the URLs
HOURLY_PUBLISH_URL=http://localhost:3000/store_product_auto_validate
# DOWNSTREAM_URL=   # optional, for batch delivery
```

`127.0.0.1` means “this VM”. No external DB or Redis; no extra cost.

---

## 6. Install dependencies and create DB tables

Still as the app user in `/opt/bulk-validation`:

```bash
npm ci
npm run migrate
```

`migrate` creates the tables (runs, run_checkpoints, validation_results, delivery_outbox, idempotency_keys, etc.) in the local Postgres database.

---

## 7. Start the app with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command that `pm2 startup` prints (e.g. `sudo env PATH=... pm2 startup systemd`) so the app restarts after a reboot. Everything (API, workers, cron jobs) runs on this VM; no other servers needed.

---

## 8. Check that everything is running

- **PostgreSQL**: `sudo systemctl status postgresql` → active
- **Redis**: `sudo systemctl status redis-server` → active  
- **App**: `pm2 list` → bulk-api, worker-validation, worker-delivery, etc.  
- **API**: `curl http://127.0.0.1:3000/healthz` → `{"ok":true,...}`

---

## 9. Connect with Git (updates and later changes)

Using Git on the VM lets you **pull** the latest code and redeploy without copying files manually.

### First-time: clone from Git

If you didn’t copy the repo with `scp`, clone it on the VM (after bootstrap, which does not install Git by default):

```bash
sudo apt-get update && sudo apt-get install -y git
sudo mkdir -p /opt/bulk-validation && sudo chown bulkapp:bulkapp /opt/bulk-validation
su - bulkapp
cd /opt
git clone https://github.com/YOUR_ORG/bulk-validation.git bulk-validation
cd bulk-validation
```

Use your real repo URL (GitHub, GitLab, Bitbucket, etc.). For a **private repo**, use one of the options below so the VM can pull without typing a password.

### Option A: HTTPS with a personal access token (simplest)

1. On GitHub/GitLab: create a **Personal Access Token** (repo read access; add write if you want the VM to push).
2. On the VM, when you first `git pull` (or clone), use the token as the password when prompted, or store it:

```bash
cd /opt/bulk-validation
git config credential.helper store
git pull   # enter username + token when asked; next time it won’t ask
```

Or set the remote URL with the token (less secure, but works):

```bash
git remote set-url origin https://YOUR_TOKEN@github.com/YOUR_ORG/bulk-validation.git
git pull
```

### Option B: SSH key (good for pull + push)

1. On the VM (as `bulkapp`):

```bash
ssh-keygen -t ed25519 -C "vm-bulk-validation" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

2. In GitHub/GitLab: **Settings → SSH keys** (or Deploy keys for one repo). Paste the `id_ed25519.pub` content.
3. On the VM, switch the remote to SSH and pull:

```bash
cd /opt/bulk-validation
git remote set-url origin git@github.com:YOUR_ORG/bulk-validation.git
git pull
```

After this, `git pull` (and `git push` if you gave the key write access) will work without a password.

### Deploying later changes (workflow)

When you push changes from your laptop to the same repo:

1. **On the VM** (as the user that runs the app, e.g. `bulkapp`):

```bash
cd /opt/bulk-validation
git pull
npm ci
npm run migrate   # only if there are new migrations
pm2 restart all
```

2. Optional: one-line deploy script on the VM:

```bash
echo 'cd /opt/bulk-validation && git pull && npm ci && npm run migrate && pm2 restart all' | sudo tee /opt/bulk-validation/scripts/deploy.sh
sudo chmod +x /opt/bulk-validation/scripts/deploy.sh
sudo chown bulkapp:bulkapp /opt/bulk-validation/scripts/deploy.sh
```

Then to deploy: `su - bulkapp -c '/opt/bulk-validation/scripts/deploy.sh'` (or run as `bulkapp`).

### Summary

| Goal | How |
|------|-----|
| **Clone on VM** | Install Git, then `git clone <repo-url>` into `/opt/bulk-validation`. |
| **Pull (private repo)** | Use HTTPS + token or SSH key (add key to GitHub/GitLab). |
| **Deploy updates** | On VM: `git pull` → `npm ci` → `npm run migrate` (if needed) → `pm2 restart all`. |
| **Push from VM** | Optional; use SSH key with write access or HTTPS with a token that has write. |

---

## Summary: one VM, no extra DB cost

- **DB**: Postgres on the same VM (`127.0.0.1:5432`). Setup: `scripts/vm/setup_db.sh` + `npm run migrate`.
- **Redis**: On the same VM (`127.0.0.1:6379`). Installed and started by `bootstrap.sh`.
- **App**: Same VM, managed by PM2.

Use a free-tier VM and you have **zero extra charges** for DB or infrastructure beyond that single machine.
