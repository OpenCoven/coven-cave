import { NextResponse } from "next/server";
import { isLocalOrigin } from "@/lib/server/local-origin";
import {
  isValidRepo,
  loadSubscriptions,
  patchSubscriptions,
  type SubscriptionsPatch,
} from "@/lib/github-subscriptions";
import { startGithubWatcher, tickGithubWatcher } from "@/lib/github-watcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Guarantee the watcher is alive even if instrumentation.ts was bypassed.
startGithubWatcher();

/** Prefs without poll cursors — the client has no use for them. */
async function publicPrefs() {
  const subs = await loadSubscriptions();
  return {
    enabled: subs.enabled,
    events: subs.events,
    repos: subs.repos,
  };
}

export async function GET() {
  return NextResponse.json({ ok: true, prefs: await publicPrefs() });
}

export async function PATCH(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  let body: SubscriptionsPatch;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (body.repos) {
    const invalid = body.repos.filter((r) => r.trim() && !isValidRepo(r.trim()));
    if (invalid.length) {
      return NextResponse.json(
        { ok: false, error: `invalid repo: ${invalid.join(", ")} — use owner/name` },
        { status: 400 },
      );
    }
  }
  const subs = await patchSubscriptions(body);
  // A prefs change (enable, new repo) should take effect now, not in <=60s.
  void tickGithubWatcher().catch(() => undefined);
  return NextResponse.json({
    ok: true,
    prefs: { enabled: subs.enabled, events: subs.events, repos: subs.repos },
  });
}
