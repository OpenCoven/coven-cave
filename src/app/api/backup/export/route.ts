import { NextResponse } from "next/server";
import { buildBackupArchive } from "@/lib/server/backup-archive";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ExportBody = { passphrase?: string };

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<ExportBody>(req, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const passphrase = typeof parsed.body.passphrase === "string" ? parsed.body.passphrase : "";
  try {
    const { archive, manifest } = await buildBackupArchive(passphrase);
    return new Response(new Uint8Array(archive), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="coven-cave-backup-${manifest.createdAt.slice(0, 10)}.ccbackup"`,
        "x-coven-backup-manifest": Buffer.from(JSON.stringify({ createdAt: manifest.createdAt, totals: manifest.totals })).toString("base64"),
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "backup export failed" }, { status: 400 });
  }
}
