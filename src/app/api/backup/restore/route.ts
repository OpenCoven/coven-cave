import { NextResponse } from "next/server";
import { restoreBackupArchive } from "@/lib/server/backup-archive";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { recordPermissionEvent } from "@/lib/project-permissions";
import {
  permissionMutationActor,
  refuseTokenlessPermissionMutation,
} from "@/lib/server/trusted-grant-mutation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PERMISSION_STORE_FILES = new Set(["project-permissions.json", "permission-config.json"]);

type RestoreBody = { passphrase?: string; archiveBase64?: string };

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  // A restore replaces the permission stores wholesale, so it is a permission
  // change like any other: refused in tokenless dev without the escape hatch.
  const tokenless = refuseTokenlessPermissionMutation();
  if (tokenless) return tokenless;
  const parsed = await readJsonBody<RestoreBody>(req, 256 * 1024 * 1024);
  if (!parsed.ok) return parsed.response;
  const passphrase = typeof parsed.body.passphrase === "string" ? parsed.body.passphrase : "";
  const archiveBase64 = typeof parsed.body.archiveBase64 === "string" ? parsed.body.archiveBase64 : "";
  if (!archiveBase64) return NextResponse.json({ ok: false, error: "archiveBase64 is required" }, { status: 400 });
  try {
    const restored = await restoreBackupArchive(Buffer.from(archiveBase64, "base64"), passphrase);
    // Logged after the restore, into the store it just wrote, so the restored
    // history ends with a record of who replaced it. The restore has already
    // happened, so a failed log write is reported, not turned into a failure.
    const auditRecorded = await recordPermissionEvent({
      kind: "backup-restored",
      actor: permissionMutationActor(req),
      details: {
        restoredFiles: restored.restored
          .filter((file) => file.root === "cave" && PERMISSION_STORE_FILES.has(file.path))
          .map((file) => file.path),
      },
    }).then(() => true, (error: unknown) => {
      console.error("[backup-restore] could not record the restore in the permission log:", error);
      return false;
    });
    return NextResponse.json({
      ok: true,
      auditRecorded,
      manifest: restored.manifest,
      restored: restored.restored,
      ...(restored.researchRecovery ? { researchRecovery: restored.researchRecovery } : {}),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "backup restore failed" }, { status: 400 });
  }
}
