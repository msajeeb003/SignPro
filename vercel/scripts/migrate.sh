#!/usr/bin/env bash
# =============================================================================
# Apply the SignPro schema to a remote Postgres (Neon, Vercel Postgres, etc.)
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/migrate.sh
#
# Or with .env.production:
#   set -a && source ./backend/.env.production && set +a
#   ./scripts/migrate.sh
# =============================================================================
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "Error: DATABASE_URL is not set" >&2
    echo "Hint: export DATABASE_URL=postgres://... or source your .env.production first" >&2
    exit 1
fi

SCHEMA_PATH="$(dirname "$0")/../../backend/src/db/schema.sql"
if [[ ! -f "$SCHEMA_PATH" ]]; then
    echo "Error: schema not found at $SCHEMA_PATH" >&2
    exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
    echo "Error: psql not found. Install PostgreSQL client tools first." >&2
    echo "  macOS:  brew install libpq && brew link --force libpq" >&2
    echo "  Ubuntu: sudo apt-get install postgresql-client" >&2
    exit 1
fi

echo "Applying schema from $SCHEMA_PATH..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SCHEMA_PATH"

echo ""
echo "✓ Schema applied successfully"
echo ""
echo "Verifying tables..."
psql "$DATABASE_URL" -c "\dt"
