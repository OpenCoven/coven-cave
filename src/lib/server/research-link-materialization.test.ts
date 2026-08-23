import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ResearchMission } from "../research-missions.ts";
import { xArticleContentSha256 } from "./x-article-content-sha.ts";
import {
  materializeSavedLinkForMission,
} from "./research-link-materialization.ts";
import { saveResearchLinks } from "./research-links.ts";
import {
  createResearchMissionWorkspace,
  researchMissionWorkspacePath,
  restoreResearchMissionSourceFile,
  writeResearchMissionSourceFile,
} from "./research-mission-store.ts";

const originalMissionsRoot = process.env.COVEN_RESEARCH_MISSIONS_DIR;
const originalLinksPath = process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE;
const root = path.join(process.cwd(), `.research-link-materialization-${process.pid}`);

function mission(id: string): ResearchMission {
  return {
    version: 1,
    id,
    familiarId: "sage",
    title: "Materialization mission",
    intent: "Preserve a saved X Article",
    mode: "brief",
    modeSource: "user",
    deliverable: "brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 20,
      maxIterations: 1,
      sourceTarget: 6,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "planning",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    iterations: [],
    artifacts: [],
    sources: [],
  };
}

async function saveArticle(
  url = "https://x.com/opencoven/status/123",
  author: { id: string; username: string; displayName?: string } = {
    id: "42",
    username: "opencoven",
    displayName: "OpenCoven",
  },
) {
  const body = "Durable research\n\nFull body.";
  const sourcePostId = new URL(url).pathname.split("/").at(-1)!;
  const snapshot = {
    version: 1 as const,
    provider: "sorsa" as const,
    sourcePostId,
    titleSource: "provider" as const,
    author,
    body,
    excerpt: "Durable research",
    publishedAt: "2026-08-17T20:00:00.000Z",
    fetchedAt: "2026-08-18T00:00:00.000Z",
    contentSha256: xArticleContentSha256(body),
  };
  (snapshot as unknown as Record<string, unknown>).credential = "secret-token";
  const saved = await saveResearchLinks(
    [url],
    "desk",
    new Map([[
      url,
      {
        xArticle: {
          title: "Durable research",
          snapshot,
        },
      },
    ]]),
  );
  assert.equal(saved.added.length, 1);
  return saved.added[0]!;
}

before(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  process.env.COVEN_RESEARCH_MISSIONS_DIR = path.join(root, "missions");
  process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = path.join(root, "research-links.json");
});

