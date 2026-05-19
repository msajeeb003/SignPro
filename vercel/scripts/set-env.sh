#!/usr/bin/env bash
# =============================================================================
# Bulk-import environment variables to a Vercel project.
#
# Usage:
#   cd vercel/backend
#   cp .env.production.example .env.production
#   # edit .env.production with real values
#   ../scripts/set-env.sh .env.production production
#
# Args:
#   $1: path to env file (default: .env.production)
#   $2: vercel environment - development | preview | production (default: production)
# =============================================================================
set -euo pipefail

ENV_FILE="${1:-.env.production}"
TARGET="${2:-production}"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: env file not found: $ENV_FILE" >&2
    exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
    echo "Error: Vercel CLI not installed. Run: npm install -g vercel" >&2
    exit 1
fi

echo "Importing env vars from $ENV_FILE -> Vercel ($TARGET)..."
echo ""

while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"
        value="${value%\"}"
        value="${value#\"}"
        if [[ "$value" == *"REPLACE_WITH"* || "$value" == "" ]]; then
            echo "  ⚠ Skipping $key (placeholder value, edit your env file)"
            continue
        fi
        echo "  Setting $key..."
        printf "%s" "$value" | vercel env add "$key" "$TARGET" --yes 2>/dev/null \
            || vercel env rm "$key" "$TARGET" --yes >/dev/null 2>&1 \
            && printf "%s" "$value" | vercel env add "$key" "$TARGET" --yes
    fi
done < "$ENV_FILE"

echo ""
echo "✓ Done. Verify with: vercel env ls $TARGET"
