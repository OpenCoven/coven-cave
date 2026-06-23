import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { listRuns } from "@/lib/automation-runs";
import { isAllowedAutomationLogPath, MAX_RUN_LOG_BYTES } from "@/lib/server/automation-log-paths";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const run = (await listRuns(id)).find((r) => r.id === runId);
  if (!run?.logPath) return NextResponse.json({ ok: false, error: "no log for this run" }, { status: 404 });
  if (!(await isAllowedAutomationLogPath(run.logPath))) {
    return NextResponse.json({ ok: false, error: "log not available" }, { status: 404 });
  }
  let text = await readFile(run.logPath, "utf8");
  let truncated = false;
  if (text.length > MAX_RUN_LOG_BYTES) {
    text = text.slice(text.length - MAX_RUN_LOG_BYTES); // tail
    truncated = true;
  }
  return NextResponse.json({ ok: true, log: text, truncated });
}
