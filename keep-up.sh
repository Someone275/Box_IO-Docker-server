#!/bin/sh
# Keep the Box IO process answering. Restarting the container also restarts
# nginx's network, so this stays running and only replaces the program.
set -u

port=${WEB_PORT:-3847}
alive=${DATA_DIR:-/data}/alive
child=""

stop() {
  if [ -n "$child" ]; then
    kill "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit 0
}
trap stop TERM INT

healthy() {
  if [ -f "$alive" ]; then
    now=$(date +%s)
    stamp=$(stat -c %Y "$alive" 2>/dev/null || echo 0)
    [ $((now - stamp)) -lt 15 ]
    return
  fi
  node -e "fetch('http://127.0.0.1:${port}/api/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
}

start_program() {
  node --import tsx src/index.ts &
  child=$!
}

while true; do
  rm -f "$alive"
  start_program
  ready=0
  i=0
  while [ "$i" -lt 30 ]; do
    if ! kill -0 "$child" 2>/dev/null; then
      wait "$child" 2>/dev/null || true
      echo "Box IO exited. Starting it again."
      child=""
      break
    fi
    if healthy; then
      ready=1
      break
    fi
    i=$((i + 1))
    sleep 1
  done
  if [ -z "$child" ]; then
    sleep 2
    continue
  fi
  if [ "$ready" -ne 1 ]; then
    echo "Box IO did not start answering. Starting it again."
    kill -9 "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
    child=""
    sleep 2
    continue
  fi
  misses=0
  while kill -0 "$child" 2>/dev/null; do
    sleep 10
    if healthy; then
      misses=0
      continue
    fi
    misses=$((misses + 1))
    if [ "$misses" -ge 2 ]; then
      echo "Box IO stopped answering. Starting it again."
      kill -9 "$child" 2>/dev/null || true
      wait "$child" 2>/dev/null || true
      child=""
      break
    fi
  done
  if [ -n "$child" ]; then
    wait "$child" 2>/dev/null || true
    echo "Box IO exited. Starting it again."
    child=""
  fi
done
