#!/bin/sh
# Point one BlueOnyx virtual site at the Box IO container.
# Usage: sh blueonyx/install-proxy.sh boxio.example.com
set -eu

fqdn=${1:-}
if [ -z "$fqdn" ]; then
  echo "Usage: sh blueonyx/install-proxy.sh dashboard.example.com" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Run this on the BlueOnyx server as root." >&2
  exit 1
fi

here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
inc_src="$here/boxio-proxy.inc"
inc_dst=/etc/httpd/boxio-proxy.inc
if [ ! -f "$inc_src" ]; then
  echo "Missing $inc_src" >&2
  exit 1
fi
cp "$inc_src" "$inc_dst"

if command -v httpd >/dev/null 2>&1; then
  modules=$(httpd -M 2>/dev/null || true)
  for name in proxy_module proxy_http_module proxy_wstunnel_module; do
    if ! printf '%s\n' "$modules" | grep -q "$name"; then
      echo "Apache is missing $name. On AlmaLinux it is in /etc/httpd/conf.modules.d/00-proxy.conf." >&2
      exit 1
    fi
  done
fi

found=""
for dir in /etc/httpd/conf/vhosts /etc/httpd/conf.d; do
  [ -d "$dir" ] || continue
  # shellcheck disable=SC2044
  for file in $(find "$dir" -type f 2>/dev/null); do
    if awk -v name="$fqdn" '$1 == "ServerName" && $2 == name { found = 1 } END { exit !found }' "$file"; then
      found="$found $file"
    fi
  done
done
if [ -z "$found" ]; then
  echo "No Apache virtual site has ServerName $fqdn." >&2
  echo "Create that site in the BlueOnyx GUI, turn on SSL, then run this script again." >&2
  exit 1
fi

insert_include() {
  src=$1
  tmp=$(mktemp)
  awk -v name="$fqdn" -v inc="    Include /etc/httpd/boxio-proxy.inc" '
    /<VirtualHost/ { inhost=1; buf=""; hit=0 }
    inhost {
      buf = buf $0 ORS
      if ($1 == "ServerName" && $2 == name) hit = 1
      if ($0 ~ "</VirtualHost>") {
        if (hit && buf !~ /boxio-proxy\.inc/) {
          sub("</VirtualHost>", inc ORS "</VirtualHost>", buf)
        }
        printf "%s", buf
        inhost=0
      }
      next
    }
    { print }
  ' "$src" > "$tmp"
  cat "$tmp" > "$src"
  rm -f "$tmp"
}

for file in $found; do
  insert_include "$file"
  echo "Proxy include added in $file"
done

if command -v httpd >/dev/null 2>&1; then
  httpd -t
  systemctl reload httpd
fi

if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-port=5923/tcp
  firewall-cmd --reload
  echo "firewalld allows TCP 5923."
fi

if [ -d /etc/nginx/vsites ] && systemctl is-active --quiet nginx 2>/dev/null; then
  for file in /etc/nginx/vsites/*; do
    [ -f "$file" ] || continue
    if grep -q "server_name[[:space:]].*$fqdn" "$file" && grep -q 'proxy_set_header Connection "";' "$file"; then
      tmp=$(mktemp)
      sed \
        -e 's|proxy_set_header Connection "";|proxy_set_header Upgrade $http_upgrade;\n  proxy_set_header Connection $http_connection;|' \
        -e 's|proxy_read_timeout 90;|proxy_read_timeout 3600s;|' \
        "$file" > "$tmp"
      cat "$tmp" > "$file"
      rm -f "$tmp"
      echo "Websocket headers added in $file"
    fi
  done
  if nginx -t; then
    systemctl reload nginx
  fi
fi

echo "Dashboard proxy for $fqdn is installed."
echo "Saving that site in the BlueOnyx GUI can rewrite its web config. Run this script again if the dashboard stops loading."
