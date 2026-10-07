#!/usr/bin/env bash
# Issue a Let's Encrypt certificate and install it for the Box IO nginx proxy.
# Usage (from server/):
#   DOMAIN=boxio.example.com EMAIL=you@example.com ./nginx/init-letsencrypt.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Set DOMAIN and EMAIL. Example:"
  echo "  DOMAIN=boxio.example.com EMAIL=admin@example.com $0"
  exit 1
fi

mkdir -p nginx/certs
docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos --no-eff-email \
  -d "$DOMAIN"

docker compose run --rm --entrypoint /bin/sh nginx -c \
  "cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/nginx/certs/fullchain.pem && \
   cp /etc/letsencrypt/live/$DOMAIN/privkey.pem /etc/nginx/certs/privkey.pem"

docker compose exec nginx nginx -s reload
echo "Installed Let's Encrypt certificate for $DOMAIN"
echo "Add nginx/renew-cert.sh to crontab so it renews. The install pages show the line."
