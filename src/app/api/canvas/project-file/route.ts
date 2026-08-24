import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

import { loadCanvas, upsertCanvasArtifact } from "@/lib/cave-canvas";
import { loadProjects, projectById } from "@/lib/cave-projects";
import { clampArtifactCode } from "@/lib/canvas-artifacts";
import { gitHubRepoSlug } from "@/lib/github-repo-link";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import { requireTrustedHumanCanvasMutation } from "@/lib/server/trusted-grant-mutation";
import { withRepositoryMutation } from "@/lib/server/keyed-transaction-lock";
import {
  readStableProjectFile,
  sha256Text,
  type StableProjectFileRead,
} from "@/lib/server/canvas-project-file-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

function containedPath(root: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\0") || path.isAbsolute(relativePath)) return null;
  if (relativePath.split(/[\\/]+/).includes("..")) return null;
  const target = path.resolve(root, relativePath);
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

async function replaceAtomically(
  target: string,
  content: string,
  mode: number,
  expectedHash?: string,
): Promise<StableProjectFileRead | null> {
  const parent = path.dirname(target);
  const tempPath = path.join(parent, `.coven-canvas-${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx", mode });
    const stableRead = expectedHash
      ? await readStableProjectFile(() => readFile(target, "utf8"), expectedHash)
      : null;
    if (stableRead && !stableRead.ok) return stableRead;
    await rename(tempPath, target);
    return stableRead;
  } finally {
    await unlink(tempPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") console.error("api/canvas/project-file: temp cleanup failed", error);
    });
  }
}

export async function POST(req: Request) {
  const denied = await requireTrustedHumanCanvasMutation(req);
  if (denied) return denied;

  let body: { artifactId?: unknown; expectedUpdatedAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const artifactId = typeof body.artifactId === "string" ? body.artifactId.trim() : "";
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string"
    ? body.expectedUpdatedAt.trim()
    : "";
  if (!artifactId) {
    return NextResponse.json({ ok: false, error: "artifactId is required" }, { status: 400 });
  }
  if (!expectedUpdatedAt) {
    return NextResponse.json({ ok: false, error: "expectedUpdatedAt is required" }, { status: 400 });
  }

  let artifact;
  let projects;
  try {
    const canvas = await loadCanvas();
    artifact = canvas.artifacts.find((entry) => entry.id === artifactId);
    projects = await loadProjects();
  } catch (error) {
    console.error("api/canvas/project-file: source lookup failed", error);
    return NextResponse.json({ ok: false, error: "Couldn't read the Canvas or project registry." }, { status: 500 });
  }
  const source = artifact?.source;
  if (!artifact || source?.kind !== "github" || !source.projectId) {
    return NextResponse.json({ ok: false, error: "Connect this sketch to a Cave project first." }, { status: 409 });
  }
  const project = projectById(source.projectId, projects);
  if (!project) {
    return NextResponse.json({ ok: false, error: "The connected Cave project no longer exists." }, { status: 404 });
  }
  if (
    project.repoUrl
    && gitHubRepoSlug(project.repoUrl)?.toLowerCase() !== gitHubRepoSlug(source.repoUrl)?.toLowerCase()
  ) {
    return NextResponse.json(
      { ok: false, error: "The connected project points at a different GitHub repository." },
      { status: 409 },
    );
  }

  const allowedRoot = resolveAllowedProjectPath(project.root);
  if (!allowedRoot) {
    return NextResponse.json({ ok: false, error: "Project path is not allowed." }, { status: 403 });
  }
  let root: string;
  try {
    root = await realpath(allowedRoot);
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    return NextResponse.json({ ok: false, error: "The project folder is unavailable." }, { status: 404 });
  }
  let repoRoot: string;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      windowsHide: true,
      timeout: 10_000,
    });
    repoRoot = await realpath(stdout.trim());
  } catch {
    return NextResponse.json({ ok: false, error: "The connected project is not a Git repository." }, { status: 422 });
  }
  if (repoRoot !== root) {
    return NextResponse.json(
      { ok: false, error: "Connect the repository root, not a subfolder, before applying this sketch." },
      { status: 409 },
    );
  }
  return withRepositoryMutation(root, async () => {
    try {
      const [freshCanvas, freshProjects] = await Promise.all([loadCanvas(), loadProjects()]);
      const freshProject = projectById(source.projectId, freshProjects);
      if (
        !freshProject
        || freshProject.root !== project.root
        || freshProject.repoUrl !== project.repoUrl
      ) {
        return NextResponse.json(
          { ok: false, error: "The connected project changed before the sketch could be applied. Review it and try again." },
          { status: 409 },
        );
      }
      const freshArtifact = freshCanvas.artifacts.find((entry) => entry.id === artifactId);
      const freshSource = freshArtifact?.source;
      if (
        !freshArtifact
        || freshArtifact.updatedAt !== expectedUpdatedAt
        || freshSource?.kind !== "github"
        || freshSource.projectId !== project.id
      ) {
        return NextResponse.json(
          { ok: false, error: "The sketch changed before it could be applied. Review it and try again." },
          { status: 409 },
        );
      }

      const target = containedPath(root, freshSource.filePath);
      if (!target) {
        return NextResponse.json({ ok: false, error: "The source file path is invalid." }, { status: 400 });
      }
      const { stdout: dirty } = await execFileAsync(
        "git",
        ["--literal-pathspecs", "status", "--porcelain", "--", freshSource.filePath],
        { cwd: root, windowsHide: true, timeout: 10_000 },
      );
      if (dirty.trim()) {
        return NextResponse.json(
          { ok: false, error: "That project file has local changes. Commit or discard them before applying the sketch." },
          { status: 409 },
        );
      }
      const parent = path.dirname(target);
      const realParent = await realpath(parent);
      if (realParent !== root && !realParent.startsWith(`${root}${path.sep}`)) {
        return NextResponse.json({ ok: false, error: "The source file leaves the project folder." }, { status: 403 });
      }
      let targetStat;
      try {
        targetStat = await lstat(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return NextResponse.json(
            { ok: false, error: "The imported file is not present in this checkout. Switch to the matching branch and try again." },
            { status: 409 },
          );
        }
        throw error;
      }
      if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
        return NextResponse.json({ ok: false, error: "Canvas can only replace a regular project file." }, { status: 409 });
      }
      const targetMode = targetStat.mode & 0o777;
      const realTarget = await realpath(/* turbopackIgnore: true */ target);
      if (!realTarget.startsWith(`${root}${path.sep}`)) {
        return NextResponse.json({ ok: false, error: "The source file leaves the project folder." }, { status: 403 });
      }
      const nextCode = clampArtifactCode(freshArtifact.code);
      const nextHash = sha256Text(nextCode);
      const stableRead = await replaceAtomically(
        target,
        nextCode,
        targetMode,
        freshSource.projectFileHash,
      );
      if (!stableRead) throw new Error("guarded replacement did not return a baseline");
      if (!stableRead.ok && stableRead.reason === "stale") {
        return NextResponse.json(
          { ok: false, error: "The project file changed since this sketch was imported. Import the current file before replacing it." },
          { status: 409 },
        );
      }
      if (!stableRead.ok) {
        return NextResponse.json(
          { ok: false, error: "The project file changed while Canvas was preparing the update. Try again." },
          { status: 409 },
        );
      }

      try {
        const updatedArtifact = {
          ...freshArtifact,
          source: { ...freshSource, projectFileHash: nextHash },
          updatedAt: new Date().toISOString(),
        };
        const settled = await upsertCanvasArtifact(updatedArtifact, {
          expectedUpdatedAt: freshArtifact.updatedAt,
        });
        if (settled.status !== "saved" || !settled.artifact) {
          throw new Error("artifact changed while project file was being applied");
        }
        return NextResponse.json({
          ok: true,
          projectRoot: root,
          filePath: freshSource.filePath,
          projectName: project.name,
          artifact: settled.artifact,
          artifacts: settled.file.artifacts,
        });
      } catch (error) {
        await replaceAtomically(target, stableRead.originalCode, targetMode).catch((rollbackError) => {
          console.error("api/canvas/project-file: rollback failed", rollbackError);
        });
        throw error;
      }
    } catch (error) {
      console.error("api/canvas/project-file: write failed", error);
      return NextResponse.json({ ok: false, error: "Couldn't write the sketch to the project." }, { status: 500 });
    }
  });
}
