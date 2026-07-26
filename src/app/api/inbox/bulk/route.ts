import { NextResponse } from "next/server";
import { isLocalOrigin } from "@/lib/server/local-origin";
import { applyBulkAction, type BulkAction } from "@/lib/cave-inbox";
import {
  broadcastDeleted,
  broadcastUpdated,
  startScheduler,
} from "@/lib/inbox-scheduler";

export const dynamic = "force-dynamic";

startScheduler();

const ACTIONS: readonly BulkAction[] = ["read", "unread", "dismiss", "done", "delete"];

// `all: true` may only sweep the non-destructive notification stack — done and
// delete change what exists, so they must name their targets.
const ALL_ALLOWED: readonly BulkAction[] = ["read", "unread", "dismiss"];

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  let body: { action?: string; ids?: unknown; all?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const action = body.action as BulkAction | undefined;
  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json(
      { ok: false, error: `action must be one of: ${ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : null;
  if (!ids && body.all !== true) {
    return NextResponse.json(
      { ok: false, error: "ids array or all:true required" },
      { status: 400 },
    );
  }
  if (!ids && !ALL_ALLOWED.includes(action)) {
    return NextResponse.json(
      { ok: false, error: `all:true is not allowed for ${action} — pass explicit ids` },
      { status: 400 },
    );
  }

  const result = await applyBulkAction(action, ids);
  // Reuse the existing per-item SSE events — every connected client already
  // reconciles updated/deleted, so bulk needs no new event type.
  for (const item of result.updated) broadcastUpdated(item);
  for (const id of result.deletedIds) broadcastDeleted(id);
  return NextResponse.json({
    ok: true,
    updated: result.updated,
    deletedIds: result.deletedIds,
  });
}
