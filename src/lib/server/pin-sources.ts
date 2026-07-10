/**
 * Pin sources — server-side capture of the material a pin references.
 *
 * The client only ever sends `{ kind, ref }` (plus raw text for `paste`); this
 * module does the actual reading, with the trust boundaries owned here:
 *
 *   - `url`     — http(s) only, DNS-resolved SSRF guard (loopback/private/
 *                 link-local blocked, every redirect hop re-validated), size cap.
 *   - `github`  — pinned to github.com refs, fetched via api.github.com /
 *                 raw.githubusercontent.com only (fixed hosts, no resolution risk).
 *   - `file`    — memory allow-list roots + the knowledge vault root; md/txt only.
 *   - `memory`  — an allow-listed memory file, optionally one `#heading` section.
 *   - `chat`    — a Cave conversation flattened to speaker-tagged markdown.
 *   - `paste`   — client-provided text, capped.
 */

import { readFile, stat } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import { loadConversation, isSafeConversationSessionId } from "../cave-conversations.ts";
import { parseSafeGitHubUrl, parseSafeHttpUrl } from "../url-safety.ts";
import { makePin, PIN_CONTENT_MAX, type PinKind, type StitchPin } from "../stitch.ts";
import { covenKnowledgeRoot } from "./knowledge-vault.ts";
import { resolveAllowedMemoryFilePath } from "./memory-file-paths.ts";

export type PinCaptureRequest = {
  kind: PinKind;
  ref: string;
  /** Raw text for `paste` pins; ignored for every other kind. */
  content?: string;
  /** Optional explicit title override. */
  title?: string;
};

export type PinCaptureResult =
  | { ok: true; pin: StitchPin }
  | { ok: false; error: string; status: number };

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
/** Fetch cap: a little above PIN_CONTENT_MAX so capping happens post-decode. */
const FETCH_BYTE_CAP = PIN_CONTENT_MAX * 4;

// ── SSRF guard ───────────────────────────────────────────────────────────────

/** True when an IP literal must never be fetched server-side. Exported for tests. */
export function isPrivateIp(addr: string): boolean {
  const family = isIP(addr);
  if (family === 4) {
    const octets = addr.split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) return true;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (family === 6) {
    const lower = addr.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
      return true; // link-local fe80::/10
    }
    // IPv4-mapped (::ffff:a.b.c.d) — defer to the v4 check.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // not an IP literal — callers resolve first
}

/** Resolve a hostname and reject when ANY address is private. */
async function assertPublicHost(hostname: string): Promise<string | null> {
  if (isIP(hostname)) {
    return isPrivateIp(hostname) ? "URL resolves to a private address" : null;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return "URL hostname did not resolve";
  }
  if (addresses.length === 0) return "URL hostname did not resolve";
  for (const { address } of addresses) {
    if (isPrivateIp(address)) return "URL resolves to a private address";
  }
  return null;
}

