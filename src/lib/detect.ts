// Hybrid detection: turn a snippet of on-screen text into a DetectedSub.
//
//   Stage 1 (always): regex/catalog match — cheap, deterministic.
//   Stage 2 (when enabled & reachable): local Ollama extraction — catches
//            arbitrary/niche services the catalog misses.
//
// Graceful degradation: the LLM availability probe happens once per run (in
// scan.ts) and is passed in as `useLlm`. When the LLM is off/unavailable we
// fall back to a catalog-only result, and only ingest a catalog hit that has a
// clean price (Kordi requires a positive amount).

import { matchCatalog, hasBillingSignal } from "./catalog";
import { ollamaExtract } from "./ollama";
import { cleanName, clampBillDay } from "./normalize";
import type { DetectedSub } from "./types";

export interface DetectOptions {
  useLlm: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  appName?: string;
  evidenceTs?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

export async function detectFromText(
  text: string,
  opts: DetectOptions,
): Promise<DetectedSub | null> {
  const lower = text.toLowerCase();
  const cat = matchCatalog(text);
  const billing = hasBillingSignal(lower);

  // Stage 2 — LLM extraction. Only bother when there's a billing context or a
  // known service in view, to keep compute down.
  if (opts.useLlm && (cat || billing)) {
    const raw = await ollamaExtract(opts.ollamaUrl, opts.ollamaModel, text);
    if (raw && raw.is_subscription && raw.name && Number(raw.monthly_amount) > 0) {
      // Prefer the catalog's canonical name when we recognized the service.
      const name = cat ? cat.canonical : cleanName(String(raw.name));
      const amount = round2(Number(raw.monthly_amount));
      const billDate = clampBillDay(raw.bill_day ?? cat?.billDay ?? 1);
      const confidence = clamp01(Number(raw.confidence ?? 0.7));
      if (name && amount > 0) {
        return { name, amount, billDate, confidence, via: "llm", appName: opts.appName, evidenceTs: opts.evidenceTs };
      }
    }
    // LLM enabled but produced nothing usable → fall through to catalog-only.
  }

  // Stage 1 fallback — catalog-only. Require a clean price to ingest.
  if (cat && cat.amount && cat.amount > 0) {
    const confidence = cat.signalCount >= 2 ? 0.65 : 0.55;
    return {
      name: cat.canonical,
      amount: round2(cat.amount),
      billDate: clampBillDay(cat.billDay ?? 1),
      confidence,
      via: "catalog",
      appName: opts.appName,
      evidenceTs: opts.evidenceTs,
    };
  }

  return null;
}
