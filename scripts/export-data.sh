#!/bin/sh
# Save this Box IO station to one archive for a later move.
# The archive holds the database, the license files, the JWT secret, and the
# nginx certificate when those files exist. Keep the archive private.
#
#   sh scripts/export-data.sh -o ~/boxio-export.tar.gz
#
# On BlueOnyx:
#   sh scripts/export-data.sh -f docker-compose.blueonyx.yml -o ~/boxio-export.tar.gz
set -eu

usage() {
  echo "Usage: sh scripts/export-data.sh [-C directory] [-f compose-file] [-o archive.tar.gz]" >&2
  exit 1
}

project_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
compose_file=
output=

while [ $# -gt 0 ]; do
  case "$1" in
    -C)
      [ $# -ge 2 ] || usage
      project_dir=$2
      shift 2
      ;;
    -f)
      [ $# -ge 2 ] || usage
      compose_file=$2
      shift 2
      ;;
    -o)
      [ $# -ge 2 ] || usage
      output=$2
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

project_dir=$(CDPATH= cd -- "$project_dir" && pwd)
if [ -z "$output" ]; then
  output=$project_dir/boxio-export.tar.gz
fi
case "$output" in
  /*) ;;
  *) output=$(pwd)/$output ;;
esac

compose() {
  if [ -n "$compose_file" ]; then
    docker compose --project-directory "$project_dir" -f "$project_dir/$compose_file" "$@"
  else
    docker compose --project-directory "$project_dir" "$@"
  fi
}

cid=$(compose ps -aq boxio | head -n 1)
if [ -z "$cid" ]; then
  echo "No Box IO container exists in $project_dir." >&2
  echo "Start that station once, then run this export again." >&2
  exit 1
fi

echo "Stopping $project_dir so the database file is complete."
compose stop
stopped=1

stage=$(mktemp -d)
bring_back() {
  if [ "${stopped:-0}" = 1 ]; then
    compose up -d || echo "Start the station again with: docker compose up -d" >&2
  fi
}
trap 'ec=$?; rm -rf "$stage"; bring_back; exit "$ec"' EXIT
umask 077
mkdir -p "$stage/data"

docker cp "$cid":/data/. "$stage/data/"
if [ ! -f "$stage/data/boxio.db" ]; then
  echo "The container has no /data/boxio.db to export." >&2
  exit 1
fi

printf '%s\n' 'format=1' > "$stage/BOXIO-EXPORT"

if [ -f "$project_dir/.env" ]; then
  secret=$(awk -F= '/^JWT_SECRET=/ { value=$2 } END { print value }' "$project_dir/.env" | tr -d '\r')
  case "$secret" in
    ""|replace-with-output-of-openssl-rand-hex-48|change-this-in-production) ;;
    *) printf '%s\n' "$secret" > "$stage/jwt-secret" ;;
  esac
fi

if [ -f "$project_dir/nginx/certs/fullchain.pem" ] && [ -f "$project_dir/nginx/certs/privkey.pem" ]; then
  mkdir -p "$stage/nginx/certs"
  cp -a "$project_dir/nginx/certs/fullchain.pem" "$project_dir/nginx/certs/privkey.pem" "$stage/nginx/certs/"
fi
if [ -d "$project_dir/nginx/letsencrypt/live" ]; then
  mkdir -p "$stage/nginx/letsencrypt"
  cp -a "$project_dir/nginx/letsencrypt/." "$stage/nginx/letsencrypt/"
fi

mkdir -p "$(dirname "$output")"
tar -C "$stage" -czf "$output" .
chmod 600 "$output"

compose up -d
stopped=0

echo "Wrote $output"
echo "This station is running again. Copy the archive to the next server and run import-data.sh there."
