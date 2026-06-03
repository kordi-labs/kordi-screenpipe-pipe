// Detection + sync.
//
//  - collectDetections(): query Screenpipe + hybrid-detect + dedupe for a time
//    window. Needs NO Kordi account — powers the local "audit" shown before
//    signup, and feeds the signup payload.
//  - runScan(): the connected path (cron / "sync now"). Calls collectDetections,
//    then pushes new/changed subs into Kordi via MCP and tracks dedupe state.

import { pipe } from "@screenpipe/js";
import { getConfig } from "./settings";
import { loadState, saveState } from "./state";
import { detectFromText } from "./detect";
import { isOllamaUp } from "./ollama";
import { KordiClient } from "./kordi";
import { BILLING_QUERY_TERMS, hasBillingSignal, matchCatalog } from "./catalog";
import { normalizeKey } from "./normalize";
import type { DetectedSub, IngestState, KordiConfig, ScanSummary } from "./types";

const MAX_WINDOW_MS = 24 * 60 * 60 * 1000; // connected runs never scan >24h at once
export const AUDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // on-demand audit looks back 7d
const MAX_CANDIDATES = 25; // bounds LLM calls per run
const PER_TERM_LIMIT = 50;
const INGEST_DELAY_MS = 300; // gentle pacing under Kordi's 20/min MCP limit
const DAY_MS = 24 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Candidate {
  text: string;
  appName?: string;
  ts?: string;
}

export interface DetectionResult {
  detections: DetectedSub[];
  scanned: number;
  totalMonthly: number;
  ollamaUsed: boolean;
}

/**
 * Query Screenpipe for billing-context activity in [windowStart, windowEnd],
 * run hybrid detection, and return the deduped subscriptions above the
 * confidence threshold. No Kordi account/token required.
 */
export async function collectDetections(
  cfg: KordiConfig,
  windowStart: string,
  windowEnd: string,
): Promise<DetectionResult> {
  const ollamaUp = await isOllamaUp(cfg.ollamaUrl);
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

      const app = (cand.appName || "").toLowerCase();
      if (app && cfg.excludeApps.some((x) => app.includes(x))) continue;

      const lower = cand.text.toLowerCase();
      if (!hasBillingSignal(lower) && !matchCatalog(cand.text)) continue;

      const key = `${app}|${cand.text.slice(0, 120)}`;
      if (seenText.has(key)) continue;
      seenText.add(key);
      candidates.push(cand);
    }
  }

  const bounded = candidates.slice(0, MAX_CANDIDATES);

  // Keep the highest-confidence detection per normalized service name.
  const map = new Map<string, DetectedSub>();
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
    const prev = map.get(key);
    if (!prev || sub.confidence > prev.confidence) map.set(key, sub);
  }

  const detections = [...map.values()];
  const totalMonthly = round2(detections.reduce((s, d) => s + d.amount, 0));
  return { detections, scanned: bounded.length, totalMonthly, ollamaUsed: ollamaUp };
}

/** Connected path: detect, then sync new/changed subs into Kordi via MCP. */
export async function runScan(): Promise<ScanSummary> {
  const cfg = await getConfig();
  const now = new Date();
  const windowEnd = now.toISOString();

  if (!cfg.mcpUrl) {
    await notify(
      "Kordi — not connected",
      "Scan your screen and create a Kordi account from the pipe settings to start tracking subscriptions.",
    );
    return summary({ ok: false, error: "not connected", windowStart: windowEnd, windowEnd });
  }

  const state = await loadState();

  // Scan window: from last run (clamped to 24h) to now.
  let startMs = state.lastRunIso ? Date.parse(state.lastRunIso) : now.getTime() - cfg.scanIntervalMinutes * 60_000;
  if (!Number.isFinite(startMs) || now.getTime() - startMs > MAX_WINDOW_MS) {
    startMs = now.getTime() - MAX_WINDOW_MS;
  }
  const windowStart = new Date(startMs).toISOString();

  const { detections, scanned, ollamaUsed } = await collectDetections(cfg, windowStart, windowEnd);
  if (!ollamaUsed) await maybeWarnOllama(state, now);

  let ingested = 0;
  let updated = 0;
  let skipped = 0;
  const newlyIngested: DetectedSub[] = [];

  if (detections.length > 0) {
    const kordi = new KordiClient(cfg.mcpUrl);
    try {
      await kordi.connect();
      for (const sub of detections) {
        if (ingested + updated >= cfg.maxIngestsPerRun) break;

        const key = normalizeKey(sub.name);
        const prev = state.seen[key];
        if (prev && prev.lastAmount === sub.amount && prev.billDate === sub.billDate) {
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
      `Kordi synced ${newlyIngested.length} subscription${newlyIngested.length > 1 ? "s" : ""}`,
      `${names}${more} — now tracked in Kordi.`,
    );
  }

  return summary({
    ok: true,
    scanned,
    detected: detections.length,
    ingested,
    updated,
    skipped,
    ollamaUsed,
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
