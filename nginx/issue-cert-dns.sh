#!/usr/bin/env bash
# Issue a Let's Encrypt certificate using a DNS TXT record.
# Use this when HTTP-01 fails with "Timeout during connect" even though
# port 80 looks open from the LAN.
#
# Usage (on the Ubuntu server, from server/):
#   EMAIL=you@example.com DOMAIN=example.com ./nginx/issue-cert-dns.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN="${DOMAIN:-example.com}"
EMAIL="${EMAIL:-}"
if [ -z "$EMAIL" ]; then
  echo "Set EMAIL. Example:"
  echo "  EMAIL=you@example.com DOMAIN=example.com $0"
  exit 1
fi

mkdir -p nginx/certs nginx/letsencrypt

echo
echo "Certbot will print a TXT record name and value."
echo "In DNS for ${DOMAIN} create:"
echo "  Type TXT"
echo "  Name  _acme-challenge"
echo "  Value (the string certbot shows)"
echo "Wait until this resolves before pressing Enter in certbot:"
echo "  dig +short TXT _acme-challenge.${DOMAIN}"
echo

docker compose run --rm -it --entrypoint certbot certbot certonly \
  --manual \
  --preferred-challenges dns \
  --agree-tos --no-eff-email \
  --email "$EMAIL" \
  -d "$DOMAIN"

LIVE="nginx/letsencrypt/live/${DOMAIN}"
if [ ! -f "${LIVE}/fullchain.pem" ]; then
  echo "Certificate files were not found at ${LIVE}"
  exit 1
fi

cp -L "${LIVE}/fullchain.pem" nginx/certs/fullchain.pem
cp -L "${LIVE}/privkey.pem" nginx/certs/privkey.pem
chmod 644 nginx/certs/fullchain.pem
chmod 600 nginx/certs/privkey.pem

docker compose exec nginx nginx -s reload
echo "Installed Let's Encrypt certificate for ${DOMAIN} via DNS-01"
