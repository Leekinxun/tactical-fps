#!/bin/sh
set -eu

node /app/server/multiplayer-server.mjs &
server_pid=$!
nginx -g 'daemon off;' &
nginx_pid=$!

shutdown() {
  kill "$server_pid" "$nginx_pid" 2>/dev/null || true
  wait "$server_pid" "$nginx_pid" 2>/dev/null || true
}

trap shutdown INT TERM EXIT
while kill -0 "$server_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 1
done
exit 1
