# Kordi — Subscription Finder (Screenpipe pipe)

A [Screenpipe](https://screenpi.pe) pipe that finds the subscriptions you're paying
for by reading what's been on your screen — billing pages, receipts, renewal banners,
"manage plan" screens — and tracks them in [Kordi](https://kordiapp.com), which shows
you what each one costs and where you can save.

No Kordi account needed up front: set your email, and the first sync creates your
account and emails you a link to secure it.

Complementary to Kordi's email-based discovery (Qira): that catches subscriptions in
your inbox; this catches the ones that only ever show up on screen.

## How it works

This is a single [`pipe.md`](pipe.md) — a scheduled prompt that Screenpipe runs with a
local coding agent. Every hour the agent:

1. reads your `KORDI_EMAIL` from `.env`,
2. queries the last hour of **screen** text for billing activity (never audio),
3. identifies subscriptions — a known service **and** a billing signal, with the
   monthly amount and billing day,
4. skips anything it already sent (`./output/kordi-seen.json`),
5. POSTs the new/changed ones to Kordi's public `POST /api/guest-ingest`,
6. notifies you, and — on the first sync — Kordi emails you a link to finish setup.

There's no UI and no build step. The agent *is* the detector; the catalog of known
services and the extraction rules live in the prompt.

## Setup

1. **Set your email.** This is the only configuration, and it's required:

   ```bash
   echo "KORDI_EMAIL=you@example.com" > ~/.screenpipe/pipes/kordi/.env
   # optional: point at a non-prod backend
   # echo "KORDI_API=https://preview.kordiapp.com" >> ~/.screenpipe/pipes/kordi/.env
   ```

   The agent never guesses your identity from the screen — your email comes only from
   this file. If it's missing, the pipe notifies you and does nothing.

2. **Install & enable:**

   ```bash
   bunx screenpipe pipe install <this repo path or GitHub URL>
   bunx screenpipe pipe enable kordi
   ```

3. **Try it now** (optional): open a billing page (your Netflix/Spotify account), then

   ```bash
   bunx screenpipe pipe run kordi
   bunx screenpipe pipe logs kordi
   ```

After that it runs hourly on its own (`schedule: every 60m` in the frontmatter).

## Privacy

- Reads **screen text only** — audio is never queried.
- The only things that leave your machine are, per subscription, a **service name, a
  monthly amount, and a billing day**, plus the email you put in `.env`. Never card
  numbers, account details, or screenshots.
- Detection runs locally inside Screenpipe's agent; Kordi only ever receives that
  small JSON payload.

## Backend contract

Talks to the Kordi backend (live at `kordiapp.com`):

- `POST /api/guest-ingest` — public shadow-account signup + subscription import
  (`source: "screenpipe"`); idempotent, dedupes by name, rate-limited per IP.
- `GET /api/verify-account` — the magic link from the first-sync email.
- Columns `verified` / `acquisition_source` (migration `0004`) track the
  Screenpipe → verified-user funnel.

## Notes

- The `pipe.md` caps monthly amounts at $200 and requires both a known service and a
  billing keyword before reporting anything — it errs toward missing a subscription
  rather than inventing one.
- Re-detections are suppressed via `./output/kordi-seen.json` so a billing page you
  leave open doesn't get re-sent every hour.
