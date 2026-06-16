#!/usr/bin/env bash
set -euo pipefail

pids=()
dev_ports=(4321 8787 8001)

cleanup() {
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

stop_existing_dev_servers() {
  local existing_pids

  for port in "${dev_ports[@]}"; do
    existing_pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -z "$existing_pids" ]; then
      continue
    fi

    echo "Stopping existing dev server on port $port: $existing_pids"
    # shellcheck disable=SC2086
    kill $existing_pids 2>/dev/null || true
  done

  for _ in {1..20}; do
    local has_listener=false
    for port in "${dev_ports[@]}"; do
      if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        has_listener=true
        break
      fi
    done

    if [ "$has_listener" = false ]; then
      return
    fi
    sleep 0.25
  done

  for port in "${dev_ports[@]}"; do
    existing_pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -z "$existing_pids" ]; then
      continue
    fi

    echo "Force stopping dev server on port $port: $existing_pids"
    # shellcheck disable=SC2086
    kill -9 $existing_pids 2>/dev/null || true
  done
}

stop_existing_dev_servers

mkdir -p logs

pnpm --parallel --filter './apps/*' dev &
pids+=("$!")

(
  cd deno-relay
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
  fi
  exec > >(tee ../logs/deno-relay.log) 2>&1
  exec deno task dev:8001
) &
pids+=("$!")

while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      exit "$?"
    fi
  done
  sleep 1
done
