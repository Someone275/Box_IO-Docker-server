#!/bin/sh
# Renew the Let's Encrypt certificate from init-letsencrypt.sh and reload nginx.
# A certificate from issue-cert-dns.sh is manual. Run that script again before 90 days.
#
#   sh nginx/renew-cert.sh
set -eu
cd "$(dirname "$0")/.."

docker compose run --rm -T --entrypoint certbot certbot renew \
  --webroot -w /var/www/certbot --quiet

docker compose exec -T nginx sh -c '
  found=
  for dir in /etc/letsencrypt/live/*/; do
    if [ -f "${dir}fullchain.pem" ] && [ -f "${dir}privkey.pem" ]; then
      cp -L "${dir}fullchain.pem" /etc/nginx/certs/fullchain.pem
      cp -L "${dir}privkey.pem" /etc/nginx/certs/privkey.pem
      found=1
    fi
  done
  if [ -z "$found" ]; then
    echo "No certificate in /etc/letsencrypt/live. Run nginx/init-letsencrypt.sh first." >&2
    exit 1
  fi
  nginx -s reload
'

echo "Certificate installed and nginx reloaded."
