// Typed access to the pipe's configuration, persisted in Screenpipe's settings
// store under the custom namespace "kordi". Defaults for the local LLM are
// derived from Screenpipe's own AI config when the user runs native Ollama.

import { pipe } from "@screenpipe/js";
import type { KordiConfig } from "./types";

const NS = "kordi";

const DEFAULTS: KordiConfig = {
  mcpUrl: "",
  scanIntervalMinutes: 60,
  enableAudio: false,
  excludeApps: [],
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  minConfidence: 0.6,
  maxIngestsPerRun: 10,
};

function str(v: unknown, dflt: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : dflt;
}
function num(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : dflt;
}
function bool(v: unknown, dflt: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return dflt;
}
function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(",")
      .map((x) => x.toLowerCase().trim())
      .filter(Boolean);
  }
  return [];
}

/** Strip an OpenAI-compat "/v1" suffix so we can hit Ollama's native API. */
export function ollamaBase(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "");
}

async function deriveOllamaDefaults(): Promise<{ url: string; model: string }> {
  try {
    const all = await pipe.settings.getAll();
    if (all?.aiProviderType === "native-ollama") {
      return {
        url: ollamaBase(str(all.aiUrl, DEFAULTS.ollamaUrl)),
        model: str(all.aiModel, DEFAULTS.ollamaModel),
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return { url: DEFAULTS.ollamaUrl, model: DEFAULTS.ollamaModel };
}

export async function getConfig(): Promise<KordiConfig> {
  let ns: Record<string, unknown> = {};
  try {
    ns = (await pipe.settings.getNamespaceSettings(NS)) ?? {};
  } catch {
    ns = {};
  }
  const derived = await deriveOllamaDefaults();
  return {
    mcpUrl: str(ns.mcpUrl, DEFAULTS.mcpUrl),
    scanIntervalMinutes: Math.max(5, num(ns.scanIntervalMinutes, DEFAULTS.scanIntervalMinutes)),
    enableAudio: bool(ns.enableAudio, DEFAULTS.enableAudio),
    excludeApps: arr(ns.excludeApps),
    ollamaUrl: ollamaBase(str(ns.ollamaUrl, derived.url)),
    ollamaModel: str(ns.ollamaModel, derived.model),
    minConfidence: Math.min(1, Math.max(0, num(ns.minConfidence, DEFAULTS.minConfidence))),
    maxIngestsPerRun: Math.max(1, num(ns.maxIngestsPerRun, DEFAULTS.maxIngestsPerRun)),
  };
}

// Loose by design: callers may pass excludeApps as a comma-string; getConfig()
// coerces every field on read, so we persist whatever shape comes in.
export async function saveConfig(partial: Record<string, unknown>): Promise<void> {
  await pipe.settings.updateNamespaceSettings(NS, partial);
}

export { DEFAULTS as CONFIG_DEFAULTS };
