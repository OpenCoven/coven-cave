import { NextResponse } from "next/server";
import { migrateCaveHome } from "@/lib/server/cave-home-migration";
import { caveHomeMigrationStatus } from "@/lib/server/cave-home-migration-status";

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
export async function GET() {
  return NextResponse.json({ ok: true, status: await caveHomeMigrationStatus() });
}

export async function POST() {
  const result = await migrateCaveHome();
  const status = await caveHomeMigrationStatus();
  return NextResponse.json({ ok: result.errors.length === 0, result, status });
}
