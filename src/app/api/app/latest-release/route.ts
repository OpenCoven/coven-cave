import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/app-version";
import { isUpdateAvailable, type UpdateStatus } from "@/lib/app-update";

export const dynamic = "force-dynamic";

const RELEASES_API = "https://api.github.com/repos/OpenCoven/coven-cave/releases/latest";
const RELEASE_PAGE = "https://github.com/OpenCoven/coven-cave/releases/latest";
const TTL_MS = 10 * 60 * 1000; // cache the GitHub answer for 10 min (unauthenticated API = 60 req/hr)

// Module-level cache so repeated checks (banner + settings, every mount) don't hammer GitHub.
let cache: { at: number; body: UpdateStatus } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json(cache.body);
  }

  const base: UpdateStatus = {
    current: APP_VERSION,
    latest: null,
    available: false,
    url: RELEASE_PAGE,
    checkedAt: new Date(now).toISOString(),
  };

  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "coven-cave" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      // Fail soft — never surface an update on an error; don't cache the failure long.
      return NextResponse.json({ ...base, error: `github ${res.status}` });
    }
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = data.tag_name ? data.tag_name.replace(/^v/, "") : null;
    const body: UpdateStatus = {
      ...base,
      latest,
      available: latest ? isUpdateAvailable(latest, APP_VERSION) : false,
      url: data.html_url || RELEASE_PAGE,
    };
    cache = { at: now, body };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({
      ...base,
      error: err instanceof Error ? err.message : "fetch failed",
    });
  }
}
