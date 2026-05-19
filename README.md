# Handoff: SignPro Design System

## Overview

A complete design system for SignPro, the electronic-signature platform for legally binding documents. This bundle contains two visual directions and a full UI kit, intended to live alongside the existing codebase at [`msajeeb003/SignPro`](https://github.com/msajeeb003/SignPro).

The package documents:
1. **The current visual language**, reverse-engineered from `frontend/src/styles.css` — primary blue `#2563eb`, system sans, 6 px corners, flat utility look.
2. **A "Luxe" reskin** — an editorial alternative using Instrument Serif + parchment/ink/brass, intended for premium/marketing surfaces or as a possible product redesign direction.

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly.

The task is to **recreate these HTML designs in the SignPro target codebase** (React + Vite + react-router) using its established patterns. The utility variant *already lives* in the codebase — these files largely mirror what's there. The Luxe variant is a *proposed* direction; if you implement it, do so as a theme variant rather than a wholesale replacement (keep the utility look behind a feature flag or build-time switch).

## Fidelity

**High-fidelity.** Pixel-perfect mockups with final colors, typography, spacing, and interactions. Implement them using the existing React component patterns in `frontend/src/`, lifting the exact tokens from `colors_and_type.css` (utility) or `colors_and_type-luxe.css` (luxe).

## Repository placement

Drop the entire `design_handoff_signpro_design_system/` folder into the SignPro repo root, then move/rename:

```
SignPro/
├── design-system/                    ← rename "design_handoff_..." to this
│   ├── README.md                     ← full system documentation
│   ├── SKILL.md                      ← Agent-Skills entry
│   ├── colors_and_type.css
│   ├── colors_and_type-luxe.css
│   ├── assets/
│   ├── preview/                      ← 24 reviewable design cards
│   └── ui_kits/webapp/
└── frontend/                         ← (existing)
```

Commit message suggestion: `design: add design system + luxe variant (#design-system)`.

---

## Screens / Views

### A. Utility kit (default — codebase-faithful)

Five views forming a click-thru: **Login → Dashboard → Upload → Document detail → Sign**.

#### A.1 Login
- **Purpose:** Sender authentication.
- **Layout:** Centered card on `--bg` page (`#f9fafb`). Card 400 px wide, `padding: 32px`, `border-radius: 8px`, `border: 1px solid #e5e7eb`, `box-shadow: 0 1px 3px rgba(0,0,0,0.05)`. Form stacks `email`, `password`, `Sign in` primary button (full-width, `padding: 12px 24px`). Below form: "Don't have an account? Register" at `font-size: 13px`, color `#6b7280`.
- **Source:** `ui_kits/webapp/pages/LoginPage.jsx` (proto) ↔ `frontend/src/pages/LoginPage.jsx` (real).

#### A.2 Dashboard
- **Purpose:** Sender lists, filters, and opens documents.
- **Layout:** Top nav (12 / 24 padding, 1 px hairline bottom). Main content max-width 1200 px, 32 / 24 padding. Page header: `h1` 24 / 600 + primary action right (`Upload Document`). Status `<select>` filter. Documents `<table>`: uppercase 12 / 600 column headers on `#f9fafb`, 13 px rows, 12 px cell padding, hairline row dividers, status as **`.status status-{state}` pill** (11 / 600, 10 % tint background, 12 px radius).
- **States:** filter is client-only; row click opens `/documents/:id`.

#### A.3 Upload
- **Purpose:** PDF/DOCX file picker + title.
- **Layout:** Form (max-width 600 px) with title input, file picker row, auto-parse checkbox, progress bar (8 px, primary fill, 0.2 s transition), Cancel / Upload buttons right-aligned.
- **Constraints (real):** 25 MB max, 500 pages max — display in `.meta` line under the h1.

#### A.4 Document detail
- **Purpose:** Inspect a document, see signature requests, send for signature, void.
- **Layout:** Page header with back link, h1 title, meta line (`PDF · 4 pages · uploaded May 14`), and action cluster (`Download`, `Send for signature` (primary), `Void document` (danger)). Signature-requests card uses a 4-column grid `(name+email) (status pill) (timestamp muted) (actions)`. Page-preview grid 200 px cards with `aspect-ratio: 8.5/11`.
- **"Send for signature" modal:** dark scrim (`rgba(0,0,0,0.5)`), 600 px modal, 8 px radius. Recipient `<fieldset>` blocks with legend; add/remove buttons are `.btn-link`. Footer: Cancel + primary "Send to N recipients".

#### A.5 Sign (public)
- **Purpose:** Recipient draws signature, accepts consent, submits.
- **Layout:** No nav (full-bleed). Header band with title, sender line, blockquote message (3 px left border `--primary`). Body is a 2-col grid `1fr 320–340 px`. Left: document page (white paper, hairline border, `shadow-page`), with a `.field-overlay` (2 px dashed `--primary`, 8 % tint) at the signature spot. Right sticky sidebar: numbered field list, signature canvas (300×120), consent checkbox row, full-width primary "Submit signature".
- **Complete state:** swap to centered "Document signed" card with success-green h1, evidence hash + ID in `<code>`.

### B. Luxe variant (editorial)

Same product information architecture, different visual register. One HTML file (`index-luxe.html`) renders the **Dashboard** and **Sign page** with a Tweaks panel for live palette + serif swap.

#### B.1 Luxe Dashboard
- **Top bar:** 3-col grid (nav links left, brand center, account right). Brand `Sign<em>Pro</em>` — "Pro" italic in `--luxe-brass`. Active nav link gets a 1 px brass underline.
- **Hero:** Editorial. Left: eyebrow caps "DOCUMENTS · TUESDAY, MAY 19", a 72 px serif headline with italic-brass emphasis ("Three documents <em>await</em> your countersign."), lede paragraph in `--luxe-ink-2`. Right: 2×2 stats grid where each value uses 44 px Instrument Serif with italic numerals.
- **Filter strip:** Inline tab list with italic-brass counts; right-aligned search input with underline-only styling.
- **Document rows:** No table chrome. Each row is `46% / 1fr / 1fr / 1fr / auto`, 24 px vertical padding, hairline divider. Title is 22 px serif Roman. Parties is 17 px serif italic ink-2. Signer avatars are 28 px circles with initials, signed ones use the green tint, current user uses brass. Status is `<span class="lstatus {state}">` — small serif italic with a 6 px dot before it. "Open →" right-aligned in serif italic.

#### B.2 Luxe Sign page
- **Layout:** `1fr 380 px` 2-col grid, 56 px gap. Left: doc title 56 px serif with italic-brass emphasis, sender line, italic-serif quote with brass left rule. Below that the **paper card** (`--luxe-paper`, 1 px rule, `box-shadow: 0 24px 48px -24px rgba(20,17,14,0.15)`, 56/64 padding). The paper renders the NDA body in serif Roman, centered uppercase title with 0.08em tracking, justified text. A signature line sits absolutely at the bottom with a script-font name on a 1 px ink underline + uppercase caps label.
- **Right (sticky 32 px top) sign panel:** caps label + italic "Three steps remain." h2. Step list with Roman-numeral indices in italic serif (`i`, `ii`, `iii`) — green when done. Signature canvas (`--luxe-paper` bg, 1 px rule, 2 px ink bottom border, ink 2.2 px stroke). Consent with italic-brass opening quote mark. Brass full-width submit. Footer caps: "Bound by HMAC · SHA-256 chained".

#### B.3 Luxe Footer
- Three-column caps strip: brand line · compliance badges · encryption note. 28 / 56 padding, hairline top.

---

## Interactions & Behavior

### Utility kit
- All navigation is `react-router` (`useNavigate`, `<Link>`). The prototype's `view` state corresponds 1:1 to real routes.
- Status filter is a `<select>` posting `?status=` query — server-side filtered.
- Send-for-signature modal: ESC closes; clicking scrim closes; on submit `POST /api/signatures/requests` with body `{ document_id, recipients: [...], message, coordinates: [...] }`.
- Signature canvas: `react-signature-canvas` in real, hand-rolled `<canvas>` in the proto. Output is a PNG data URL stored in `signature_evidence`.
- Hover / focus: never opacity. Color shifts and 3 px focus ring `0 0 0 3px rgba(37,99,235,0.10)` everywhere a control can be focused.

### Luxe kit
- **Tweaks panel** controls 3 things via `useTweaks()`:
  - `palette` — one of `warm | ink | sage | blush` → applies `.palette-{name}` class to `<html>`, which redefines `--luxe-*` CSS vars.
  - `serif` — display family. Loads from Google Fonts on demand. Updates `--luxe-serif`.
  - `view` — `dashboard | sign`. Drives view switch.
- **Row hover** on dashboard: background `rgba(232, 223, 200, 0.4)`, 120 ms ease.
- **Sign canvas:** DPR-aware (multiplies `canvas.width` by `devicePixelRatio`, scales context). Stroke color reads `--luxe-ink` from `getComputedStyle(document.documentElement)` so it reflects palette changes.
- **Submit button:** brass background, disabled until canvas has strokes AND consent checked.

---

## State Management

### Utility kit
- `useAuth()` context (in `frontend/src/services/auth.jsx`) — `{ user, loading, login, logout }`.
- Page-local `useState` for documents list, modal open, signature data.
- Server is source of truth; client refetches on filter change.

### Luxe kit
- `useTweaks({palette, serif, view})` for theme + view state, persists via `__edit_mode_set_keys` postMessage.
- Local `useState` for `hasSig` and `consent` on the sign view.

---

## Design Tokens

### Utility (`colors_and_type.css`)

```
Colors
  --primary        #2563eb     primary CTA, link, focus
  --primary-hover  #1d4ed8     button :hover
  --success        #16a34a     completed / signed
  --warning        #f59e0b     pending
  --danger         #dc2626     declined / void
  --bg             #f9fafb     app background
  --card           #ffffff     surface
  --border         #e5e7eb     1 px hairline
  --text           #111827     primary text
  --text-secondary #6b7280     secondary
  --text-tertiary  #9ca3af     placeholder

Semantic tints
  10% of any color = pill/banner fill
  30% of any color = banner border

Type (Geist substitute for native system stack)
  h1 24 / 600 / 1.25 / -0.01em
  h2 20 / 600 / 1.30 / -0.005em
  h3 16 / 600 / 1.40
  body 14 / 400 / 1.50
  sm 13 / 400
  xs 12 / 500 (labels)
  overline 12 / 600 uppercase 0.04em tracking
  pill 11 / 600 uppercase 0.04em tracking
  mono 12 (Geist Mono / SF Mono)

Spacing (4 px grid)  4 · 8 · 12 · 16 · 20 · 24 · 32 · 48
Radii                4 (sm) · 6 (default) · 8 (md) · 12 (pill)
Shadows
  shadow-card   0 1px 3px rgba(0,0,0,0.05)   auth + complete cards
  shadow-page   0 1px 3px rgba(0,0,0,0.04)   document pages
  shadow-focus  0 0 0 3px rgba(37,99,235,0.10)
```

### Luxe (`colors_and_type-luxe.css`)

```
Ink scale
  --luxe-ink        #14110E   primary text
  --luxe-ink-2      #3A352D   secondary
  --luxe-ink-3      #6E6657   tertiary, caps

Paper scale (default "warm")
  --luxe-cream      #F4ECD8   app background
  --luxe-paper      #FBF8EF   card / surface
  --luxe-bone       #E8DFC8   hover ground
  --luxe-rule       #D8CFB5   hairline

Accent
  --luxe-brass      #A07E3C   primary accent
  --luxe-brass-deep #7E602B   hover

Semantic
  --luxe-seal-green #2D4A36   signed / completed
  --luxe-seal-red   #7A2A1E   declined / void
  --luxe-amber      #B5853F   pending

Alternate palettes (apply class to html / body)
  .palette-ink   — dark mode (cream #0E0F12, brass #D4A24C, …)
  .palette-sage  — forest accent #3D5A3D
  .palette-blush — rust accent  #9C4F3C

Type
  display  72 px Instrument Serif 400, lh 1.04, tracking -0.015em
  h1       48 px Instrument Serif 400, italic for emphasis
  h2       28 px Instrument Serif
  h3       18 px Geist 500
  body     15 px Geist 400 / 1.55
  small    13 px Geist
  caption  11 px Geist 500 uppercase, 0.18em tracking
  mono     13 px JetBrains Mono

Geometry
  radius        2 px (sharper than utility)
  rule width    1 px
  shadow-lift   0 24px 48px -24px rgba(20,17,14,0.15)   modal-feel cards
```

---

## Assets

| File | Purpose | Source |
|---|---|---|
| `assets/wordmark.svg` | Text "SignPro" wordmark | Generated; replace with real wordmark if you have one |
| `assets/badge.svg` | Solid blue "S" badge (favicon, extension icon) | Generated placeholder; the repo README notes the extension icons are placeholder solid-blue squares |

The codebase has **no icon set** of its own. For mocks the Luxe kit substitutes nothing — text glyphs only. Utility kit recommends **Lucide** via CDN at 1.5 px stroke if icons are needed.

**Fonts** are loaded from Google Fonts in `colors_and_type.css` (Geist + Geist Mono) and `colors_and_type-luxe.css` (Instrument Serif + Geist + JetBrains Mono). If you need offline fonts, mirror these into `frontend/public/fonts/` and switch the `@import` to `@font-face`.

---

## Files in this bundle

```
design_handoff_signpro_design_system/
├── README.md                       ← this file
├── SKILL.md                        ← Agent-Skills metadata (works in Claude Code)
├── colors_and_type.css             ← utility tokens
├── colors_and_type-luxe.css        ← luxe tokens
├── assets/
│   ├── wordmark.svg
│   └── badge.svg
├── preview/                        ← 24 review cards (colors, type, spacing, components, brand) for both variants
└── ui_kits/webapp/
    ├── README.md
    ├── index.html                  ← utility kit click-thru
    ├── index-luxe.html             ← luxe kit (single HTML w/ tweaks panel)
    ├── tweaks-panel.jsx
    ├── components.jsx              ← utility kit shared components
    └── pages/
        ├── LoginPage.jsx
        ├── DashboardPage.jsx
        ├── UploadPage.jsx
        ├── DocumentDetailPage.jsx
        └── SignPage.jsx
```

---

## Implementation notes for Claude Code

1. **Start with the utility kit** — it mirrors what's already in `frontend/src/`, so the diff is mostly token extraction. Pull the tokens from `colors_and_type.css` into a new file at `frontend/src/styles/tokens.css` and `@import` it from `frontend/src/styles.css`. Replace literal hex values throughout `styles.css` with `var(--…)`.
2. **Use the Luxe variant as a theme**, not a rewrite. Wrap it with a `[data-theme="luxe"]` selector at `<html>`. Build a tiny `ThemeSwitcher` in the Settings page that toggles `data-theme`. The Luxe palette tweaks already work via class names — keep that pattern.
3. **Speaker for the team:** the Luxe kit adds *Templates* and *Audit log* nav entries that don't have backing screens. Either build them or remove them from the nav for now.
4. **Verify accessibility:** brass on cream is ~3.7:1 — fine for large text and UI elements, **not** AA for body text. Body text must remain ink (`#14110E`) on cream (`#F4ECD8`) which is 14.5:1. Don't let brass creep into body copy.
5. **Open the prototypes locally** before implementing: `cd ui_kits/webapp && python3 -m http.server 8080` then visit `http://localhost:8080/index-luxe.html`. The Tweaks panel won't appear without a host shell, but you can hard-code the `palette-*` class on `<html>` to compare palettes.

The source-of-truth GitHub project is [`msajeeb003/SignPro`](https://github.com/msajeeb003/SignPro). When you push, target a feature branch (e.g. `design/design-system`) and open a PR — let a human flip the theme switch before merging.
