import { NextResponse } from "next/server";
import {
  clearBackupSyncPassphrase,
  getBackupSyncOverview,
  setBackupSyncPassphrase,
  updateBackupSyncConfig,
  type BackupSyncConfig,
} from "@/lib/server/backup-sync";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  try {
    const overview = await getBackupSyncOverview();
    return NextResponse.json({ ok: true, ...overview });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "backup sync status failed" }, { status: 500 });
  }
}

type SyncPutBody = Partial<Pick<BackupSyncConfig, "enabled" | "directory" | "retainCount" | "intervalHours" | "onQuitPush">> & {
  passphrase?: string;
  clearPassphrase?: boolean;
};

export async function PUT(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<SyncPutBody>(req, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  try {
    // The passphrase lands in the local encrypted vault only — it is never
    // stored in config nor echoed back in any response.
    if (typeof body.passphrase === "string" && body.passphrase) {
      setBackupSyncPassphrase(body.passphrase);
    } else if (body.clearPassphrase === true) {
      clearBackupSyncPassphrase();
    }
    const patch: Partial<BackupSyncConfig> = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.directory === "string" || body.directory === null) patch.directory = body.directory;
    if (typeof body.retainCount === "number") patch.retainCount = body.retainCount;
    if (typeof body.intervalHours === "number") patch.intervalHours = body.intervalHours;
    if (typeof body.onQuitPush === "boolean") patch.onQuitPush = body.onQuitPush;
    if (Object.keys(patch).length > 0) await updateBackupSyncConfig(patch);
    const overview = await getBackupSyncOverview();
    return NextResponse.json({ ok: true, ...overview });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "backup sync update failed" }, { status: 400 });
  }
}
