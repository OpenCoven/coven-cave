import { NextResponse } from "next/server";
import { CAVE_HOME_MIGRATIONS, migrateCaveHome } from "@/lib/server/cave-home-migration";
import { caveHomeMigrationStatus } from "@/lib/server/cave-home-migration-status";
import type { ReconciliationAction } from "@/lib/server/cave-home-reconciliation";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual cave home migration surface backing the shell banner
 * (src/components/cave-home-migration-banner.tsx).
 *
 *   GET  /api/cave-home-migration → { ok, status: { pending, conflicts, migrated } }
 *   POST /api/cave-home-migration → run migrateCaveHome(), return result + fresh status
 *
 * The boot migration (instrumentation.ts) already handles the common case;
 * this route exists so machines where that run errored or was interrupted
 * ("qualified participants" — status.pending non-empty) can finish the move
 * with one click instead of waiting for the next restart.
 */
const MAX_ACTION_BODY_BYTES = 1024;

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  return NextResponse.json({ ok: true, status: await caveHomeMigrationStatus() });
}

const ACTIONS = new Set<ReconciliationAction>(["merge", "keep-canonical", "recover-legacy", "defer"]);

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = req.body
    ? await readJsonBody<{ action?: unknown; legacy?: unknown }>(req, MAX_ACTION_BODY_BYTES)
    : null;
  if (parsed && !parsed.ok) return parsed.response;
  const body = parsed?.body ?? null;
  let options: { action?: ReconciliationAction; legacy?: string } = {};
  if (body) {
    if (typeof body.action !== "string" || !ACTIONS.has(body.action as ReconciliationAction)) {
      return NextResponse.json({ ok: false, error: "Unsupported migration action" }, { status: 400 });
    }
    if (typeof body.legacy !== "string" || !CAVE_HOME_MIGRATIONS.some((entry) => entry.legacy === body.legacy)) {
      return NextResponse.json({ ok: false, error: "Unknown legacy migration entry" }, { status: 400 });
    }
    options = { action: body.action as ReconciliationAction, legacy: body.legacy };
  }
  const result = await migrateCaveHome(options);
  const status = await caveHomeMigrationStatus();
  return NextResponse.json({ ok: result.errors.length === 0, result, status });
}
