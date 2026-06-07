// Pure URL extraction from arbitrary text. Skips code blocks (fenced and
// inline backticks), markdown image targets, and non-http(s) schemes.

const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]*`/g;
const IMAGE_TARGET = /!\[[^\]]*\]\([^)]*\)/g;

const URL_RE = /https?:\/\/[^\s)\]>'"`]+/g;

const REJECT_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export function extractLinks(text: string): string[] {
  if (!text) return [];

  // Strip fenced code blocks, inline backticks, image targets BEFORE scanning.
  const cleaned = text
    .replace(FENCED_CODE, " ")
    .replace(IMAGE_TARGET, " ")
    .replace(INLINE_CODE, " ");

  const found = cleaned.match(URL_RE) ?? [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of found) {
    // Trim trailing punctuation that URL_RE may have included.
    const trimmed = raw.replace(/[.,;:!?]+$/, "");
    let url: URL;
    try { url = new URL(trimmed); } catch { continue; }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (REJECT_HOSTS.has(url.hostname)) continue;
    const normalized = url.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}
