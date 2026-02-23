# Git setup: push from Mac, clone on VM

Use this to put the bulk-validation code on GitHub and clone it into your VM folder.

---

## Part 1: Create the repo on GitHub

1. Go to **https://github.com/new**
2. **Repository name:** e.g. `bulk-validation` or `midas-gs1`
3. Choose **Private** (or Public).
4. **Do not** add a README, .gitignore, or license (we already have them).
5. Click **Create repository**.
6. Copy the repo URL, e.g. `https://github.com/YOUR_USERNAME/bulk-validation.git` or `git@github.com:YOUR_USERNAME/bulk-validation.git`.

---

## Part 2: On your Mac – push the code to GitHub

Open Terminal and run (replace `YOUR_USERNAME` and `bulk-validation` with your GitHub username and repo name):

```bash
cd "/Users/vivekkumar/Desktop/Ai validation"

# Initialize Git
git init

# Add all files (.gitignore will exclude .env, node_modules, outputs)
git add .
git commit -m "Initial commit: bulk validation pipeline"

# Add your GitHub repo as remote (use the URL from Part 1)
git remote add origin https://github.com/YOUR_USERNAME/bulk-validation.git

# Rename branch to main if needed, then push
git branch -M main
git push -u origin main
```

If GitHub asks for auth:
- **HTTPS:** Use your GitHub username and a **Personal Access Token** (Settings → Developer settings → Personal access tokens) as the password.
- **SSH:** Use the SSH URL: `git@github.com:YOUR_USERNAME/bulk-validation.git` and ensure your Mac has an SSH key added to GitHub.

---

## Part 3: On the VM – clone into your folder

SSH into the VM and go to the folder where the bulk-validation code should live (e.g. `midas-gs1` or the parent folder).

### Option A: Folder is empty – clone into it

```bash
cd /path/to/your/folder   # e.g. cd /root/midas-gs1
git clone https://github.com/YOUR_USERNAME/bulk-validation.git .
```

The `.` at the end clones into the **current folder** (it must be empty).

### Option B: Folder has other files – clone into a new subfolder

```bash
cd /path/to/parent       # e.g. cd /root
git clone https://github.com/YOUR_USERNAME/bulk-validation.git midas-gs1
cd midas-gs1
```

Then continue with VM setup: bootstrap, setup_db, .env, `npm ci`, `npm run migrate`, `pm2 start ecosystem.config.cjs`.

### Private repo on VM: use a token or SSH

- **HTTPS with token:** When you `git pull`, use your GitHub username and a Personal Access Token as the password. To store it: `git config credential.helper store`, then do one `git pull`.
- **SSH:** On the VM run `ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519`, add `~/.ssh/id_ed25519.pub` to GitHub (Settings → SSH keys), then use the SSH URL: `git clone git@github.com:YOUR_USERNAME/bulk-validation.git .`

---

## Later: deploy updates

**On Mac** (after you change code):

```bash
cd "/Users/vivekkumar/Desktop/Ai validation"
git add .
git commit -m "Your message"
git push
```

**On VM** (to get the latest code and restart):

```bash
cd /path/to/bulk-validation   # e.g. cd /root/midas-gs1
git pull
npm ci
npm run migrate   # only if there are new migrations
pm2 restart all
```
