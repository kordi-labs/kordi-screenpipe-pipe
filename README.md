# Kordi Subscription Finder (Screenpipe pipe)

A [Screenpipe](https://screenpi.pe) pipe that discovers subscriptions from your
on-screen activity — billing pages, receipts, renewal banners, in-app signups —
and tracks them in [Kordi](https://kordiapp.com). **No Kordi account is needed
to start:** scan your screen, see what you're paying, then create an account in
one step if you want it tracked.

Complementary to Kordi's email-based discovery (Qira): that catches
subscriptions in your inbox; this catches the ones that only show up on screen.

## The flow

```
1. Scan my screen        → local audit: "N subscriptions · $X/mo"   (no account)
2. Create my account     → POST email to Kordi /api/guest-ingest
                           → account created, subs imported, magic link emailed
3. (ongoing) hourly cron → syncs new/changed subs via MCP
```

- **Audit (no account):** `POST /api/audit` runs `collectDetections()` over the
  last 7 days and returns the findings + monthly total. This is the hook.
- **Signup:** `POST /api/signup` sends your email + the found subs to Kordi's
  public `/api/guest-ingest`. Kordi creates a free account, imports the subs,
  returns a token (persisted here so the cron can keep syncing), and emails a
  "secure your account" link.
- **Ongoing sync:** once connected, the hourly cron (`pipe.json` →
  `/api/scan`) detects and pushes new/changed subs via the MCP
  `kordi_ingest_subscription` tool (`source: "screenpipe"`), paced under
  Kordi's 20/min limit.

## Detection (hybrid)

[`src/lib/detect.ts`](src/lib/detect.ts): a cheap regex/catalog prefilter
([`catalog.ts`](src/lib/catalog.ts)) recognizes known services + prices, then a
local Ollama call ([`ollama.ts`](src/lib/ollama.ts)) extracts arbitrary/niche
services as strict JSON. If Ollama isn't running, the pipe falls back to
catalog-only detection (and says so in the UI / a once-a-day notification) — it
never hard-fails because the LLM is down. Dedupe ([`state.ts`](src/lib/state.ts))
is keyed exactly like Kordi's server (`name.toLowerCase().trim()`).

## Prerequisites

- **Screenpipe** installed and running (provides the `localhost:3030` API).
- **An email** — that's the whole signup. (No pre-existing Kordi account.)
- **Ollama** (optional, recommended) for services beyond the built-in catalog.
  Defaults its model/URL from Screenpipe's own AI settings when you run native
  Ollama.

## Install & run (development)

```bash
npm install
npm run dev        # config UI + cron/audit/signup routes (Next.js)
npm run typecheck
npm run build
```

Install into Screenpipe via the Pipe Store, or point Screenpipe at this folder /
its GitHub URL.

## Configuration

| Field | Default | Notes |
|---|---|---|
| Kordi API base | `https://kordiapp.com` | where signup posts; point at a preview env for testing |
| Ollama model / URL | from Screenpipe AI settings, else `llama3.2` / `http://localhost:11434` | local extraction |
| Sync every (minutes) | 60 | also the cron cadence (`pipe.json`) |
| Min confidence | 0.6 | below this, detections are ignored |
| Exclude apps | — | comma-separated app-name substrings to never scan |
| Scan audio | off | opt-in; scans audio transcripts too |

The connection token (`mcpUrl`) is set **automatically** after signup; you don't
paste anything. Settings persist in Screenpipe's settings store (namespaces
`kordi` / `kordi_state`).

## Privacy

Screenpipe scrubs sensitive data (card numbers, etc.) **before** storage. This
pipe reads only a **service name, amount, and billing date** — never card
details — and sends only those (plus your email, on signup) to Kordi. Excluded
apps are never scanned; audio scanning is off unless you turn it on.

## Manual runtime test

Needs the Screenpipe desktop app (can't run headless):

1. `npm run dev` with Screenpipe running.
2. Open a known billing page (e.g. your Netflix/Spotify account page).
3. Click **Scan my screen** → confirm it lists the subscription(s) and a total.
4. Enter an email → **Create my Kordi account & sync** → confirm "Synced N…",
   that the account appears in Kordi, and that you receive the verify email. In
   Kordi's DB the new user has `acquisition_source = 'screenpipe'`,
   `verified = 0` (until you click the link), and a `discover` event per sub.

## Backend contract

Relies on the Kordi backend `feature/screenpipe-backend-ingestion` branch:
`POST /api/guest-ingest` (public shadow-account signup), `GET /api/verify-account`
(magic link), the `kordi_ingest_subscription` MCP tool (`source:'screenpipe'`),
and the `verified` / `acquisition_source` columns (migration `0004`).

## Notes

- `npm audit` may report transitive advisories from Next.js 14; the flagged
  Next.js issue itself is patched (pinned to the latest 14.2.x). Re-run before
  publishing.
- Model output is requested as strict JSON; malformed / low-confidence
  extractions are dropped rather than ingested.
