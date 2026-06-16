#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="$ROOT_DIR/apps/worker"
DB_NAME="${DB_NAME:-free-canvas-db}"

usage() {
  cat <<'EOF'
Usage:
  pnpm clean:local [--auth] [--state] [--yes]

Options:
  --auth   Also delete local Better Auth users, sessions, and accounts.
  --state  Remove apps/worker/.wrangler/state after D1 cleanup.
  --yes    Skip confirmation prompt.
  --help   Show this help.

Default behavior only deletes local canvas business data:
  canvas_task, canvas, canvas_project
EOF
}

CLEAN_AUTH=0
CLEAN_STATE=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --auth)
      CLEAN_AUTH=1
      ;;
    --state)
      CLEAN_STATE=1
      ;;
    --yes|-y)
      ASSUME_YES=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

SQL='
DELETE FROM "canvas_task";
DELETE FROM "canvas";
DELETE FROM "canvas_project";
'

if [[ "$CLEAN_AUTH" -eq 1 ]]; then
  SQL+='
DELETE FROM "session";
DELETE FROM "account";
DELETE FROM "user";
'
fi

echo "This will clean LOCAL Wrangler D1 database: $DB_NAME"
echo
echo "Tables:"
echo "  - canvas_task"
echo "  - canvas"
echo "  - canvas_project"
if [[ "$CLEAN_AUTH" -eq 1 ]]; then
  echo "  - session"
  echo "  - account"
  echo "  - user"
fi
if [[ "$CLEAN_STATE" -eq 1 ]]; then
  echo
  echo "It will also remove: apps/worker/.wrangler/state"
fi
echo

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Continue? Type 'yes' to proceed: " confirmation
  if [[ "$confirmation" != "yes" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

cd "$WORKER_DIR"

echo "Cleaning local D1 data..."
pnpm exec wrangler d1 execute "$DB_NAME" --local --command "$SQL"

if [[ "$CLEAN_STATE" -eq 1 ]]; then
  echo "Removing local Wrangler state..."
  rm -rf "$WORKER_DIR/.wrangler/state"
fi

echo "Re-applying local D1 migrations..."
pnpm db:migrate:local

echo "Done."
