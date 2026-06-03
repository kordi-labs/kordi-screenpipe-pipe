// Minimal direct client for a local Ollama server.
//
// We call Ollama's native HTTP API directly (rather than via an SDK) for two
// reasons: precise control over the availability probe (so we can degrade
// gracefully when it's down), and zero extra dependencies. The model is asked
// for strict JSON via the `format: "json"` option.

const PROBE_TIMEOUT_MS = 2000;
const GENERATE_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** True if a local Ollama server answers /api/tags quickly. */
export async function isOllamaUp(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: "GET" }, PROBE_TIMEOUT_MS);
    return res.ok;
  } catch {
    return false;
  }
}

/** Raw, unvalidated extraction from the model. Validated/clamped by the caller. */
export interface RawExtraction {
  is_subscription?: boolean;
  name?: string;
  monthly_amount?: number;
  bill_day?: number;
  confidence?: number;
}

const SYSTEM = [
  "You extract recurring subscription billing facts from a snippet of on-screen text.",
  "Only treat it as a subscription if the text clearly shows a recurring charge",
  "(a service name AND a recurring price or a renewal/billing date).",
  "Return STRICT JSON with keys:",
  '  is_subscription (boolean), name (string, the service brand only),',
  "  monthly_amount (number, USD per month; convert annual to monthly if needed),",
  "  bill_day (integer 1-31, the day of month it renews; 0 if unknown),",
  "  confidence (number 0-1).",
  "If it is not a subscription, return {\"is_subscription\": false, \"confidence\": 0}.",
].join(" ");

/**
 * Ask the local model to extract one subscription from `text`.
 * Returns null on any transport/parse failure (caller falls back to catalog).
 */
export async function ollamaExtract(
  baseUrl: string,
  model: string,
  text: string,
): Promise<RawExtraction | null> {
  const prompt = `${SYSTEM}\n\nON-SCREEN TEXT:\n"""\n${text.slice(0, 4000)}\n"""\n\nJSON:`;
  try {
    const res = await fetchWithTimeout(
      `${baseUrl}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: false, format: "json", options: { temperature: 0 } }),
      },
      GENERATE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { response?: string };
    if (!body.response) return null;
    return JSON.parse(body.response) as RawExtraction;
  } catch {
    return null;
  }
}
