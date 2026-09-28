#!/usr/bin/env bash
# Deploys the built site (dist/) to the VPS. Additive only: its own web root, its own nginx
# server block, its own certificate. Validates nginx before a graceful reload.
set -euo pipefail
# The server lives in a local, git-ignored file: echo 'VOX_DEPLOY_HOST=user@server' > .deploy.env
[ -f "$(dirname "$0")/../.deploy.env" ] && . "$(dirname "$0")/../.deploy.env"
HOST="${VOX_DEPLOY_HOST:?Set VOX_DEPLOY_HOST=user@server (for example in .deploy.env at the repo root)}"
DOMAIN="vox-studio.devops-monk.com"
ROOT="/var/www/vox-studio"
CONF="/etc/nginx/sites-enabled/vox-studio"
cd "$(dirname "$0")"

[ -f dist/index.html ] || { echo "Run 'node build.mjs' first"; exit 1; }

echo "→ Uploading site to $ROOT"
ssh "$HOST" "mkdir -p $ROOT"
rsync -az --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r dist/ "$HOST:$ROOT/"

echo "→ Ensuring nginx server block (created once, never overwritten)"
ssh "$HOST" "bash -s" <<REMOTE
set -euo pipefail
if [ ! -f "$CONF" ]; then
  cat > "$CONF" <<'NGINX'
# vox-studio.devops-monk.com → the VoxStudio website (static files).
# certbot --nginx adds the 443 block and redirect to this file only.
server {
    listen 80;
    server_name vox-studio.devops-monk.com;

    root /var/www/vox-studio;
    index index.html;

    limit_conn perip 20;
    limit_req zone=general burst=60 nodelay;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location /screens/ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000";
    }

    location / {
        try_files \$uri \$uri/ \$uri.html =404;
    }
}
NGINX
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "nginx: new server block active"
  else
    rm -f "$CONF"
    nginx -t
    echo "nginx config test failed — removed the new block; nothing else changed" >&2
    exit 1
  fi
fi
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --keep-until-expiring --redirect
fi
nginx -t 2>&1 | tail -1
REMOTE
echo "→ Live at https://$DOMAIN"
