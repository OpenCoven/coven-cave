import { NextResponse } from "next/server";
import { restoreBackupArchive } from "@/lib/server/backup-archive";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RestoreBody = { passphrase?: string; archiveBase64?: string };

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<RestoreBody>(req, 256 * 1024 * 1024);
  if (!parsed.ok) return parsed.response;
  const passphrase = typeof parsed.body.passphrase === "string" ? parsed.body.passphrase : "";
  const archiveBase64 = typeof parsed.body.archiveBase64 === "string" ? parsed.body.archiveBase64 : "";
  if (!archiveBase64) return NextResponse.json({ ok: false, error: "archiveBase64 is required" }, { status: 400 });
  try {
    const restored = await restoreBackupArchive(Buffer.from(archiveBase64, "base64"), passphrase);
    return NextResponse.json({ ok: true, manifest: restored.manifest, restored: restored.restored });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "backup restore failed" }, { status: 400 });
  }
}
