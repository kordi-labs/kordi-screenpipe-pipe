// Known-service catalog + billing signals.
//
// The catalog mirrors the spirit of Kordi's STREAMING_SEED
// (kordiapp-backend/src/api/streamingPriceCrawler.js) plus common non-streaming
// subscriptions. It serves two purposes:
//   1. Stage-1 detection: cheaply recognize a known service in on-screen text.
//   2. Canonicalization: map render variants to one stable display name.
//
// Aliases are lowercased substrings matched against normalized screen text.
// They are intentionally specific — generic tokens (e.g. bare "max") are avoided
// so we don't false-positive on ordinary words.

export interface CatalogEntry {
  canonical: string;
  aliases: string[];
}

export const CATALOG: CatalogEntry[] = [
  { canonical: "Netflix", aliases: ["netflix"] },
  { canonical: "Hulu", aliases: ["hulu"] },
  { canonical: "Disney+", aliases: ["disney+", "disneyplus", "disney plus"] },
  { canonical: "Max", aliases: ["hbo max", "play.max", "max.com", "hbomax"] },
  { canonical: "Spotify", aliases: ["spotify"] },
  { canonical: "Apple TV+", aliases: ["apple tv+", "apple tv plus", "appletv+"] },
  { canonical: "Apple Music", aliases: ["apple music"] },
  { canonical: "YouTube Premium", aliases: ["youtube premium", "youtube music premium"] },
  { canonical: "YouTube TV", aliases: ["youtube tv"] },
  { canonical: "Peacock", aliases: ["peacock"] },
  { canonical: "Paramount+", aliases: ["paramount+", "paramount plus", "paramountplus"] },
  { canonical: "ESPN+", aliases: ["espn+", "espn plus", "espnplus"] },
  { canonical: "Amazon Prime", aliases: ["amazon prime", "prime video", "prime membership"] },
  { canonical: "Starz", aliases: ["starz"] },
  { canonical: "AMC+", aliases: ["amc+", "amc plus"] },
  { canonical: "Crunchyroll", aliases: ["crunchyroll"] },
  { canonical: "Audible", aliases: ["audible"] },
  { canonical: "Adobe Creative Cloud", aliases: ["creative cloud", "adobe cc"] },
  { canonical: "Adobe Acrobat", aliases: ["adobe acrobat", "acrobat pro"] },
  { canonical: "Microsoft 365", aliases: ["microsoft 365", "office 365", "microsoft365"] },
  { canonical: "Dropbox", aliases: ["dropbox"] },
  { canonical: "Google One", aliases: ["google one"] },
  { canonical: "iCloud+", aliases: ["icloud+", "icloud storage"] },
  { canonical: "Notion", aliases: ["notion"] },
  { canonical: "ChatGPT Plus", aliases: ["chatgpt plus", "openai plus"] },
  { canonical: "Claude Pro", aliases: ["claude pro"] },
  { canonical: "GitHub", aliases: ["github pro", "github copilot", "github team"] },
  { canonical: "Peloton", aliases: ["peloton"] },
  { canonical: "Headspace", aliases: ["headspace"] },
  { canonical: "Calm", aliases: ["calm premium"] },
  { canonical: "The New York Times", aliases: ["new york times", "nytimes", "ny times"] },
  { canonical: "The Wall Street Journal", aliases: ["wall street journal", "wsj"] },
];

/**
 * Keywords that signal a billing/subscription context. Used both as Screenpipe
 * full-text `q` query terms (a curated subset) and as a local relevance gate.
 */
export const BILLING_KEYWORDS = [
  "subscription",
  "your receipt",
  "renews on",
  "renewal",
  "auto-renew",
  "next billing",
  "billed monthly",
  "you've been charged",
  "manage plan",
  "manage subscription",
  "payment method",
  "per month",
  "/mo",
];

/**
 * Curated subset used as Screenpipe FTS query terms — kept small to respect the
 * cost of one query per term. Broad enough to catch most billing surfaces.
 */
export const BILLING_QUERY_TERMS = [
  "subscription",
  "receipt",
  "renews",
  "billed",
  "payment method",
];

// "$12.99", "$ 9", "USD 14.99" — capture the numeric amount.
const PRICE_RE = /(?:\$|\busd\s*)\s?(\d{1,4}(?:[.,]\d{1,2})?)/gi;

// A day-of-month near a renewal/billing phrase, or an ISO-ish date.
const RENEW_DAY_RE =
  /(?:renews?|next (?:charge|billing|payment)|bills?)\D{0,20}?(\d{1,2})(?:st|nd|rd|th)?\b/i;
const ISO_DATE_RE = /\b\d{4}-\d{2}-(\d{2})\b/;

export interface CatalogMatch {
  canonical: string;
  /** parsed monthly amount, if a plausible price was found near billing text */
  amount: number | null;
  /** parsed billing day-of-month, if found */
  billDay: number | null;
  /** number of billing keywords present (relevance signal) */
  signalCount: number;
}

/** True if the text contains at least one billing-context keyword. */
export function hasBillingSignal(lowerText: string): boolean {
  return BILLING_KEYWORDS.some((k) => lowerText.includes(k));
}

/**
 * Find the first known service mentioned in `text`, plus any nearby price/date.
 * Returns null when no catalog service is present.
 */
export function matchCatalog(text: string): CatalogMatch | null {
  const lower = text.toLowerCase();

  let canonical: string | null = null;
  for (const entry of CATALOG) {
    if (entry.aliases.some((a) => lower.includes(a))) {
      canonical = entry.canonical;
      break;
    }
  }
  if (!canonical) return null;

  // Best (largest plausible monthly) price — subscriptions are usually < $200/mo.
  let amount: number | null = null;
  let m: RegExpExecArray | null;
  PRICE_RE.lastIndex = 0;
  while ((m = PRICE_RE.exec(text)) !== null) {
    const val = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(val) && val > 0 && val <= 200) {
      if (amount === null || val < amount) amount = val; // prefer the monthly-looking (smaller) figure
    }
  }

  let billDay: number | null = null;
  const iso = text.match(ISO_DATE_RE);
  if (iso) {
    const d = parseInt(iso[1], 10);
    if (d >= 1 && d <= 31) billDay = d;
  }
  if (billDay === null) {
    const r = text.match(RENEW_DAY_RE);
    if (r) {
      const d = parseInt(r[1], 10);
      if (d >= 1 && d <= 31) billDay = d;
    }
  }

  const signalCount = BILLING_KEYWORDS.reduce(
    (n, k) => (lower.includes(k) ? n + 1 : n),
    0,
  );

  return { canonical, amount, billDay, signalCount };
}
