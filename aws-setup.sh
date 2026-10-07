#!/bin/bash
# =====================================================================
#  PolyWeave server setup for AWS Lightsail (Ubuntu 24.04).
#  Run it once on a new Ubuntu 24.04 server (in the Lightsail browser SSH window):
#    curl -fsSL https://raw.githubusercontent.com/PolyWeaveOS/PolyWeave/main/aws-setup.sh | sudo bash
#  It installs:
#   - Node.js + the game (cloned from GitHub), running as a service that restarts itself
#   - Caddy: the web front door with automatic HTTPS (https://...)
#   - pw-https  : sets the web address (free <ip>.sslip.io address, or your own domain)
#   - pw-update : pulls the latest game from GitHub and restarts (also runs by itself every 5 min)
#  Progress log: /var/log/polyweave-setup.log
# =====================================================================
# (wrapped in { } so the whole script is read before anything runs - safe to pipe into bash)
{
exec < /dev/null > >(tee /var/log/polyweave-setup.log) 2>&1
set -eu
export DEBIAN_FRONTEND=noninteractive

REPO=https://github.com/PolyWeaveOS/PolyWeave.git
APP=/opt/polyweave

# --- packages: Node.js 22, git, Caddy ---
apt-get update
apt-get install -y ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

# --- the game, running as its own user ---
id polyweave >/dev/null 2>&1 || useradd -r -m -d /var/lib/polyweave -s /usr/sbin/nologin polyweave
rm -rf "$APP"
git clone "$REPO" "$APP"
chown -R polyweave:polyweave "$APP"
cd "$APP"
sudo -u polyweave -H npm install --omit=dev --no-audit --no-fund

cat > /etc/systemd/system/polyweave.service <<'EOF'
[Unit]
Description=PolyWeave game server
After=network.target

[Service]
User=polyweave
WorkingDirectory=/opt/polyweave
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=LB_PERSIST=1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now polyweave

# --- pw-https: point the web address at the game (run again after attaching a static IP / adding a domain) ---
#     (the script lives in the repo: pw-https.sh - main address first, extra addresses redirect to it)
install -m 755 "$APP/pw-https.sh" /usr/local/bin/pw-https

# --- pw-update: get the newest version from GitHub (restarts only when something changed) ---
cat > /usr/local/bin/pw-update <<'EOF'
#!/bin/bash
cd /opt/polyweave || exit 1
OLD=$(sudo -u polyweave git rev-parse HEAD)
sudo -u polyweave git pull --ff-only -q || { echo "git pull failed"; exit 1; }
NEW=$(sudo -u polyweave git rev-parse HEAD)
if [ "$OLD" != "$NEW" ] || [ "$1" = "--force" ]; then
  sudo -u polyweave -H npm install --omit=dev --no-audit --no-fund
  systemctl restart polyweave
  echo "$(date): updated to: $(sudo -u polyweave git log -1 --format=%s)"
else
  [ -t 1 ] && echo "Already up to date."
fi
EOF
chmod +x /usr/local/bin/pw-update
echo '*/5 * * * * root /usr/local/bin/pw-update >> /var/log/polyweave-update.log 2>&1' > /etc/cron.d/polyweave-update

# --- first web address (with the IP the server has right now) ---
/usr/local/bin/pw-https
echo
echo "SETUP FINISHED"
}
