// Runtime dedupe state, persisted in Screenpipe's settings store under the
// "kordi_state" namespace. Keeps the scan window incremental and avoids
// re-pushing subscriptions we've already sent (the Kordi MCP tool dedupes by
// name as a backstop, but local state saves needless calls + respects the
// 20-calls/min MCP rate limit).

import { pipe } from "@screenpipe/js";
import type { IngestState } from "./types";

const NS = "kordi_state";
const KEY = "state";

function empty(): IngestState {
  return { lastRunIso: null, seen: {}, lastOllamaWarnIso: null };
}

export async function loadState(): Promise<IngestState> {
  try {
    const s = (await pipe.settings.getCustomSetting(NS, KEY)) as Partial<IngestState> | undefined;
    if (s && typeof s === "object") {
      return {
        lastRunIso: typeof s.lastRunIso === "string" ? s.lastRunIso : null,
        seen: s.seen && typeof s.seen === "object" ? (s.seen as IngestState["seen"]) : {},
        lastOllamaWarnIso:
          typeof s.lastOllamaWarnIso === "string" ? s.lastOllamaWarnIso : null,
      };
    }
  } catch {
    /* first run / unreadable — start clean */
  }
  return empty();
}

export async function saveState(state: IngestState): Promise<void> {
  try {
    await pipe.settings.setCustomSetting(NS, KEY, state);
  } catch (e) {
    console.error("kordi: failed to persist state:", e);
  }
}
