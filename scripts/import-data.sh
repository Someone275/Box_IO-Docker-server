#!/bin/sh
# Load an archive made by export-data.sh into this Box IO station.
# Users, device keys, layouts, and the license replace whatever is already here.
#
#   sh scripts/import-data.sh ~/boxio-export.tar.gz
#
# On BlueOnyx:
#   sh scripts/import-data.sh -f docker-compose.blueonyx.yml ~/boxio-export.tar.gz
set -eu

usage() {
  echo "Usage: sh scripts/import-data.sh [-C directory] [-f compose-file] archive.tar.gz" >&2
  exit 1
}

project_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
compose_file=
archive=

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
    -*)
      usage
      ;;
    *)
      archive=$1
      shift
      ;;
  esac
done

[ -n "$archive" ] || usage
[ -f "$archive" ] || {
  echo "Archive not found: $archive" >&2
  exit 1
}

project_dir=$(CDPATH= cd -- "$project_dir" && pwd)
case "$archive" in
  /*) ;;
  *) archive=$(pwd)/$archive ;;
esac

compose() {
  if [ -n "$compose_file" ]; then
    docker compose --project-directory "$project_dir" -f "$project_dir/$compose_file" "$@"
  else
    docker compose --project-directory "$project_dir" "$@"
  fi
}

stopped=0
stage=$(mktemp -d)
bring_back() {
  if [ "${stopped:-0}" = 1 ]; then
    compose up -d || echo "Start the station again with: docker compose up -d" >&2
  fi
}
trap 'ec=$?; rm -rf "$stage"; bring_back; exit "$ec"' EXIT
umask 077
tar -C "$stage" -xzf "$archive"

if [ ! -f "$stage/BOXIO-EXPORT" ] || [ ! -f "$stage/data/boxio.db" ]; then
  echo "That archive is not a Box IO export. It needs BOXIO-EXPORT and data/boxio.db." >&2
  exit 1
fi

cid=$(compose ps -aq boxio | head -n 1)
if [ -z "$cid" ]; then
  echo "Creating the Box IO container so it has a data volume."
  if ! compose up -d --no-build boxio; then
    echo "The prebuilt image is not on this machine. Run docker compose pull, then import again." >&2
    exit 1
  fi
  cid=$(compose ps -aq boxio | head -n 1)
fi

echo "Stopping the station in $project_dir."
compose stop
stopped=1
cid=$(compose ps -aq boxio | head -n 1)
image=$(docker inspect -f '{{.Config.Image}}' "$cid")
volume=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$cid")
if [ -z "$volume" ]; then
  echo "The Box IO container has no /data volume." >&2
  exit 1
fi

docker run --rm -v "$volume":/data --entrypoint sh "$image" -c \
  'rm -f /data/boxio.db /data/boxio.db-wal /data/boxio.db-shm /data/license.json /data/instance-id /data/license-token'

for name in boxio.db boxio.db-wal boxio.db-shm license.json instance-id license-token; do
  if [ -f "$stage/data/$name" ]; then
    docker cp "$stage/data/$name" "$cid":/data/"$name"
  fi
done

if [ -f "$stage/jwt-secret" ]; then
  secret=$(tr -d '\r\n' < "$stage/jwt-secret")
  if [ -n "$secret" ]; then
    env_file=$project_dir/.env
    tmp=$(mktemp)
    if [ -f "$env_file" ]; then
      awk -v s="$secret" '
        BEGIN { done = 0 }
        /^JWT_SECRET=/ { print "JWT_SECRET=" s; done = 1; next }
        { print }
        END { if (!done) print "JWT_SECRET=" s }
      ' "$env_file" > "$tmp"
    else
      printf 'JWT_SECRET=%s\n' "$secret" > "$tmp"
    fi
    cat "$tmp" > "$env_file"
    rm -f "$tmp"
    chmod 600 "$env_file"
    echo "JWT secret restored into $env_file"
  fi
fi

if [ -f "$stage/nginx/certs/fullchain.pem" ] && [ -f "$stage/nginx/certs/privkey.pem" ]; then
  mkdir -p "$project_dir/nginx/certs"
  cp -a "$stage/nginx/certs/fullchain.pem" "$stage/nginx/certs/privkey.pem" "$project_dir/nginx/certs/"
  echo "HTTPS certificate restored."
fi
if [ -d "$stage/nginx/letsencrypt/live" ]; then
  mkdir -p "$project_dir/nginx/letsencrypt"
  cp -a "$stage/nginx/letsencrypt/." "$project_dir/nginx/letsencrypt/"
fi

compose up -d
stopped=0
echo "Import finished. Open the dashboard and sign in with the same admin account."
