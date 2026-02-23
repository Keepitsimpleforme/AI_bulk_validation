#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/vm/bootstrap.sh"
  exit 1
fi

APP_USER="${APP_USER:-bulkapp}"
APP_GROUP="${APP_GROUP:-bulkapp}"
APP_DIR="${APP_DIR:-/opt/bulk-validation}"
NODE_MAJOR="${NODE_MAJOR:-20}"
SSH_PORT="${SSH_PORT:-22}"

apt-get update
apt-get install -y curl gnupg2 ca-certificates lsb-release ufw nginx redis-server postgresql postgresql-contrib

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${APP_USER}"
fi

usermod -aG sudo "${APP_USER}"

curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
apt-get install -y nodejs
npm install -g pm2

mkdir -p "${APP_DIR}"
chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}" || true

systemctl enable redis-server
systemctl enable postgresql
systemctl enable nginx
systemctl restart redis-server
systemctl restart postgresql
systemctl restart nginx

ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd

sudo -u "${APP_USER}" mkdir -p "${APP_DIR}/logs" "${APP_DIR}/outputs"

echo "Bootstrap complete."
echo "Next:"
echo "1) copy project to ${APP_DIR}"
echo "2) set .env"
echo "3) run npm ci && npm run migrate"
echo "4) start with pm2 ecosystem.config.cjs"
