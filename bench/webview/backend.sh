#!/usr/bin/env bash
set -euo pipefail

: "${PYTHON:?}" "${BENCH_TMP:?}" "${API_PORT:?}" "${WEB_ORIGIN:?}"
BENCH_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$BENCH_DIR/../.." && pwd)"

mkdir -p "$BENCH_TMP/home" "$BENCH_TMP/storage" "$BENCH_TMP/repos"
export HOME="$BENCH_TMP/home"
export DESKTOP_MODE=true
export ENVIRONMENT=development
export SECRET_KEY="bench-secret-key-0123456789abcdef0123456789"
export DATABASE_URL="sqlite+aiosqlite:///$BENCH_TMP/agentrove.db"
export STORAGE_PATH="$BENCH_TMP/storage"
export ALLOWED_ORIGINS="$WEB_ORIGIN"
export ACCESS_TOKEN_EXPIRE_MINUTES=1440
export ADMIN_EMAIL="${ADMIN_EMAIL:-bench@example.com}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-bench-password-123}"
export PORT="$API_PORT"
export PYTHONDONTWRITEBYTECODE=1

cd "$REPO_ROOT/backend"
case "${1:-}" in
  seed)
    "$PYTHON" migrate.py
    "$PYTHON" seed_data.py
    PYTHONPATH="$REPO_ROOT/backend" "$PYTHON" "$BENCH_DIR/seed_fixtures.py" \
      --repo "$REPO_ROOT" --work-dir "$BENCH_TMP/repos" --out "$BENCH_TMP/fixture.json"
    ;;
  serve)
    PYTHONPATH="$REPO_ROOT/mcp-server" exec "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" \
      --workers 1 --log-level warning
    ;;
  *)
    echo "usage: backend.sh seed|serve" >&2
    exit 2
    ;;
esac