// ── HTML → text ──────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Cheap readable-text extraction — no DOM dependency. Exported for tests. */
export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "";
  const text = decodeEntities(
    html
      // \b + [^>]* end-tag forms (`</script >`, `</style foo>`) close too —
      // a plain `<\/script>` filter leaves those blocks in (CodeQL #109).
      .replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

// ── Heading extraction (memory pins) ─────────────────────────────────────────

/** Slice one `#…` section out of a markdown doc (heading line through the next
 *  same-or-higher-level heading). Empty heading → whole doc. Exported for tests. */
export function extractHeadingSection(markdown: string, heading: string): string {
  const wanted = heading.trim().toLowerCase();
  if (!wanted) return markdown;
  const lines = markdown.split("\n");
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (match && match[2].trim().toLowerCase() === wanted) {
      start = i;
      level = match[1].length;
      break;
    }
  }
  if (start < 0) return markdown;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s/);
    if (match && match[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

// ── GitHub target mapping ────────────────────────────────────────────────────

export type GitHubTarget =
  | { api: string; label: string; json: "issue" }
  | { api: string; label: string; json: "repo" }
  | { api: string; label: string; json: "raw" };

/** Map a github.com URL to the fixed-host API/raw fetch for it. Exported for tests. */
export function githubApiTarget(url: URL): GitHubTarget | null {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo, section, ...rest] = parts;
  const safe = /^[A-Za-z0-9_.-]+$/;
  if (!safe.test(owner) || !safe.test(repo)) return null;
  if (!section) {
    return {
      api: `https://api.github.com/repos/${owner}/${repo}/readme`,
      label: `${owner}/${repo} README`,
      json: "repo",
    };
  }
  if ((section === "issues" || section === "pull") && rest.length >= 1 && /^\d+$/.test(rest[0])) {
    return {
      api: `https://api.github.com/repos/${owner}/${repo}/issues/${rest[0]}`,
      label: `${owner}/${repo}#${rest[0]}`,
      json: "issue",
    };
  }
  if (section === "blob" && rest.length >= 2) {
    const [branch, ...filePath] = rest;
    if (!safe.test(branch) || filePath.some((p) => !safe.test(p))) return null;
    return {
      api: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath.join("/")}`,
      label: `${owner}/${repo}: ${filePath.join("/")}`,
      json: "raw",
    };
  }
  return null;
}

// ── Fetch plumbing ───────────────────────────────────────────────────────────

async function fetchCapped(url: string, accept: string): Promise<Response> {
  return fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept, "user-agent": "coven-cave-grimoire-stitch" },
  });
}

async function readBodyCapped(res: Response): Promise<string> {
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > FETCH_BYTE_CAP) throw new Error("response too large");
  const text = await res.text();
  return text.length > FETCH_BYTE_CAP ? text.slice(0, FETCH_BYTE_CAP) : text;
}

/** Fetch a public URL following ≤3 redirects, re-validating EVERY hop. */
async function fetchPublicUrl(startUrl: URL): Promise<{ finalUrl: URL; body: string } | { error: string }> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const hostError = await assertPublicHost(current.hostname);
    if (hostError) return { error: hostError };
    let res: Response;
    try {
      res = await fetchCapped(current.toString(), "text/html, text/plain;q=0.9, */*;q=0.1");
    } catch {
      return { error: "fetch failed" };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      res.body?.cancel();
      if (!location) return { error: "redirect without location" };
      const next = parseSafeHttpUrl(new URL(location, current).toString());
      if (!next) return { error: "redirected to an unsupported URL" };
      current = next;
      continue;
    }
    if (!res.ok) return { error: `HTTP ${res.status}` };
    try {
      return { finalUrl: current, body: await readBodyCapped(res) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "read failed" };
    }
  }
  return { error: "too many redirects" };
}

// ── Per-kind capture ─────────────────────────────────────────────────────────

async function captureUrl(req: PinCaptureRequest): Promise<PinCaptureResult> {
  const url = parseSafeHttpUrl(req.ref);
  if (!url) return { ok: false, error: "only http(s) URLs can be pinned", status: 400 };
  const fetched = await fetchPublicUrl(url);
  if ("error" in fetched) return { ok: false, error: fetched.error, status: 502 };
  const { title, text } = htmlToText(fetched.body);
  if (!text) return { ok: false, error: "page had no readable text", status: 422 };
  return {
    ok: true,
    pin: makePin({ kind: "url", ref: url.toString(), title: req.title || title || url.hostname, content: text }),
  };
}

async function captureGitHub(req: PinCaptureRequest): Promise<PinCaptureResult> {
  const url = parseSafeGitHubUrl(req.ref);
  if (!url) return { ok: false, error: "only github.com URLs can be pinned as GitHub", status: 400 };
  const target = githubApiTarget(url);
  if (!target) return { ok: false, error: "unsupported GitHub URL — pin a repo, issue, PR, or file", status: 400 };
  let res: Response;
  try {
    res = await fetchCapped(
      target.api,
      target.json === "raw" ? "text/plain" : "application/vnd.github.raw+json, application/vnd.github+json",
    );
  } catch {
    return { ok: false, error: "GitHub fetch failed", status: 502 };
  }
  if (!res.ok) return { ok: false, error: `GitHub returned HTTP ${res.status}`, status: 502 };
  let content: string;
  let title = req.title || target.label;
  try {
    if (target.json === "issue") {
      const json = (await res.json()) as { title?: string; body?: string };
      title = req.title || `${target.label} — ${json.title ?? ""}`.trim();
      content = `# ${json.title ?? target.label}\n\n${json.body ?? ""}`;
    } else if (target.json === "repo") {
      // vnd.github.raw+json on /readme returns the raw markdown body.
      content = await readBodyCapped(res);
    } else {
      content = await readBodyCapped(res);
    }
  } catch {
    return { ok: false, error: "GitHub response unreadable", status: 502 };
  }
  if (!content.trim()) return { ok: false, error: "GitHub content was empty", status: 422 };
  return { ok: true, pin: makePin({ kind: "github", ref: url.toString(), title, content }) };
}

