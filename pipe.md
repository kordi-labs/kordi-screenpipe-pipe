---
schedule: every 60m
enabled: true
timeout: 600
---

# Kordi — subscription finder

You find recurring subscriptions the user is paying for by reading what's been on
their screen (billing pages, receipts, renewal banners, plan/manage-subscription
screens, checkout confirmations) and send them to Kordi, which tracks the cost and
surfaces savings.

The context header above gives you the **time range** to look at, today's **date**,
the **Screenpipe API** base (`http://localhost:3030`), and the **output directory**
(`./output/`). Use the provided time range — you are scanning only the most recent
interval, not all history.

Work through the steps below exactly. If a step says to stop, stop.

---

## Step 1 — Get the user's email (required)

Read the pipe's `.env` file (next to this file) and load `KORDI_EMAIL` and the
optional `KORDI_API` (default `https://kordiapp.com`):

```bash
set -a; [ -f .env ] && . ./.env; set +a
echo "${KORDI_EMAIL:-}"
```

- If `KORDI_EMAIL` is empty or unset, send ONE desktop notification and then **stop
  without doing anything else**:
  - title: `Kordi — set your email`
  - body: `Add KORDI_EMAIL=you@example.com to ~/.screenpipe/pipes/kordi/.env to start tracking your subscriptions.`
- **Never** guess, infer, or read the email from screen data. It comes only from
  `.env`. This is a hard rule.

---

## Step 2 — Pull billing-related screen activity

For each of these five search terms, query the Screenpipe screen text over the time
range from the context header:

`subscription`, `receipt`, `renews`, `billed`, `payment method`

```bash
curl -s "http://localhost:3030/search?q=subscription&content_type=vision&start_time=<START>&end_time=<END>&limit=50&min_length=8"
```

- Replace `<START>`/`<END>` with the ISO-8601 timestamps from the context header,
  and `q=` with each term in turn.
- `content_type=vision` only — read screen text, **never** audio.
- Each result carries the visible `text`, the `app_name`, and a `timestamp`. Collect
  the text blocks across all five queries; de-duplicate identical blocks.

If all queries come back empty, there's nothing to do — stop quietly (no notification).

---

## Step 3 — Identify subscriptions

A text block is a subscription candidate only if it BOTH (a) mentions a known service
and (b) shows a billing signal. Drop anything that doesn't clear both bars — it's
better to miss one than to invent one.

**(a) Known service.** Match case-insensitively against this catalog. Use the
**canonical** name (left column) when you report it:

| Canonical | Matches (substrings, lowercase) |
|---|---|
| Netflix | netflix |
| Hulu | hulu |
| Disney+ | disney+, disneyplus, disney plus |
| Max | hbo max, hbomax, max.com, play.max |
| Spotify | spotify |
| Apple TV+ | apple tv+, apple tv plus, appletv+ |
| Apple Music | apple music |
| YouTube Premium | youtube premium, youtube music premium |
| YouTube TV | youtube tv |
| Peacock | peacock |
| Paramount+ | paramount+, paramount plus, paramountplus |
| ESPN+ | espn+, espn plus, espnplus |
| Amazon Prime | amazon prime, prime video, prime membership |
| Starz | starz |
| AMC+ | amc+, amc plus |
| Crunchyroll | crunchyroll |
| Audible | audible |
| Adobe Creative Cloud | creative cloud, adobe cc |
| Adobe Acrobat | adobe acrobat, acrobat pro |
| Microsoft 365 | microsoft 365, office 365, microsoft365 |
| Dropbox | dropbox |
| Google One | google one |
| iCloud+ | icloud+, icloud storage |
| Notion | notion |
| ChatGPT Plus | chatgpt plus, openai plus |
| Claude Pro | claude pro |
| GitHub | github pro, github copilot, github team |
| Peloton | peloton |
| Headspace | headspace |
| Calm | calm premium |
| The New York Times | new york times, nytimes, ny times |
| The Wall Street Journal | wall street journal, wsj |

You MAY also report a clearly-named service that isn't in this list **only** if the
billing signal is unambiguous (e.g. a receipt that says "Your <Name> subscription
renews"). When in doubt, skip it.

**(b) Billing signal.** At least one of: `subscription`, `your receipt`, `renews on`,
`renewal`, `auto-renew`, `next billing`, `billed monthly`, `you've been charged`,
`manage plan`, `manage subscription`, `payment method`, `per month`, `/mo`.

**Extract the monthly amount.** Find dollar amounts (`$12.99`, `$ 9`, `USD 14.99`).
Keep only plausible monthly figures (greater than 0 and **at most 200**). If several
qualify, pick the **smallest** (the per-month figure, not an annual total). If you
can't find a plausible amount, skip the candidate — amount is required.

**Extract the billing day** (optional). If the text says e.g. "renews on the 12th" or
shows an ISO date like `2026-06-12`, record the day-of-month (1–31). Omit if unclear.

**Canonicalize the name.** Use the catalog's canonical name for catalog hits. For an
off-catalog service, trim it to a clean brand name: strip legal suffixes (Inc, LLC,
Ltd, Corp), drop URL noise (`www.`, `.com`), collapse whitespace, and title-case
ALL-CAPS words (`ADOBE` → `Adobe`) while leaving real brand styling alone
(`Disney+`, `HBO`).

Collapse duplicates by the lowercase, trimmed name (`name.toLowerCase().trim()`) —
report each service at most once, keeping the entry with the most billing signal.

---

## Step 4 — Skip anything already sent

Read `./output/kordi-seen.json` if it exists. It maps a service's lowercase-trimmed
name to the last `{amount, bill_date}` you sent. Drop any candidate whose name is
already present with the **same** amount and bill_date — Kordi already has it, and
re-sending inflates its discovery metrics. Keep candidates that are new or whose
amount/bill_date changed.

If nothing remains after this filter, stop quietly.

---

## Step 5 — Send to Kordi

POST all remaining subscriptions in a single request to the public guest-ingest
endpoint (it creates the user's account on first contact and imports the subs):

```bash
curl -s -X POST "${KORDI_API:-https://kordiapp.com}/api/guest-ingest" \
  -H "Content-Type: application/json" \
  -d '{
        "email": "<KORDI_EMAIL>",
        "source": "screenpipe",
        "subscriptions": [
          { "name": "Netflix", "amount": 15.99, "bill_date": 12 },
          { "name": "Spotify", "amount": 9.99 }
        ]
      }'
```

- `source` is always `"screenpipe"`. `bill_date` is optional (omit if unknown).
- Send at most 50 subscriptions; if you somehow have more, send the 50 with the
  strongest billing signals.
- A `200`/`201` response with `"imported": N` means success. On a non-2xx response
  (e.g. `429` rate-limit), do **not** update the seen-file — just stop; the next run
  retries.

---

## Step 6 — Record and notify

On success, write `./output/kordi-seen.json` merging in every subscription you just
sent (`{ "<lowercased name>": { "amount": <n>, "bill_date": <n or null> }, ... }`),
preserving prior entries.

Then send ONE desktop notification summarizing what happened:
- title: `Kordi synced N subscription(s)`
- body: list up to three names, then `— check your email to finish setting up Kordi.`
  (The first sync emails the user a magic link to secure their account.)

If you sent nothing this run, do not notify.
