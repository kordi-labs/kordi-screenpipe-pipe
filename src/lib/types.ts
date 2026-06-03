// Shared types for the Kordi Screenpipe pipe.

/** A subscription detected from on-screen evidence, ready to push into Kordi. */
export interface DetectedSub {
  /** Canonical display name sent to Kordi (e.g. "Netflix"). */
  name: string;
  /** Monthly billing amount in USD. */
  amount: number;
  /** Billing day of month (1–31). */
  billDate: number;
  /** 0–1 confidence the detection is a real recurring subscription. */
  confidence: number;
  /** Which stage produced it. */
  via: "catalog" | "llm";
  /** App the evidence came from, when known. */
  appName?: string;
  /** ISO timestamp of the screen evidence. */
  evidenceTs?: string;
}

/** User-facing pipe configuration (persisted in Screenpipe settings, namespace "kordi"). */
export interface KordiConfig {
  /** Kordi API base (default https://kordiapp.com) — used for the signup call. */
  kordiBase: string;
  /** Full Kordi MCP URL incl. token. Empty until the user signs up / connects. */
  mcpUrl: string;
  /** How far back each scan looks / how often the cron runs, in minutes. */
  scanIntervalMinutes: number;
  /** Opt-in: also scan audio transcripts (off by default — privacy). */
  enableAudio: boolean;
  /** App names to never scan (lowercased substrings). */
  excludeApps: string[];
  /** Base URL of the local Ollama server (native API, no /v1). */
  ollamaUrl: string;
  /** Ollama model used for extraction. */
  ollamaModel: string;
  /** Minimum confidence required to ingest. */
  minConfidence: number;
  /** Safety cap on ingest calls per run (respects Kordi's 20/min MCP limit). */
  maxIngestsPerRun: number;
}

/** One previously-ingested service, keyed by normalized name. */
export interface SeenEntry {
  lastSeenIso: string;
  lastAmount: number;
  billDate: number;
}

/** Runtime state persisted between runs (Screenpipe settings, namespace "kordi_state"). */
export interface IngestState {
  /** End of the last scan window; next scan starts here. */
  lastRunIso: string | null;
  /** normalizedName -> last ingest we sent, to avoid re-pushing unchanged subs. */
  seen: Record<string, SeenEntry>;
  /** Last time we warned the user Ollama was unreachable (throttle to ~1/day). */
  lastOllamaWarnIso: string | null;
}

/** Summary returned by a scan run (for the API response / logs). */
export interface ScanSummary {
  ok: boolean;
  scanned: number;
  detected: number;
  ingested: number;
  updated: number;
  skipped: number;
  ollamaUsed: boolean;
  windowStart: string;
  windowEnd: string;
  error?: string;
}
