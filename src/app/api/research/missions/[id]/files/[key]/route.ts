import path from "node:path";
import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  isValidResearchMissionId,
  loadResearchMission,
  readValidatedMissionFile,
  researchMissionWorkspacePath,
} from "@/lib/server/research-mission-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string; key: string }> },
) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const { id, key } = await context.params;
  if (!isValidResearchMissionId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const mission = await loadResearchMission(id);
  if (!mission) {
    return NextResponse.json({ ok: false, error: "research mission not found" }, { status: 404 });
  }
  const artifact = mission.artifacts.find((item) => item.key === key);
  if (!artifact) {
    return NextResponse.json({ ok: false, error: "research artifact not found" }, { status: 404 });
  }
  let content: string | null = null;
  try {
    content = await readValidatedMissionFile(id, artifact.relativePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return NextResponse.json(
        { ok: false, error: (error as Error).message },
        { status: 500 },
      );
    }
  }
  return NextResponse.json({
    ok: true,
    file: {
      key: artifact.key,
      kind: artifact.kind,
      title: artifact.title,
      fileName: path.posix.basename(artifact.relativePath),
      relativePath: artifact.relativePath,
      content,
      workspacePath: researchMissionWorkspacePath(id),
      updatedAt: artifact.updatedAt,
    },
  });
}