after(async () => {
  if (originalMissionsRoot === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
  else process.env.COVEN_RESEARCH_MISSIONS_DIR = originalMissionsRoot;
  if (originalLinksPath === undefined) delete process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE;
  else process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = originalLinksPath;
  await rm(root, { recursive: true, force: true });
});

test("a saved X Article materializes deterministically with durable provenance", async () => {
  const saved = await saveArticle();
  const workspace = await createResearchMissionWorkspace(mission("materialized-article"));

  const first = await materializeSavedLinkForMission(workspace, saved.id);
  const second = await materializeSavedLinkForMission(workspace, saved.id);

  assert.deepEqual(second.source, first.source);
  assert.match(first.source.id, /^saved-[a-f0-9]{24}$/);
  assert.match(first.source.localPath ?? "", /^source-files\/x-article-[a-f0-9]{24}\.md$/);
  assert.doesNotMatch(first.source.localPath ?? "", new RegExp(saved.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(first.source, {
    id: first.source.id,
    title: "Durable research",
    url: "https://x.com/opencoven/status/123",
    localPath: first.source.localPath,
    publisher: "OpenCoven",
    publishedAt: "2026-08-17T20:00:00.000Z",
    sourceType: "x-article",
    status: "candidate",
  });
  const markdown = await readFile(
    path.join(researchMissionWorkspacePath(workspace.id), first.source.localPath!),
    "utf8",
  );
  assert.equal(markdown, `# Durable research

- Source: https://x.com/opencoven/status/123
- Author: OpenCoven (@opencoven)
- Published: 2026-08-17T20:00:00.000Z
- Fetched: 2026-08-18T00:00:00.000Z
- Provider: sorsa
- Content SHA-256: ${xArticleContentSha256("Durable research\n\nFull body.")}

Durable research

Full body.
`);
  assert.doesNotMatch(markdown, /secret-token|credential|research-links\.json/i);
});

test("saved Article author display-name falls back to the X username", async () => {
  const saved = await saveArticle(
    "https://x.com/opencoven/status/124",
    { id: "42", username: "opencoven" },
  );
  const workspace = await createResearchMissionWorkspace(mission("author-fallback"));
  const materialized = await materializeSavedLinkForMission(workspace, saved.id);

  assert.equal(materialized.source.publisher, "@opencoven");
  assert.match(
    await readFile(
      path.join(researchMissionWorkspacePath(workspace.id), materialized.source.localPath!),
      "utf8",
    ),
    /- Author: @opencoven\n/,
  );
});

test("ordinary saved links become candidate web sources without source files", async () => {
  const workspace = await createResearchMissionWorkspace(mission("missing-article"));
  const nonArticle = await saveResearchLinks(["https://example.com/reference"], "desk");

  await assert.rejects(
    () => materializeSavedLinkForMission(workspace, "missing-link"),
    { message: "saved link not found" },
  );
  const materialized = await materializeSavedLinkForMission(workspace, nonArticle.added[0]!.id);
  assert.deepEqual(materialized.source, {
    id: materialized.source.id,
    title: nonArticle.added[0]!.title,
    url: "https://example.com/reference",
    sourceType: "web",
    status: "candidate",
  });
  assert.match(materialized.source.id, /^saved-[a-f0-9]{24}$/);
  await materialized.rollback();
});

test("rollback restores exact overwritten contents and only removes the newly-created source file", async () => {
  const saved = await saveArticle("https://x.com/opencoven/status/125");
  const workspace = await createResearchMissionWorkspace(mission("materialization-rollback"));
  const created = await materializeSavedLinkForMission(workspace, saved.id);
  const createdPath = path.join(researchMissionWorkspacePath(workspace.id), created.source.localPath!);
  await created.rollback();
  await assert.rejects(() => readFile(createdPath, "utf8"), { code: "ENOENT" });

  await mkdir(path.dirname(createdPath), { recursive: true });
  const previous = "exact prior\ncontent\n";
  await writeFile(createdPath, previous);
  const overwritten = await materializeSavedLinkForMission(workspace, saved.id);
  assert.notEqual(await readFile(createdPath, "utf8"), previous);
  await overwritten.rollback();
  assert.equal(await readFile(createdPath, "utf8"), previous);
});

test("source-file helpers enforce strict filenames and source-files containment", async () => {
  const workspace = await createResearchMissionWorkspace(mission("source-file-containment"));
  const fileName = "x-article-0123456789abcdef01234567.md";
  const written = await writeResearchMissionSourceFile(workspace.id, fileName, "first\n");
  assert.equal(written.path, `source-files/${fileName}`);
  assert.equal(written.previous, null);
  const overwritten = await writeResearchMissionSourceFile(workspace.id, fileName, "second\n");
  assert.equal(overwritten.previous, "first\n");
  await restoreResearchMissionSourceFile(
    workspace.id,
    fileName,
    overwritten.previous,
    overwritten.expected,
  );
  assert.equal(
    await readFile(path.join(researchMissionWorkspacePath(workspace.id), written.path), "utf8"),
    "first\n",
  );
  await assert.rejects(
    () => writeResearchMissionSourceFile(workspace.id, "../escape.md", "no"),
    /invalid source filename/,
  );

  const linkedWorkspace = await createResearchMissionWorkspace(mission("source-file-symlink"));
  const sourceDirectory = path.join(researchMissionWorkspacePath(linkedWorkspace.id), "source-files");
  const outsideDirectory = path.join(root, "outside-source-files");
  await mkdir(outsideDirectory, { recursive: true });
  await symlink(outsideDirectory, sourceDirectory, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    () => writeResearchMissionSourceFile(linkedWorkspace.id, fileName, "no"),
    /source-files.*real directory/i,
  );

  const linkedTargetWorkspace = await createResearchMissionWorkspace(mission("source-file-target-symlink"));
  const linkedTargetDirectory = path.join(
    researchMissionWorkspacePath(linkedTargetWorkspace.id),
    "source-files",
  );
  const outsideTarget = path.join(root, "outside-source-file.md");
  await mkdir(linkedTargetDirectory, { recursive: true });
  await writeFile(outsideTarget, "outside\n");
  await symlink(outsideTarget, path.join(linkedTargetDirectory, fileName));
  await assert.rejects(
    () => writeResearchMissionSourceFile(linkedTargetWorkspace.id, fileName, "no"),
    /symlink/i,
  );
});

test("a source-file write failure never materializes a source", async () => {
  const saved = await saveArticle("https://x.com/opencoven/status/126");
  const workspace = await createResearchMissionWorkspace(mission("source-file-write-failure"));
  const materialized = await materializeSavedLinkForMission(workspace, saved.id);
  await materialized.rollback();
  await mkdir(
    path.join(researchMissionWorkspacePath(workspace.id), materialized.source.localPath!),
  );

  await assert.rejects(
    () => materializeSavedLinkForMission(workspace, saved.id),
  );
});
