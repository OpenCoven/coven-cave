import { NextResponse } from "next/server";
import { createItem } from "@/lib/cave-inbox";
import { broadcastCreated } from "@/lib/inbox-scheduler";
import { MILESTONE_KEY_RE, type MilestoneAward } from "@/lib/milestone-defs";
import { loadLedger, recordAwards } from "@/lib/server/milestones-ledger";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

/**
 * The renown ledger endpoint. The client watcher computes due milestones from
 * data it already holds (use-milestone-watch.ts) and POSTs them here; this
 * route dedupes against the ledger so every milestone fires at most once,
 * then rides the existing inbox channel (kind "milestone") for toast + bell.
 */

export async function GET() {
  const awarded = await loadLedger();
  return NextResponse.json({ ok: true, awarded: Object.keys(awarded) });
}

const MAX_AWARDS_PER_POST = 40;
/** Above this, a first run emits one summary item instead of a toast burst. */
const FIRST_RUN_BURST_LIMIT = 3;

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  let body: { awards?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!Array.isArray(body.awards) || body.awards.length === 0) {
    return NextResponse.json({ ok: false, error: "awards required" }, { status: 400 });
  }
  const awards: MilestoneAward[] = [];
  for (const raw of body.awards.slice(0, MAX_AWARDS_PER_POST)) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Partial<MilestoneAward>;
    if (typeof a.key !== "string" || !MILESTONE_KEY_RE.test(a.key)) continue;
    if (typeof a.title !== "string" || !a.title.trim() || a.title.length > 120) continue;
    if (typeof a.body !== "string" || a.body.length > 300) continue;
    awards.push({
      key: a.key,
      title: a.title.trim(),
      body: a.body,
      familiarId: typeof a.familiarId === "string" ? a.familiarId : null,
    });
  }
  if (awards.length === 0) {
    return NextResponse.json({ ok: false, error: "no valid awards" }, { status: 400 });
  }

  const { newly, firstRun } = await recordAwards(awards);
  if (newly.length === 0) {
    return NextResponse.json({ ok: true, awarded: [] });
  }

  if (firstRun && newly.length > FIRST_RUN_BURST_LIMIT) {
    // An established coven's history arrives all at once — acknowledge it in
    // one dignified item rather than a toast barrage.
    const item = await createItem({
      kind: "milestone",
      title: "The renown ledger opens",
      body: `${newly.length} milestones already earned — the coven arrives with history.`,
      source: "system",
    });
    broadcastCreated(item);
  } else {
    for (const award of newly) {
      const item = await createItem({
        kind: "milestone",
        title: award.title,
        body: award.body,
        source: "system",
        familiarId: award.familiarId,
      });
      broadcastCreated(item);
    }
  }
  return NextResponse.json({ ok: true, awarded: newly.map((a) => a.key) });
}
