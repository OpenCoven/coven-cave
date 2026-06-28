/**
 * GET /api/library/article?url=<http(s) url>
 *
 * Fetches a public web article and returns a readable extraction (title,
 * byline, lead image, and the body as markdown) for the Library's inline
 * article reader. Extraction logic lives in src/lib/article-extract.ts.
 *
 * Safety:
 *   - http/https only; private / loopback / link-local hosts are blocked (SSRF).
 *   - DNS is resolved before every fetch hop so public hostnames cannot redirect
 *     or resolve to private addresses.
 *   - Response capped at 2MB and to text/html content types.
 *   - 12s fetch timeout.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { parseSafeHttpUrl } from "@/lib/url-safety";
import { extractArticle } from "@/lib/article-extract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

/** Block obvious SSRF targets before DNS resolution (*.local, localhost, etc.). */
function hasPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  return true;
}

function isPublicAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv6 loopback / link-local / unique-local.
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return false;
  // IPv4 literal ranges.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

async function isPublicFetchTarget(url: URL): Promise<boolean> {
  if (!hasPublicHostname(url.hostname)) return false;
  const literal = isIP(url.hostname);
  if (literal) return isPublicAddress(url.hostname);
  try {
    const records = await lookup(url.hostname, { all: true, verbatim: true });
    return records.length > 0 && records.every((record) => isPublicAddress(record.address));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");
  const parsed = parseSafeHttpUrl(rawUrl);
  if (!parsed) {
    return NextResponse.json({ ok: false, error: "A valid http(s) url is required." }, { status: 400 });
  }
  if (!(await isPublicFetchTarget(parsed))) {
    return NextResponse.json({ ok: false, error: "That host is not allowed." }, { status: 403 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // Follow redirects manually so every hop's host is re-validated — otherwise a
  // public URL could 3xx to an internal address and defeat the pre-check above.
  let target = parsed;
  let res: Response;
  try {
    for (let hop = 0; ; hop++) {
      if (!(await isPublicFetchTarget(target))) {
        clearTimeout(timer);
        return NextResponse.json({ ok: false, error: "That host is not allowed." }, { status: 403 });
      }
      // lgtm[js/request-forgery] target is parsed as http(s), denylisted by hostname,
      // and DNS-resolved to public addresses immediately above; redirects are
      // re-validated before every subsequent fetch.
      res = await fetch(target.toString(), {
        headers: {
          // A desktop UA + accept header improves extraction on UA-gated sites.
          "User-Agent": "Mozilla/5.0 (compatible; coven-cave/1.0; +reader)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal: controller.signal,
      });
      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get("location");
      const next = location ? parseSafeHttpUrl(new URL(location, target).toString()) : null;
      if (!next || !(await isPublicFetchTarget(next))) {
        clearTimeout(timer);
        return NextResponse.json({ ok: false, error: "Refused to follow a redirect to a disallowed host." }, { status: 403 });
      }
      if (hop >= 5) {
        clearTimeout(timer);
        return NextResponse.json({ ok: false, error: "Too many redirects." }, { status: 502 });
      }
      target = next;
    }
  } catch {
    clearTimeout(timer);
    return NextResponse.json({ ok: false, error: "Could not fetch that page." }, { status: 502 });
  }
  clearTimeout(timer);

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `The page returned ${res.status}.` }, { status: 502 });
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    return NextResponse.json({ ok: false, error: "That URL is not an HTML page." }, { status: 415 });
  }

  // Read with a hard byte cap so a huge page can't exhaust memory.
  const reader = res.body?.getReader();
  let received = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
      }
    }
  }
  const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");

  const article = extractArticle(html, parsed.toString());
  if (article.textLength < 200) {
    return NextResponse.json(
      { ok: false, error: "Couldn't extract a readable article from that page.", article },
      { status: 422 },
    );
  }
  return NextResponse.json({ ok: true, url: parsed.toString(), article });
}
