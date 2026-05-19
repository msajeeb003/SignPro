# SignPro - Legal Document Signing Platform

Production-grade electronic signature platform for legally binding documents (NDAs, contracts, agreements) with PDF/DOCX support, multi-channel delivery (SMTP + Twilio SMS), tamper-evident audit trails, and a companion Manifest V3 browser extension for real-time signing notifications.

## Architecture

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   React App      │────│  Express API     │────│   PostgreSQL     │
│  (Vite, port     │    │  (Node 20,       │    │   (schema +      │
│   3000)          │    │   port 4000)     │    │   audit chain)   │
└──────────────────┘    └────────┬─────────┘    └──────────────────┘
                                 │
                  ┌──────────────┼──────────────────┐
                  │              │                  │
            ┌─────▼─────┐  ┌─────▼─────┐    ┌──────▼──────┐
            │  SMTP     │  │  Twilio   │    │  Browser    │
            │  (any)    │  │  (SMS)    │    │  Extension  │
            └───────────┘  └───────────┘    │  (MV3)      │
                                            └─────────────┘
```

## Project Layout

```
SignPro/
├── backend/                     # Node.js + Express API
│   ├── src/
│   │   ├── config/              # DB + env config
│   │   ├── db/schema.sql        # PostgreSQL schema (all tables, indexes, triggers)
│   │   ├── middleware/          # auth, rate limiting, error handling
│   │   ├── routes/              # API route handlers
│   │   ├── services/            # Business logic (parsing, signing, email, SMS)
│   │   └── utils/               # crypto, logger, validators
│   ├── Dockerfile
│   └── package.json
├── frontend/                    # React (Vite) - signing UI, dashboard
│   ├── src/{pages,services}
│   └── package.json
├── extension/                   # Chrome MV3 browser extension
│   ├── manifest.json
│   ├── background.js            # Service worker - polling, notifications
│   ├── popup.{html,js,css}      # Toolbar popup
│   └── options.{html,js,css}    # Settings page
└── docker-compose.yml
```

## Step 1: Database & Backend

### Database schema highlights (`backend/src/db/schema.sql`)

| Table                      | Purpose                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| `users`                    | Accounts, hashed passwords, MFA fields, lockout tracking               |
| `user_sessions`            | Refresh-token records with HMAC hashes and device info                 |
| `smtp_configurations`      | Per-user SMTP settings with AES-256-GCM encrypted credentials          |
| `documents`                | PDFs/DOCXs with hash, page count, dimensions, status state-machine    |
| `signature_requests`       | Per-recipient signing tokens, expiry, sign metadata, verification codes|
| `signature_coordinates`    | Field placements (x/y/width/height) on each page                       |
| `signature_evidence`       | Cryptographic proof: signed-doc hash + HMAC + consent + IP + UA + geo  |
| `audit_trails`             | Immutable append-only log with hash-chained entries                    |
| `notification_logs`        | Email/SMS/extension delivery records with retries                      |
| `extension_tokens`         | Long-lived hashed tokens for browser-extension polling                 |
| `webhook_subscriptions`    | Outbound webhooks for third-party integrations                         |

All tables auto-update `updated_at`; the `audit_trails` table has a `BEFORE UPDATE OR DELETE` trigger that raises an exception so audit data is provably append-only. Indexes cover the hot paths (status filters, signer lookups, polling).

### API Routes

#### Authentication (`/api/auth`)
- `POST /register` - Create account
- `POST /login` - Email/password, returns JWT + refresh token; lockout after 10 failed attempts
- `POST /refresh` - Rotate access token
- `POST /logout` - Revoke session
- `GET  /me` - Current user
- `POST /extension-token` - Mint a 90-day token for the browser extension
- `DELETE /extension-token/:id` - Revoke an extension token

#### Documents (`/api/documents`)
- `POST /upload` - Multipart upload (PDF/DOCX, max 25 MB); auto-parses
- `POST /:id/parse` - Re-parse on demand
- `GET  /` - List documents
- `GET  /:id` - Document detail + signature requests
- `GET  /:id/pages` - Rendered page images + metadata
- `GET  /:id/download?variant=signed|original` - Download
- `DELETE /:id` - Void document
- `GET  /:id/history` - Audit trail

#### Signatures (`/api/signatures`)
- `POST /requests` - Create signature requests with coordinate fields and dispatch
- `GET  /session/:token` - Load a signing session (public, token-gated)
- `GET  /session/:token/pages` - Get rendered pages for signer
- `POST /session/:token/complete` - Submit signature + values + consent
- `POST /session/:token/decline` - Decline to sign
- `POST /:id/resend` - Resend email/SMS for a pending request
- `DELETE /:id` - Cancel a pending request
- `POST /verify` - Verify signed document integrity via HMAC

#### SMTP (`/api/smtp`)
- `GET /` - List user's SMTP configurations
- `POST /` - Create (auto-verifies the connection by default)
- `PUT /:id` - Update
- `POST /:id/test` - Send a real test email
- `POST /:id/set-default` - Set default config
- `DELETE /:id` - Remove

#### SMS (`/api/sms`)
- `POST /send` - Send an arbitrary SMS via Twilio
- `POST /signature-request/:id` - Send signature SMS for an existing request

#### Webhooks - Extension & external (`/api/webhooks`)
- `GET  /extension/poll` - Browser extension polls here (extension token auth)
- `POST /extension/notifications/read` - Mark notifications read
- `POST /extension/heartbeat` - Keepalive for connection state
- `POST /twilio/status` - Twilio delivery callback
- `POST /email/bounce` - Generic email bounce webhook
- `GET/POST /subscriptions` - Manage outbound webhooks

#### Notifications (`/api/notifications`)
- `GET /` - List notifications for current user
- `GET /unread-count` - Badge counter
- `POST /:id/read` - Mark single notification read

### Environment Configuration

Copy `backend/.env.example` to `backend/.env`. Key variables:

```env
DATABASE_URL=postgresql://signpro:signpro_password@localhost:5432/signpro
JWT_SECRET=...                  # >= 32 chars, randomly generated
SIGNATURE_HMAC_SECRET=...       # >= 32 chars, separate from JWT
SMTP_HOST=smtp.gmail.com
SMTP_USER=you@example.com
SMTP_PASS=your_app_password
TWILIO_ACCOUNT_SID=ACxxxxxx...
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+15551234567
```

## Step 2: Document Ingestion & Rendering

`backend/src/services/pdfParser.js` and `docxParser.js` handle ingestion:

- **PDF**: `pdf-lib` parses metadata + dimensions; `pdfjs-dist` extracts text; an optional canvas backend (`@napi-rs/canvas` or `canvas`) renders each page to base64 PNG. If no canvas backend is installed, parsing still succeeds with text/metadata only and the frontend shows a placeholder.
- **DOCX**: `mammoth` extracts text + HTML, then `pdf-lib` generates a paginated intermediate PDF (with proper word-wrap and heading detection). The intermediate PDF feeds back into the PDF pipeline for rendering and signing.

The parser returns a unified structure:
```js
{
  pageCount: 5,
  pages: [{ pageNumber, width, height, rotation, textContent, renderedBase64 }],
  metadata: { title, author, ... },
  fullText: '...',
  isEncrypted: false,
  fileSize: 12345
}
```

### Error handling

| Code              | Cause                                             | HTTP |
| ----------------- | ------------------------------------------------- | ---- |
| `PDF_ENCRYPTED`   | Password-protected PDF (rejected with clear msg)  | 422  |
| `PDF_CORRUPTED`   | Malformed PDF stream                              | 422  |
| `PDF_EMPTY`       | Zero pages                                        | 422  |
| `PDF_TOO_LARGE`   | > 500 pages                                       | 422  |
| `DOCX_CORRUPTED`  | Invalid zip / signature                           | 422  |
| `DOCX_EMPTY`      | No extractable text                               | 422  |
| `UNSUPPORTED_FORMAT` | MIME type not in allowlist                    | 415  |
| `FILE_TOO_LARGE`  | Exceeds `MAX_FILE_SIZE_MB`                        | 413  |

### Coordinate system

The signing UI uses **top-left origin** (web convention). Fields are stored with `page_width`/`page_height` so they can be scaled to any rendering size. When embedding signatures into the final PDF, `signatureService.embedSignaturesIntoPdf` converts to pdf-lib's bottom-left origin: `pdfY = pageHeight - y - height`. This keeps the frontend simple while producing visually correct signed PDFs.

## Step 3: Browser Extension (Manifest V3)

`extension/manifest.json` declares minimum permissions (`storage`, `notifications`, `alarms`) and a strict CSP. The extension consists of:

- **`background.js`** (service worker): Holds the session, registers a `chrome.alarms` polling schedule (default 1 min), calls `/api/webhooks/extension/poll`, deduplicates notifications via `chrome.storage.local`, updates the action badge, and handles notification clicks (open signing URL in a new tab).
- **`popup.{html,js,css}`**: Toolbar popup listing pending signature requests with one-click "Sign now" buttons. Shows connection state, last-poll time, and a refresh button. Speaks to the background via `chrome.runtime.sendMessage`.
- **`options.{html,js,css}`**: Setup page where the user pastes their API URL, frontend URL, and extension token. Verifies the credentials by hitting `/api/webhooks/extension/heartbeat` before saving the session.

### Storage strategy
- `chrome.storage.sync` for the session blob (token + URLs) - syncs across the user's signed-in browsers.
- `chrome.storage.local` for poll state and deduplication keys - kept local-only because it's large/volatile.

### Security
- The extension token is stored via `chrome.storage.sync` (encrypted by Chrome's profile sync).
- All API calls include `X-SignPro-Extension: 1` and `Authorization: Bearer <token>`.
- The CSP forbids inline scripts and remote script loading: `script-src 'self'; object-src 'none'`.
- Rate limiting on the server (`extensionPollLimiter`) caps polls at 30/min per token.

### Installing the extension

1. Generate placeholder icons (already provided as solid blue squares; replace `extension/icons/icon-*.png` with branded versions).
2. `chrome://extensions` → **Developer mode** → **Load unpacked** → select `extension/`.
3. Open the SignPro dashboard → Settings → Browser Extension → **Generate Token** → copy.
4. Click the extension icon → Settings → enter API URL, frontend URL, paste token → **Connect**.

