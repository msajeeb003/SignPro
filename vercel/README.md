# Deploying SignPro to Vercel

This folder contains everything needed to deploy SignPro's frontend and backend to Vercel, with a hosted PostgreSQL database and blob storage.

> **TL;DR:** Frontend deploys cleanly as a Vite SPA. The backend deploys as a single Vercel Serverless Function wrapping the Express app. You'll need a hosted Postgres (Neon, Vercel Postgres, or Supabase) and Vercel Blob storage for uploads.

---

## Architecture on Vercel

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  Frontend (Vite SPA)        │     │  Backend (Serverless)        │
│  app.signpro.example.com    │ ──> │  api.signpro.example.com    │
│  Static + SPA routing       │     │  /api/* → Express handler   │
└─────────────────────────────┘     └────────────┬─────────────────┘
                                                 │
                              ┌──────────────────┼──────────────────┐
                              │                  │                  │
                       ┌──────▼──────┐    ┌──────▼──────┐    ┌─────▼──────┐
                       │  Postgres   │    │ Vercel Blob │    │   Twilio    │
                       │  (Neon /    │    │  (uploads)  │    │   + SMTP    │
                       │   Vercel PG)│    │             │    │  providers  │
                       └─────────────┘    └─────────────┘    └─────────────┘
```

**Two separate Vercel projects** (recommended): one for the static frontend, one for the API. This keeps build times fast and lets you scale them independently.

---

## Prerequisites

| Service              | Purpose                                  | Notes                                              |
| -------------------- | ---------------------------------------- | -------------------------------------------------- |
| Vercel account       | Hosting                                  | Free tier works for testing                        |
| Postgres database    | App data                                 | Recommended: **Neon** (free) or **Vercel Postgres**|
| Vercel Blob          | Document storage                         | Required - serverless filesystems are ephemeral    |
| SMTP credentials     | Email delivery                           | Gmail app password, SendGrid, AWS SES, Postmark    |
| Twilio account       | SMS delivery (optional)                  | Sandbox numbers work for testing                   |
| Vercel CLI           | Local deploy + env management            | `npm install -g vercel`                            |

---

## One-time setup

### 1. Provision the database

Pick one of these:

**Option A: Neon (recommended, free tier)**
```bash
# 1. Sign up at https://neon.tech
# 2. Create a project named "signpro"
# 3. Copy the connection string (looks like: postgres://user:pass@ep-xxx.us-east-2.aws.neon.tech/signpro?sslmode=require)
```

**Option B: Vercel Postgres**
```bash
vercel login
vercel postgres create signpro-db
# Vercel will auto-inject DATABASE_URL when you link this project
```

Then apply the schema:
```bash
psql "$DATABASE_URL" < ../backend/src/db/schema.sql
```

### 2. Provision Vercel Blob

```bash
vercel blob create signpro-uploads
# Copy the BLOB_READ_WRITE_TOKEN it outputs
```

### 3. Generate production secrets

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Run three times - one each for JWT_SECRET, REFRESH_TOKEN_SECRET, SIGNATURE_HMAC_SECRET
```

---

## Deploying the backend

```bash
cd vercel/backend
npm install
vercel link        # creates a new project named e.g. "signpro-api"
vercel env pull    # syncs env vars locally
# Set all required env vars - see .env.production.example
./set-env.sh       # or set them manually in the Vercel dashboard
vercel --prod
```

After the first deploy, copy the production URL (e.g. `https://signpro-api.vercel.app`) - the frontend and extension will need it.

### Environment variables to set in Vercel (Settings → Environment Variables)

| Variable                  | Value                                                          |
| ------------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`            | Your Neon/Vercel Postgres connection string                    |
| `PG_SSL`                  | `true`                                                         |
| `JWT_SECRET`              | 64+ random chars                                               |
| `REFRESH_TOKEN_SECRET`    | 64+ random chars (different from JWT_SECRET)                   |
| `SIGNATURE_HMAC_SECRET`   | 32+ random chars (different again)                             |
| `BLOB_READ_WRITE_TOKEN`   | From `vercel blob create`                                      |
| `FRONTEND_URL`            | `https://app.signpro.example.com` (your frontend domain)       |
| `API_BASE_URL`            | `https://api.signpro.example.com` (this deployment's domain)   |
| `SMTP_HOST`               | e.g. `smtp.gmail.com`                                          |
| `SMTP_PORT`               | e.g. `587`                                                     |
| `SMTP_USER`               | Your SMTP username                                             |
| `SMTP_PASS`               | Your SMTP password                                             |
| `SMTP_FROM_NAME`          | `SignPro`                                                      |
| `SMTP_FROM_ADDRESS`       | `no-reply@yourdomain.com`                                      |
| `TWILIO_ACCOUNT_SID`      | (Optional) Twilio SID                                          |
| `TWILIO_AUTH_TOKEN`       | (Optional) Twilio token                                        |
| `TWILIO_PHONE_NUMBER`     | (Optional) E.164 number                                        |
| `LOG_LEVEL`               | `info`                                                         |
| `NODE_ENV`                | `production`                                                   |

---

## Deploying the frontend

```bash
cd vercel/frontend
npm install
vercel link        # creates a new project named "signpro-app"
vercel env add VITE_API_URL production
# Enter your backend URL when prompted (e.g. https://signpro-api.vercel.app)
vercel --prod
```

### Custom domain (optional)

In Vercel dashboard → Project → Domains: add `app.signpro.example.com` (and `api.signpro.example.com` to the backend project). Vercel auto-provisions SSL.

---

## Browser extension

The extension still loads unpacked from `extension/` - update its `host_permissions` in `manifest.json` to your production URLs before publishing to the Chrome Web Store:

```json
"host_permissions": [
  "https://api.signpro.example.com/*"
]
```

---

## Files in this folder

| Path                                | Purpose                                           |
| ----------------------------------- | ------------------------------------------------- |
| `backend/vercel.json`               | Backend Vercel build/runtime config               |
| `backend/api/index.js`              | Serverless function entry that wraps Express     |
| `backend/package.json`              | Backend deps + Vercel build script                |
| `backend/.env.production.example`   | Required env vars                                 |
| `backend/storage-adapter.js`        | Drop-in replacement for filesystem uploads → Blob |
| `frontend/vercel.json`              | Frontend SPA config (rewrites, headers)           |
| `frontend/package.json`             | Frontend deps (mirrors main `frontend/`)          |
| `scripts/migrate.sh`                | Run schema migration against your remote Postgres |
| `scripts/set-env.sh`                | Bulk-set Vercel env vars from a .env file         |

---

## Limitations to know about

- **Serverless function timeout**: Vercel's free/hobby tier limits functions to 10s. PDF parsing of large documents can exceed this. Solutions:
  - Upgrade to Pro (60s timeout)
  - Move parsing to a background queue (e.g. Inngest, Trigger.dev, QStash)
  - Pre-parse on upload using a streaming worker

- **Stateful uploads**: Vercel functions have an ephemeral filesystem. All uploads are streamed directly to Vercel Blob via `backend/storage-adapter.js`. Do not write to `/tmp` for persistence.

- **Database connections**: Serverless functions create one DB connection per invocation. Use a connection pooler (Neon has one built in; for Vercel Postgres use `@vercel/postgres`).

- **Cold starts**: First request after idle period takes 1-2 seconds. Browser extension polling helps keep it warm.

- **WebSockets**: Not supported on Vercel serverless. The current polling approach for the browser extension works fine here. If you need server push later, move that endpoint to Vercel Edge Functions with Server-Sent Events.

---

## Quick deploy (one command)

After setting env vars in the dashboard:

```bash
./scripts/deploy-all.sh
```

This script:
1. Validates required env vars
2. Runs the schema migration if needed
3. Deploys the backend
4. Updates the frontend's `VITE_API_URL` to match
5. Deploys the frontend
6. Prints both production URLs

---

## Verifying the deploy

```bash
# 1. Backend health check
curl https://your-api.vercel.app/health
# Expected: {"status":"ok","database":{"healthy":true,...}}

# 2. Register a test user
curl -X POST https://your-api.vercel.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"changeme1234","full_name":"Test User"}'

# 3. Open the frontend
open https://your-app.vercel.app
```

---

## Troubleshooting

**`relation "users" does not exist`** - You forgot to run the schema migration. Run `./scripts/migrate.sh`.

**`Function exceeded 10s timeout`** - Either upgrade to Pro, or move PDF parsing to a background job. See `backend/api/index.js` comments for `maxDuration` config.

**CORS errors in the browser** - Verify `FRONTEND_URL` in the backend env exactly matches your frontend's deployed URL (no trailing slash).

**`@napi-rs/canvas not installed` warnings during PDF rendering** - Vercel's serverless runtime can install it, but it adds ~30 MB to the bundle. If you don't need page-image previews, leave it out and the API will return text-only page metadata.

**Cold-start latency** - Add a Vercel cron job that hits `/health` every 5 minutes to keep the function warm. See `vercel.json` for the cron config.
