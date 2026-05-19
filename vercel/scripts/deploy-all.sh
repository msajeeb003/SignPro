#!/usr/bin/env bash
# =============================================================================
# Deploy SignPro backend + frontend to Vercel in one go.
#
# Prerequisites:
#   - Vercel CLI installed and logged in (npm install -g vercel && vercel login)
#   - Both Vercel projects already linked (run `vercel link` in each subfolder)
#   - Env vars set in the Vercel dashboard (or via set-env.sh)
#   - DATABASE_URL set so migrations can run
# =============================================================================
set -euo pipefail

VERCEL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$VERCEL_DIR/.." && pwd)"

cyan() { printf "\033[36m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }

if ! command -v vercel >/dev/null 2>&1; then
    red "Vercel CLI not found. Install with: npm install -g vercel"
    exit 1
fi

# ---- 1. Database migration (optional) ----
if [[ -n "${DATABASE_URL:-}" ]]; then
    cyan "[1/4] Applying database schema..."
    bash "$VERCEL_DIR/scripts/migrate.sh"
else
    cyan "[1/4] Skipping migration (DATABASE_URL not set in this shell)"
    echo "    Make sure your remote DB already has the schema applied."
fi

# ---- 2. Deploy backend ----
cyan "[2/4] Deploying backend..."
cd "$VERCEL_DIR/backend"
BACKEND_URL=$(vercel --prod --yes | tail -n 1)
green "    Backend deployed: $BACKEND_URL"

# ---- 3. Update frontend env to point at backend ----
cyan "[3/4] Syncing frontend env (VITE_API_URL=$BACKEND_URL)..."
cd "$REPO_ROOT/frontend"
if [[ -f "$VERCEL_DIR/frontend/vercel.json" && ! -f "vercel.json" ]]; then
    cp "$VERCEL_DIR/frontend/vercel.json" vercel.json
fi
vercel env rm VITE_API_URL production --yes >/dev/null 2>&1 || true
printf "%s" "$BACKEND_URL" | vercel env add VITE_API_URL production --yes

# ---- 4. Deploy frontend ----
cyan "[4/4] Deploying frontend..."
FRONTEND_URL=$(vercel --prod --yes | tail -n 1)
green "    Frontend deployed: $FRONTEND_URL"

echo ""
green "✓ All deployed!"
echo ""
echo "  Frontend: $FRONTEND_URL"
echo "  Backend:  $BACKEND_URL"
echo ""
echo "Next steps:"
echo "  1. Verify: curl $BACKEND_URL/health"
echo "  2. Open the frontend, register a test user"
echo "  3. Update extension/manifest.json host_permissions to include $BACKEND_URL"