async function resolveReadableFile(ref: string): Promise<string | null> {
  // Memory allow-list roots first, then the knowledge vault root.
  const allowed = await resolveAllowedMemoryFilePath(ref);
  if (allowed) return allowed;
  const root = path.resolve(covenKnowledgeRoot());
  const resolved = path.resolve(ref);
  if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;
  return null;
}

async function captureFileLike(kind: "file" | "memory", req: PinCaptureRequest): Promise<PinCaptureResult> {
  const [refPath, heading = ""] = req.ref.split("#", 2);
  const allowed = await resolveReadableFile(refPath);
  if (!allowed) return { ok: false, error: "path is outside the allowed roots", status: 403 };
  if (!/\.(md|markdown|txt)$/i.test(allowed)) {
    return { ok: false, error: "only markdown/text files can be pinned", status: 400 };
  }
  try {
    const info = await stat(allowed);
    if (info.size > FETCH_BYTE_CAP) return { ok: false, error: "file too large to pin", status: 413 };
  } catch {
    return { ok: false, error: "file not found", status: 404 };
  }
  let raw: string;
  try {
    raw = await readFile(allowed, "utf8");
  } catch {
    return { ok: false, error: "file unreadable", status: 404 };
  }
  const content = kind === "memory" ? extractHeadingSection(raw, heading) : raw;
  if (!content.trim()) return { ok: false, error: "file was empty", status: 422 };
  const base = path.basename(refPath);
  const title = req.title || (heading ? `${base} § ${heading}` : base);
  return { ok: true, pin: makePin({ kind, ref: req.ref, title, content }) };
}

async function captureChat(req: PinCaptureRequest): Promise<PinCaptureResult> {
  if (!isSafeConversationSessionId(req.ref)) {
    return { ok: false, error: "invalid session id", status: 400 };
  }
  const conv = await loadConversation(req.ref);
  if (!conv) return { ok: false, error: "conversation not found", status: 404 };
  const lines = conv.turns
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && turn.text.trim())
    .map((turn) => `**${turn.role === "user" ? "User" : "Assistant"}:** ${turn.text.trim()}`);
  if (lines.length === 0) return { ok: false, error: "conversation has no messages", status: 422 };
  return {
    ok: true,
    pin: makePin({
      kind: "chat",
      ref: req.ref,
      title: req.title || conv.title || `Chat ${req.ref.slice(0, 8)}`,
      content: lines.join("\n\n"),
    }),
  };
}

function capturePaste(req: PinCaptureRequest): PinCaptureResult {
  const content = (req.content ?? "").trim();
  if (!content) return { ok: false, error: "paste content required", status: 400 };
  return {
    ok: true,
    pin: makePin({ kind: "paste", ref: "paste", title: req.title || "Pasted text", content }),
  };
}

/** Capture the material a pin references. Never throws. */
export async function capturePin(req: PinCaptureRequest): Promise<PinCaptureResult> {
  try {
    switch (req.kind) {
      case "url":
        return await captureUrl(req);
      case "github":
        return await captureGitHub(req);
      case "file":
        return await captureFileLike("file", req);
      case "memory":
        return await captureFileLike("memory", req);
      case "chat":
        return await captureChat(req);
      case "paste":
        return capturePaste(req);
      default:
        return { ok: false, error: "unknown pin kind", status: 400 };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "capture failed", status: 500 };
  }
}
