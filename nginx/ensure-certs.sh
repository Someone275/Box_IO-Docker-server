#!/bin/sh
set -e
CERT_DIR="${CERT_DIR:-/etc/nginx/certs}"
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/fullchain.pem" ] || [ ! -f "$CERT_DIR/privkey.pem" ]; then
  echo "No TLS certificate found — writing a self-signed cert for first boot."
  echo "Replace it with Let's Encrypt via nginx/init-letsencrypt.sh when DNS is ready."
  apk add --no-cache openssl >/dev/null 2>&1 || true
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$CERT_DIR/privkey.pem" \
    -out "$CERT_DIR/fullchain.pem" \
    -subj "/CN=localhost"
fi
