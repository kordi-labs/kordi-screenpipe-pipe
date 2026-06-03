// Service-name normalization.
//
// Two jobs, kept deliberately separate:
//
//  - normalizeKey(name): the LOCAL dedupe key. It MUST equal what Kordi's MCP
//    tool keys on, which is `name.toLowerCase().trim()` (see kordiapp-backend
//    src/mcp/agent.js — `const normalizedName = name.toLowerCase().trim()`).
//    Because we always send the *canonical* name (below), our local key and the
//    server's stored `subName` line up, so "new vs. updated" agrees on both ends.
//
//  - cleanName(raw): conservative canonicalization of a raw on-screen string into
//    a stable display name (e.g. "ADOBE", "Adobe Systems Inc." -> "Adobe"). Used
//    for LLM-extracted names; catalog hits already carry their canonical name.
//    Kept conservative on purpose: we collapse render variants of ONE product but
//    never merge genuinely distinct SKUs ("Acrobat Pro" stays "Acrobat Pro").

/** Local dedupe key — identical normalization to the Kordi MCP ingest tool. */
export function normalizeKey(name: string): string {
  return name.toLowerCase().trim();
}

// Legal/# suffixes and noise we strip from raw on-screen names.
const LEGAL_SUFFIX_RE = /\b(inc|inc\.|llc|l\.l\.c\.|ltd|ltd\.|corp|corp\.|co|co\.|company|gmbh|sa|s\.a\.|plc)\b/gi;
const URL_NOISE_RE = /\b(?:https?:\/\/)?(?:www\.)?|\.(?:com|net|org|io|tv|co)\b/gi;

/**
 * Conservative canonicalization of a raw service string into a display name.
 * Trims, strips legal suffixes and URL noise, collapses whitespace, and
 * title-cases ALL-CAPS tokens (but leaves mixed-case brand styling alone).
 */
export function cleanName(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return s;

  s = s.replace(URL_NOISE_RE, " ");
  s = s.replace(LEGAL_SUFFIX_RE, " ");
  // Drop trailing/leading punctuation and collapse internal whitespace.
  s = s.replace(/[^\p{L}\p{N}+&'’.\- ]/gu, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^[-.\s]+|[-.\s]+$/g, "").trim();

  // Re-case tokens that are fully uppercase (ADOBE -> Adobe); keep things like
  // "HBO" short acronyms and mixed-case ("Disney+") untouched.
  s = s
    .split(" ")
    .map((tok) =>
      tok.length > 3 && tok === tok.toUpperCase() && /[A-Z]/.test(tok)
        ? tok.charAt(0) + tok.slice(1).toLowerCase()
        : tok,
    )
    .join(" ");

  return s;
}

/** Clamp an arbitrary number to an integer day-of-month in [1, 31]. */
export function clampBillDay(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1 || v > 31) return 1;
  return v;
}
