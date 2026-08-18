// Pure URL extraction from arbitrary text. Skips code blocks (fenced and
// inline backticks), markdown image targets, and non-http(s) schemes.

const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]*`/g;
const IMAGE_TARGET = /!\[[^\]]*\]\([^)]*\)/g;

const URL_RE = /https?:\/\/[^\s<>'"`]+/g;

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || /^127(?:\.\d{1,3}){3}$/.test(host)) return true;

  const ipv6 = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  if (ipv6 === "::" || ipv6 === "::1") return true;

  const mappedLoopback = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(ipv6);
  if (!mappedLoopback) return false;
  const firstIpv4Pair = Number.parseInt(mappedLoopback[1], 16);
  return firstIpv4Pair >= 0x7f00 && firstIpv4Pair <= 0x7fff;
}

function trimUrlCandidate(raw: string): string {
  let trimmed = raw;
  let previous = "";
  while (trimmed !== previous) {
    previous = trimmed;
    trimmed = trimmed.replace(/[.,;:!?]+$/, "");
    const last = trimmed.at(-1);
    if (last === ")") {
      const opens = (trimmed.match(/\(/g) ?? []).length;
      const closes = (trimmed.match(/\)/g) ?? []).length;
      if (closes > opens) trimmed = trimmed.slice(0, -1);
    } else if (last === "]") {
      const opens = (trimmed.match(/\[/g) ?? []).length;
      const closes = (trimmed.match(/\]/g) ?? []).length;
      if (closes > opens) trimmed = trimmed.slice(0, -1);
    }
  }
  return trimmed;
}

export function extractLinks(text: string): string[] {
  if (!text) return [];

  // Strip fenced code blocks, inline backticks, image targets BEFORE scanning.
  const cleaned = text
    .replace(FENCED_CODE, " ")
    .replace(IMAGE_TARGET, " ")
    .replace(INLINE_CODE, " ");

  // A pasted batch may place the next URL directly after a comma. Split only
  // that boundary so commas inside a path or query remain part of the URL.
  const separated = cleaned.replace(/,(?=\s*https?:\/\/)/gi, " ");
  const found = separated.match(URL_RE) ?? [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of found) {
    const trimmed = trimUrlCandidate(raw);
    let url: URL;
    try { url = new URL(trimmed); } catch { continue; }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (isLocalHostname(url.hostname)) continue;
    const normalized = url.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}
