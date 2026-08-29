import path from "node:path";
import { NextResponse } from "next/server";
import { parseResearchSourcesFile } from "@/lib/research-artifact-contract";
import type { ResearchSourceLedgerSnapshot } from "@/lib/research-missions";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  isValidResearchMissionId,
  loadResearchMission,
  readValidatedMissionFile,
  researchMissionWorkspacePath,
} from "@/lib/server/research-mission-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResearchMissionFileRouteDependencies = {
  loadMission?: typeof loadResearchMission;
  readFile?: typeof readValidatedMissionFile;
  workspacePath?: typeof researchMissionWorkspacePath;
};

async function readSourceLedgerSnapshot(
  missionId: string,
  readFile: typeof readValidatedMissionFile,
): Promise<ResearchSourceLedgerSnapshot> {
  try {
    const raw = await readFile(missionId, "sources.json");
    const sources = parseResearchSourcesFile(raw);
    return sources.length > 0
      ? { state: "available", sources }
      : { state: "empty", sources: [] };
  } catch {
    return { state: "failed", sources: [] };
  }
}

export function createResearchMissionFileRouteHandlers(
  dependencies: ResearchMissionFileRouteDependencies = {},
) {
  const loadMission = dependencies.loadMission ?? loadResearchMission;
  const readFile = dependencies.readFile ?? readValidatedMissionFile;
  const workspacePath = dependencies.workspacePath ?? researchMissionWorkspacePath;

  return {
    async GET(
      req: Request,
      context: { params: Promise<{ id: string; key: string }> },
    ) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) return forbidden;
      const { id, key } = await context.params;
      if (!isValidResearchMissionId(id)) {
        return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
      }
      const mission = await loadMission(id);
      if (!mission) {
        return NextResponse.json({ ok: false, error: "research mission not found" }, { status: 404 });
      }
      const artifact = mission.artifacts.find((item) => item.key === key);
      if (!artifact) {
        return NextResponse.json({ ok: false, error: "research artifact not found" }, { status: 404 });
      }
      let content: string | null = null;
      try {
        content = await readFile(id, artifact.relativePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          return NextResponse.json(
            { ok: false, error: (error as Error).message },
            { status: 500 },
          );
        }
      }
      const sourceLedger = await readSourceLedgerSnapshot(id, readFile);
      return NextResponse.json({
        ok: true,
        file: {
          key: artifact.key,
          kind: artifact.kind,
          title: artifact.title,
          fileName: path.posix.basename(artifact.relativePath),
          relativePath: artifact.relativePath,
          content,
          workspacePath: workspacePath(id),
          updatedAt: artifact.updatedAt,
          sourceLedger,
        },
      });
    },
  };
}

const handlers = createResearchMissionFileRouteHandlers();
export const GET = handlers.GET;
