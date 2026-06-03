# Kordi Subscription Finder (Screenpipe pipe)

A [Screenpipe](https://screenpi.pe) pipe that discovers subscriptions from your
on-screen activity — billing pages, receipts, renewal banners, in-app signups —
and pushes them into [Kordi](https://kordiapp.com), which then tracks cost,
flags price changes, and can pause/resume them.

It is **complementary to Kordi's email-based discovery (Qira)**: that catches
subscriptions in your inbox; this catches the ones that only ever show up on
screen.

## How it works

```
Screenpipe (local screen/audio history)
        │  pipe.queryScreenpipe({ q: billing terms, contentType: "ocr+ui" })
        ▼
  detection (hybrid)
    1. regex/catalog prefilter  ── known services + price/date  (always on)
    2. local Ollama extraction  ── arbitrary services           (when reachable)
        │  { name, amount, billDate }  above a confidence threshold
        ▼
  local dedupe state  ── skip services already sent (normalized name key)
        │  MCP tools/call
        ▼
  Kordi  →  kordi_ingest_subscription({ ..., source: "screenpipe" })
```

- **Hybrid detection** ([`src/lib/detect.ts`](src/lib/detect.ts)): a cheap
  catalog/regex pass ([`src/lib/catalog.ts`](src/lib/catalog.ts)) recognizes
  known services and prices; a local Ollama call
  ([`src/lib/ollama.ts`](src/lib/ollama.ts)) then extracts arbitrary/niche
  services as strict JSON.
- **Graceful degradation**: if Ollama isn't running, the pipe falls back to
  catalog-only detection and shows a once-a-day desktop notification. It never
  hard-fails because the LLM is down.
- **Dedupe** ([`src/lib/state.ts`](src/lib/state.ts)): already-sent services are
  remembered (keyed by the *same* normalization Kordi's MCP tool uses —
  `name.toLowerCase().trim()`) so local state and Kordi's server-side dedupe
  agree. Re-sends only happen when the amount or bill date changes.
- **Ingest** ([`src/lib/kordi.ts`](src/lib/kordi.ts)): connects to your Kordi
  `/mcp` endpoint and calls `kordi_ingest_subscription` with
  `source: "screenpipe"`, pacing calls under Kordi's 20/min MCP rate limit.

## Prerequisites

- **Screenpipe** installed and running (provides the `localhost:3030` API the
  `@screenpipe/js` SDK talks to).
- **A Kordi Connect link.** In the Kordi dashboard: **Connect Screenpipe →
  Generate Connection Link**, then copy the `…/mcp?token=screenpipe_…` URL.
- **Ollama** (optional but recommended) for detecting services beyond the
  built-in catalog. The pipe defaults its model/URL from Screenpipe's own AI
  settings when you run native Ollama.

## Install & run (development)

```bash
npm install
npm run dev      # serves the config UI + cron routes (Next.js)
npm run typecheck
npm run build
```

Then install it into Screenpipe via the Pipe Store, or point Screenpipe at this
folder / its GitHub URL.

## Configuration

Open the pipe UI and set:

| Field | Default | Notes |
|---|---|---|
| Kordi Connect link | — | required; the `/mcp?token=…` URL from the dashboard |
| Ollama model / URL | from Screenpipe AI settings, else `llama3.2` / `http://localhost:11434` | local extraction |
| Scan every (minutes) | 60 | also the cron cadence (`pipe.json`) |
| Min confidence | 0.6 | below this, detections are ignored |
| Exclude apps | — | comma-separated app-name substrings to never scan |
| Scan audio | off | opt-in; scans audio transcripts too |

Settings persist in Screenpipe's settings store (namespaces `kordi` /
`kordi_state`). The cron schedule lives in [`pipe.json`](pipe.json).

## Privacy

Screenpipe scrubs sensitive data (card numbers, etc.) **before** storage. This
pipe only ever reads a **service name, amount, and billing date** — never card
details — and sends only those three fields to Kordi. Excluded apps are never
scanned. Audio scanning is off unless you turn it on.

## Manual runtime test

A full run needs the Screenpipe desktop app (this can't run headless in CI):

1. `npm run dev` with Screenpipe running.
2. Open a known billing page (e.g. your Netflix or Spotify account page) so it
   enters Screenpipe's history.
3. In the pipe UI, paste your Connect link and click **Run scan now**.
4. Confirm the status line reports `ingested ≥ 1`, and that the subscription
   appears in your Kordi dashboard. A `discover` event tagged `source:screenpipe`
   should also land in Kordi's `subscription_events` table.

## Backend contract

This pipe relies on the Kordi backend changes in
`feature/screenpipe-backend-ingestion`:

- `kordi_ingest_subscription` accepts `source: "screenpipe"` and logs a
  `discover` event to the card-network proof layer.
- `POST /api/connect-token` mints the revocable, MCP-scoped token embedded in
  the Connect link.

## Notes

- `npm audit` may report transitive advisories pulled in by Next.js 14; the
  flagged Next.js issue itself is patched (pinned to the latest 14.2.x). Re-run
  `npm audit` before publishing and bump as needed.
- The model is asked for strict JSON (`format: "json"`); malformed or
  low-confidence extractions are dropped rather than ingested.
