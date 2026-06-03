// The scan run: query Screenpipe for billing-context activity since the last
// run, detect subscriptions (hybrid), dedupe against local state, and push new
// or changed ones into Kordi via MCP. Shared by the cron route and the
// "run now" button.

import { pipe } from "@screenpipe/js";
import { getConfig } from "./settings";
import { loadState, saveState } from "./state";
import { detectFromText } from "./detect";
import { isOllamaUp } from "./ollama";
import { KordiClient } from "./kordi";
import { BILLING_QUERY_TERMS, hasBillingSignal, matchCatalog } from "./catalog";
import { normalizeKey } from "./normalize";
import type { DetectedSub, IngestState, ScanSummary } from "./types";

const MAX_WINDOW_MS = 24 * 60 * 60 * 1000; // never scan more than 24h in one run
const MAX_CANDIDATES = 25; // bounds LLM calls per run
const PER_TERM_LIMIT = 50;
const INGEST_DELAY_MS = 300; // gentle pacing under Kordi's 20/min MCP limit
const DAY_MS = 24 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Candidate {
  text: string;
  appName?: string;
  ts?: string;
}

export async function runScan(): Promise<ScanSummary> {
  const cfg = await getConfig();
  const now = new Date();
  const windowEnd = now.toISOString();

  if (!cfg.mcpUrl) {
    await notify(
      "Kordi — connection needed",
      "Open the Kordi pipe settings and paste your Connect link from the dashboard to start finding subscriptions.",
    );
    return summary({ ok: false, error: "missing mcpUrl", windowStart: windowEnd, windowEnd });
  }

  const state = await loadState();

  // Scan window: from last run (clamped to 24h) to now.
  let startMs = state.lastRunIso ? Date.parse(state.lastRunIso) : now.getTime() - cfg.scanIntervalMinutes * 60_000;
  if (!Number.isFinite(startMs) || now.getTime() - startMs > MAX_WINDOW_MS) {
    startMs = now.getTime() - MAX_WINDOW_MS;
  }
  const windowStart = new Date(startMs).toISOString();

  // Probe the local LLM once. Degrade gracefully when it's down.
  const ollamaUp = await isOllamaUp(cfg.ollamaUrl);
  if (!ollamaUp) {
    await maybeWarnOllama(state, now);
  }

  // Query Screenpipe per billing term and gather candidate text blocks.
  const contentType = cfg.enableAudio ? "all" : "ocr+ui";
  const seenText = new Set<string>();
  const candidates: Candidate[] = [];

  for (const term of BILLING_QUERY_TERMS) {
    let resp;
    try {
      resp = await pipe.queryScreenpipe({
        q: term,
        contentType,
        startTime: windowStart,
        endTime: windowEnd,
        limit: PER_TERM_LIMIT,
        minLength: 8,
      });
    } catch (e) {
      console.error("kordi: queryScreenpipe failed for term", term, e);
      continue;
    }
    if (!resp?.data) continue;

    for (const item of resp.data) {
      // Narrow the discriminated union to pull out text/app/timestamp.
      let cand: Candidate | null = null;
      if (item.type === "Audio") {
        if (item.content.transcription) {
          cand = { text: item.content.transcription, ts: item.content.timestamp };
        }
      } else {
        // OCR | UI — both carry text, appName, timestamp.
        if (item.content.text) {
          cand = { text: item.content.text, appName: item.content.appName, ts: item.content.timestamp };
        }
      }
      if (!cand) continue;

      // Exclude unwanted apps.
      const app = (cand.appName || "").toLowerCase();
      if (app && cfg.excludeApps.some((x) => app.includes(x))) continue;

      // Only keep billing-relevant blocks (keyword or known service present).
      const lower = cand.text.toLowerCase();
      if (!hasBillingSignal(lower) && !matchCatalog(cand.text)) continue;

      // Collapse near-identical blocks (same app + same leading text).
      const key = `${app}|${cand.text.slice(0, 120)}`;
      if (seenText.has(key)) continue;
      seenText.add(key);
      candidates.push(cand);
    }
  }

  const bounded = candidates.slice(0, MAX_CANDIDATES);

  // Detect. Keep the highest-confidence detection per normalized service name.
  const detections = new Map<string, DetectedSub>();
  for (const cand of bounded) {
    const sub = await detectFromText(cand.text, {
      useLlm: ollamaUp,
      ollamaUrl: cfg.ollamaUrl,
      ollamaModel: cfg.ollamaModel,
      appName: cand.appName,
      evidenceTs: cand.ts,
    });
    if (!sub || sub.confidence < cfg.minConfidence) continue;
    const key = normalizeKey(sub.name);
    const prev = detections.get(key);
    if (!prev || sub.confidence > prev.confidence) detections.set(key, sub);
  }

  // Ingest new / changed subscriptions.
  let ingested = 0;
  let updated = 0;
  let skipped = 0;
  const newlyIngested: DetectedSub[] = [];

  if (detections.size > 0) {
    const kordi = new KordiClient(cfg.mcpUrl);
    try {
      await kordi.connect();
      for (const [key, sub] of detections) {
        if (ingested + updated >= cfg.maxIngestsPerRun) break;

        const prev = state.seen[key];
        const unchanged = prev && prev.lastAmount === sub.amount && prev.billDate === sub.billDate;
        if (unchanged) {
          skipped++;
          continue;
        }

        const res = await kordi.ingest(sub);
        if (res.ok) {
          if (res.status === "updated") updated++;
          else ingested++;
          state.seen[key] = { lastSeenIso: windowEnd, lastAmount: sub.amount, billDate: sub.billDate };
          newlyIngested.push(sub);
        } else {
          console.error("kordi: ingest failed for", sub.name, res.error);
          skipped++;
        }
        await sleep(INGEST_DELAY_MS);
      }
    } catch (e) {
      console.error("kordi: MCP connect/ingest error", e);
    } finally {
      await kordi.close();
    }
  }

  state.lastRunIso = windowEnd;
  await saveState(state);

  if (newlyIngested.length > 0) {
    const names = newlyIngested.slice(0, 3).map((s) => s.name).join(", ");
    const more = newlyIngested.length > 3 ? ` +${newlyIngested.length - 3} more` : "";
    await notify(
      `Kordi found ${newlyIngested.length} subscription${newlyIngested.length > 1 ? "s" : ""}`,
      `${names}${more} — now tracked in Kordi.`,
    );
  }

  return summary({
    ok: true,
    scanned: bounded.length,
    detected: detections.size,
    ingested,
    updated,
    skipped,
    ollamaUsed: ollamaUp,
    windowStart,
    windowEnd,
  });
}

async function maybeWarnOllama(state: IngestState, now: Date): Promise<void> {
  const last = state.lastOllamaWarnIso ? Date.parse(state.lastOllamaWarnIso) : 0;
  if (now.getTime() - last < DAY_MS) return; // throttle to ~once/day
  state.lastOllamaWarnIso = now.toISOString();
  await notify(
    "Kordi — running in basic mode",
    "Ollama isn't reachable, so Kordi is only catching known services. Start Ollama to detect subscriptions beyond the built-in list.",
  );
}

async function notify(title: string, body: string): Promise<void> {
  try {
    await pipe.sendDesktopNotification({ title, body });
  } catch (e) {
    console.error("kordi: notification failed", e);
  }
}

function summary(p: Partial<ScanSummary> & { ok: boolean; windowStart: string; windowEnd: string }): ScanSummary {
  return {
    ok: p.ok,
    scanned: p.scanned ?? 0,
    detected: p.detected ?? 0,
    ingested: p.ingested ?? 0,
    updated: p.updated ?? 0,
    skipped: p.skipped ?? 0,
    ollamaUsed: p.ollamaUsed ?? false,
    windowStart: p.windowStart,
    windowEnd: p.windowEnd,
    error: p.error,
  };
}
