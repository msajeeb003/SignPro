# SignPro Browser Extension (Manifest V3)

Companion Chrome extension for the SignPro signing platform. Polls the API for pending signature requests and surfaces desktop notifications when documents are ready to sign.

## Files

| File              | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `manifest.json`   | MV3 manifest, permissions, CSP                             |
| `background.js`   | Service worker - polling, notifications, message routing   |
| `popup.{html,js,css}` | Toolbar popup with pending signatures                  |
| `options.{html,js,css}` | Settings page - API URL, token, polling interval     |
| `icons/`          | Icon set (16/32/48/128) - replace with branded versions    |

## Install (development)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the SignPro icon to your toolbar.
5. Generate an extension token at `<your-signpro-dashboard>/settings/extension`.
6. Click the SignPro toolbar icon → **Settings** → enter API URL + frontend URL + token → **Connect**.

## How it works

- A `chrome.alarms` schedule fires every N minutes (default 1) → service worker calls `GET /api/webhooks/extension/poll`.
- Server returns pending signature requests + recent notifications.
- New requests trigger a `chrome.notifications.create` with action buttons.
- Clicking "Sign Now" opens the signing URL in a new tab.
- The action badge shows the pending-count.

## Permissions used

- `storage` - persist session (via `chrome.storage.sync`) and dedup state (via `chrome.storage.local`)
- `notifications` - show signature request alerts
- `alarms` - reliable background polling without keeping the SW alive

## Host permissions

Edit `host_permissions` in `manifest.json` to add your production API URL before publishing:

```json
"host_permissions": [
  "https://api.signpro.example.com/*"
]
```

## Packaging for the Chrome Web Store

```bash
cd extension
# Bump version in manifest.json
zip -r ../signpro-extension-1.0.0.zip . -x "README.md" "*.DS_Store"
```

Upload the zip to https://chrome.google.com/webstore/devconsole.