## Setup & Run

### Quick start (Docker)

```bash
git clone <repo> && cd SignPro
cp backend/.env.example backend/.env  # edit JWT_SECRET, SMTP, Twilio
docker-compose up --build
```

The schema is applied automatically on first run via the `01-schema.sql` mount.

### Manual setup

```bash
# 1. PostgreSQL
createdb signpro
psql signpro < backend/src/db/schema.sql

# 2. Backend
cd backend
cp .env.example .env  # edit secrets
npm install
npm run dev           # http://localhost:4000

# 3. Frontend (separate terminal)
cd ../frontend
npm install
npm run dev           # http://localhost:3000

# 4. Extension - load extension/ unpacked at chrome://extensions
```

### Generating production secrets

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Use the output for `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, and `SIGNATURE_HMAC_SECRET` (three different values).

### Optional: enable PDF page rendering

Server-side PDF rendering requires a canvas backend. Without one, parsing still works (text/metadata) but page previews are unavailable.

```bash
cd backend
npm install @napi-rs/canvas    # recommended - prebuilt binaries, no native deps
# OR
npm install canvas             # requires cairo/pango on the host
```

## Security Notes

- **Passwords**: bcrypt with 12 rounds (configurable via `BCRYPT_ROUNDS`).
- **Tokens**: JWT for short-lived access (24h), HS256. Refresh tokens are stored hashed (HMAC) in `user_sessions` so a DB leak doesn't grant access.
- **SMTP credentials**: AES-256-GCM encryption at rest using `SIGNATURE_HMAC_SECRET` (use a dedicated key in production).
- **Signature integrity**: Each signed document gets a SHA-256 hash and an HMAC over `(request_id|document_id|hash|signer_email)`. The HMAC is exposed for third-party verification via `POST /api/signatures/verify`.
- **Audit chain**: Each `audit_trails` row's `chain_hash` is `SHA-256(prev_chain_hash || event_payload)`, making post-hoc tampering detectable.
- **CSP**: Helmet configured with strict CSP, frame-ancestors `'none'`, and a strict CORS allowlist (web app origin + chrome-extension://).
- **Rate limits**: 200 req / 15 min global, 10 auth attempts / 15 min, 50 uploads / hour, 30 extension polls / min.
- **Input validation**: `express-validator` on every mutating route; signature field coordinates validated against the document's page dimensions.

## Testing the flow end-to-end

1. Register two accounts (`alice@example.com` and `bob@example.com`).
2. As Alice, upload an NDA PDF.
3. Send for signature to Bob with coordinate `{ page_number: 1, x: 100, y: 600, width: 200, height: 60 }`.
4. Bob receives an email (and SMS if a phone is on the request). If Bob's browser has the extension installed and connected, a desktop notification appears within 1 minute.
5. Bob opens the signing URL, draws his signature, accepts consent, submits.
6. Alice receives an "X signed Y" extension notification on her next poll.
7. Either party can download the signed PDF; the embedded HMAC can be verified through `POST /api/signatures/verify`.

## License

Internal / proprietary - adjust before publication.
