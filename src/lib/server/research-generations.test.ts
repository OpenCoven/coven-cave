import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type {
  ResearchArtifactRef,
  ResearchMission,
} from "../research-missions.ts";

const tmp = await mkdtemp(path.join(tmpdir(), "cave-research-generations-"));
const originalGenerationsDir = process.env.COVEN_RESEARCH_GENERATIONS_DIR;
const originalMissionsDir = process.env.COVEN_RESEARCH_MISSIONS_DIR;
process.env.COVEN_RESEARCH_GENERATIONS_DIR = path.join(tmp, "research-generations");
process.env.COVEN_RESEARCH_MISSIONS_DIR = path.join(tmp, "research-missions");

const {
  createResearchGenerationFromMission,
  draftGenerationContent,
  listResearchGenerations,
  pickGenerationSourceArtifact,
  removeResearchGeneration,
  researchGenerationsPath,
} = await import("./research-generations.ts");
const { createResearchMissionWorkspace, missionArtifactPath, saveResearchMission } =
  await import("./research-mission-store.ts");

after(async () => {
  if (originalGenerationsDir === undefined) delete process.env.COVEN_RESEARCH_GENERATIONS_DIR;
  else process.env.COVEN_RESEARCH_GENERATIONS_DIR = originalGenerationsDir;
  if (originalMissionsDir === undefined) delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
  else process.env.COVEN_RESEARCH_MISSIONS_DIR = originalMissionsDir;
  await rm(tmp, { recursive: true, force: true });
});

const FINDINGS_MD = [
  "# Eval pricing landscape",
  "",
  "Intro line naming 11 primary sources.",
  "",
  "## Key numbers",
  "",
  "- 4–9× cost advantage at matched quality",
  "- 200K-token synthesis threshold",
  "- fifth bullet caps at four", // 3rd
  "",
  "**Retrieval beats stuffing on cost** across model families.",
  "",
  "## Hosted tier",
  "",
  "Braintrust meters per trace at $0.25 per 1K evals.",
  "",
  "```",
  "code fence with 9999× fake numbers must be ignored",
  "```",
  "",
  "## Recommendation",
  "",
  "- OSS for CI gates",
  "",
].join("\n");

function baseMission(id: string, familiarId: string): ResearchMission {
  const now = "2026-07-20T10:00:00.000Z";
  return {
    version: 1,
    id,
    familiarId,
    title: "Eval-harness pricing landscape",
    intent: "Map the eval-harness pricing landscape across hosted and OSS tiers",
    mode: "sweep",
    modeSource: "auto",
    deliverable: "report",
    constraints: [],
    bounds: {
      wallClockMinutes: 60,
      maxIterations: 4,
      sourceTarget: 10,
      checkpointEvery: 2,
      stopWhenCostUnavailable: false,
    },
    status: "completed",
    createdAt: now,
    updatedAt: now,
    iterations: [
      {
        number: 1,
        status: "completed",
        steps: [
          { id: "scope", type: "phase", status: "succeeded" },
          { id: "gather", type: "phase", status: "succeeded" },
          { id: "synthesize", type: "phase", status: "succeeded" },
        ],
      },
    ],
    artifacts: [],
    sources: [],
  };
}

function artifactRef(overrides: Partial<ResearchArtifactRef>): ResearchArtifactRef {
  return {
    key: "findings",
    kind: "findings",
    title: "Findings — eval pricing",
    relativePath: "artifacts/findings.md",
    iteration: 1,
    state: "published",
    updatedAt: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

async function seedMission(
  id: string,
  familiarId: string,
  artifacts: ResearchArtifactRef[],
  files: Record<string, string>,
): Promise<ResearchMission> {
  const mission = { ...baseMission(id, familiarId), artifacts };
  await createResearchMissionWorkspace(mission);
  for (const [fileName, contents] of Object.entries(files)) {
    await writeFile(missionArtifactPath(id, fileName), contents, "utf8");
  }
  await saveResearchMission(mission);
  return mission;
}

const mission = await seedMission(
  "mission-alpha",
  "nova",
  [
    artifactRef({
      key: "old-working",
      title: "Working draft",
      relativePath: "artifacts/working.md",
      state: "working",
      updatedAt: "2026-07-19T09:00:00.000Z",
    }),
    artifactRef({ key: "findings" }),
    artifactRef({
      key: "rejected",
      title: "Rejected pass",
      relativePath: "artifacts/rejected.md",
      state: "rejected",
      updatedAt: "2026-07-21T09:00:00.000Z",
    }),
    artifactRef({
      key: "data",
      title: "Raw data",
      relativePath: "artifacts/data.json",
      updatedAt: "2026-07-21T09:00:00.000Z",
    }),
  ],
  {
    "findings.md": FINDINGS_MD,
    "working.md": "# Older working copy\n",
    "rejected.md": "# Rejected copy\n",
    "data.json": "{}",
  },
);

// ── source artifact selection ────────────────────────────────────────────────

test("source pick: newest published markdown wins; rejected and non-md never qualify", () => {
  const picked = pickGenerationSourceArtifact(mission);
  assert.equal(picked?.key, "findings");

  const workingOnly = pickGenerationSourceArtifact({
    artifacts: mission.artifacts.filter((artifact) => artifact.state !== "published"),
  });
  assert.equal(workingOnly?.key, "old-working", "falls back to working when nothing is published");

  assert.equal(
    pickGenerationSourceArtifact({
      artifacts: mission.artifacts.filter((artifact) => artifact.state === "rejected"),
    }),
    null,
  );
});

test("source pick: primary lineage wins over a newer published standard ref", () => {
  // A manually-retried research-log publish (or any standard-ref publish at
  // a checkpoint) must never outrank the primary just for being newer —
  // cave research-final-artifacts Fix 1.
  const picked = pickGenerationSourceArtifact({
    artifacts: [
      artifactRef({
        key: "primary",
        title: "Primary draft",
        relativePath: "artifacts/primary.md",
        state: "published",
        updatedAt: "2026-07-19T09:00:00.000Z",
      }),
      artifactRef({
        key: "research-log",
        title: "Research log",
        relativePath: "research-log.md",
        state: "published",
        updatedAt: "2026-07-22T09:00:00.000Z",
      }),
    ],
  });
  assert.equal(picked?.key, "primary");
});

test("source pick: a working primary beats a published standard ref at a checkpoint", () => {
  const picked = pickGenerationSourceArtifact({
    artifacts: [
      artifactRef({
        key: "primary",
        title: "Primary draft",
        relativePath: "artifacts/primary.md",
        state: "working",
        updatedAt: "2026-07-19T09:00:00.000Z",
      }),
      artifactRef({
        key: "research-log",
        title: "Research log",
        relativePath: "research-log.md",
        state: "published",
        updatedAt: "2026-07-22T09:00:00.000Z",
      }),
    ],
  });
  assert.equal(picked?.key, "primary");
});

test("source pick: a later-iteration primary (primary-iN key) is still primary lineage", () => {
  // startNextIteration resurrects a rejected primary under key `primary-i${n}`
  // while keeping relativePath "artifacts/primary.md" (research-mission-runner.ts
  // startNextIteration). Both signals must independently identify the lineage.
  const picked = pickGenerationSourceArtifact({
    artifacts: [
      artifactRef({
        key: "primary-i2",
        title: "Primary draft, iteration 2",
        relativePath: "artifacts/primary.md",
        state: "working",
        updatedAt: "2026-07-19T09:00:00.000Z",
      }),
      artifactRef({
        key: "research-log",
        title: "Research log",
        relativePath: "research-log.md",
        state: "published",
        updatedAt: "2026-07-22T09:00:00.000Z",
      }),
    ],
  });
  assert.equal(picked?.key, "primary-i2");
});

test("source pick: falls back to the newest published/working ref when no primary lineage exists", () => {
  // Unchanged legacy behavior — verified explicitly so Fix 1's "prefer
  // primary lineage" branch doesn't shadow the pre-existing fallback.
  const picked = pickGenerationSourceArtifact({
    artifacts: [
      artifactRef({
        key: "research-log",
        title: "Research log",
        relativePath: "research-log.md",
        state: "published",
        updatedAt: "2026-07-19T09:00:00.000Z",
      }),
      artifactRef({
        key: "findings",
        title: "Findings",
        relativePath: "findings.md",
        state: "published",
        updatedAt: "2026-07-22T09:00:00.000Z",
      }),
    ],
  });
  assert.equal(picked?.key, "findings");
});

// ── extractive drafting per kind ─────────────────────────────────────────────

test("blog = the artifact markdown as an editable copy with a provenance first line", async () => {
  const result = await createResearchGenerationFromMission({
    familiarId: "nova",
    kind: "blog",
    sourceMissionId: "mission-alpha",
  });
  assert.ok(result.ok);
  const { content } = result.generation;
  assert.equal(content?.kind, "blog");
  if (content?.kind !== "blog") return;
  const [firstLine] = content.markdown.split("\n");
  assert.match(firstLine, /Findings — eval pricing/);
  assert.match(firstLine, /Eval-harness pricing landscape/);
  assert.ok(content.markdown.endsWith(FINDINGS_MD), "artifact markdown is carried verbatim");
  assert.equal(result.generation.sourceArtifactKey, "findings");
  assert.equal(result.generation.status, "ready");
});

test("slides = headings + first bullets outline, nothing invented", async () => {
  const result = await createResearchGenerationFromMission({
    familiarId: "nova",
    kind: "slides",
    sourceMissionId: "mission-alpha",
  });
  assert.ok(result.ok);
  const { content } = result.generation;
  assert.equal(content?.kind, "slides");
  if (content?.kind !== "slides") return;
  assert.equal(content.slides[0].title, "Eval pricing landscape", "cover = document H1");
  assert.deepEqual(
    content.slides.slice(1).map((slide) => slide.title),
    ["Key numbers", "Hosted tier", "Recommendation"],
  );
  assert.deepEqual(content.slides[1].bullets, [
    "4–9× cost advantage at matched quality",
    "200K-token synthesis threshold",
    "fifth bullet caps at four",
  ]);
  // A bullet-less section falls back to its first body line — still verbatim.
  assert.deepEqual(content.slides[2].bullets, [
    "Braintrust meters per trace at $0.25 per 1K evals.",
  ]);
});

test("thread = hook from the mission title + claims from bold lines and headings", async () => {
  const result = await createResearchGenerationFromMission({
    familiarId: "nova",
    kind: "thread",
    sourceMissionId: "mission-alpha",
  });
  assert.ok(result.ok);
  const { content } = result.generation;
  assert.equal(content?.kind, "thread");
  if (content?.kind !== "thread") return;
  const total = content.posts.length;
  assert.equal(content.posts[0].text, "Eval-harness pricing landscape", "hook = mission title");
  content.posts.forEach((post, index) => {
    assert.equal(post.pre, `${index + 1}/${total}`, "n/N prefixes are pure structure");
  });
  assert.ok(
    content.posts.some((post) => post.text === "Retrieval beats stuffing on cost across model families."
      || post.text === "Retrieval beats stuffing on cost"),
    "emphasized claims are carried",
  );
  assert.ok(
    content.posts.some((post) => post.text.startsWith("Key numbers — ")),
    "heading claims pair the heading with its first bullet",
  );
});

test("diagram = mermaid built from phase steps + artifact section structure", async () => {
  const result = await createResearchGenerationFromMission({
    familiarId: "nova",
    kind: "diagram",
    sourceMissionId: "mission-alpha",
  });
  assert.ok(result.ok);
  const { content } = result.generation;
  assert.equal(content?.kind, "diagram");
  if (content?.kind !== "diagram") return;
  const lines = content.mermaid.split("\n");
  assert.equal(lines[0], "graph TD");
  assert.ok(lines.includes('  P0["scope"]'));
  assert.ok(lines.includes("  P0 --> P1"));
  assert.ok(lines.includes("  P2 --> A0"), "phase chain feeds the artifact node");
  assert.ok(lines.includes('  S0["Key numbers"]'));
  assert.ok(lines.includes("  A0 --> S2"));
});

test("infographic = numbers regex-extracted with their line context; fences ignored", async () => {
  const result = await createResearchGenerationFromMission({
    familiarId: "nova",
    kind: "infographic",
    sourceMissionId: "mission-alpha",
  });
  assert.ok(result.ok);
  const { content } = result.generation;
  assert.equal(content?.kind, "infographic");
  if (content?.kind !== "infographic") return;
  const values = content.stats.map((stat) => stat.value);
  assert.ok(values.includes("4–9×"), `4–9× extracted (${values.join(" | ")})`);
  const threshold = content.stats.find((stat) => stat.value.includes("200"));
  assert.ok(threshold, "200K threshold extracted");
  assert.equal(threshold?.context, "200K-token synthesis threshold", "context is the source line");
  assert.ok(
    content.stats.every((stat) => !stat.context.includes("fake numbers")),
    "code-fence numbers never become stats",
  );
});

// ── directions are forwarded, never interpreted ──────────────────────────────

test("directions are stored verbatim but never steer the extracted content", async () => {
  const directed = await createResearchGenerationFromMission({
    familiarId: "nova",
    kind: "slides",
    sourceMissionId: "mission-alpha",
    directions: "lead with the cost numbers, keep it under 3 minutes",
  });
  assert.ok(directed.ok);
  assert.equal(
    directed.generation.directions,
    "lead with the cost numbers, keep it under 3 minutes",
  );
  const undirected = draftGenerationContent("slides", {
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: FINDINGS_MD,
  });
  assert.deepEqual(directed.generation.content, undirected, "same source ⇒ same content");
});

// ── typed failures ───────────────────────────────────────────────────────────

test("a mission whose markdown artifacts are all rejected fails typed (route maps to 409)", async () => {
  await seedMission(
    "mission-bare",
    "nova",
    [
      artifactRef({
        key: "findings",
        kind: "findings",
        title: "Findings",
        relativePath: "artifacts/findings.md",
        state: "rejected",
        rejectionReason: "too sparse to publish",
      }),
      artifactRef({
        key: "source-ledger",
        kind: "source-ledger",
        title: "Source ledger",
        relativePath: "artifacts/sources.json",
        state: "working",
      }),
      artifactRef({
        key: "research-log",
        kind: "research-log",
        title: "Research log",
        relativePath: "artifacts/research-log.md",
        state: "rejected",
        rejectionReason: "incomplete",
      }),
    ],
    {},
  );
  const result = await createResearchGenerationFromMission({
    familiarId: "nova",
    kind: "blog",
    sourceMissionId: "mission-bare",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "no-artifact");
  assert.match(result.error, /no markdown artifact/);
});


test("unknown missions and other familiars' missions read as not found", async () => {
  const missing = await createResearchGenerationFromMission({
    familiarId: "nova",
    kind: "blog",
    sourceMissionId: "mission-nope",
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "mission-not-found");

  const foreign = await createResearchGenerationFromMission({
    familiarId: "someone-else",
    kind: "blog",
    sourceMissionId: "mission-alpha",
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.code, "mission-not-found");
});

// ── persistence ──────────────────────────────────────────────────────────────

test("generations persist newest-first, per familiar, and remove by id", async () => {
  const listed = await listResearchGenerations("nova");
  assert.ok(listed.length >= 5, "the drafts above were persisted");
  const sorted = [...listed].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  assert.deepEqual(listed.map((generation) => generation.id), sorted.map((g) => g.id));

  // The store survives a fresh read from disk (persisted JSON, not memory).
  const onDisk = JSON.parse(await readFile(researchGenerationsPath("nova"), "utf8")) as {
    version: number;
    generations: unknown[];
  };
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.generations.length, listed.length);

  assert.deepEqual(await listResearchGenerations("someone-else"), [], "files are per familiar");

  const [first] = listed;
  assert.equal(await removeResearchGeneration("nova", first.id), true);
  assert.equal(await removeResearchGeneration("nova", first.id), false, "second removal misses");
  const afterRemove = await listResearchGenerations("nova");
  assert.ok(!afterRemove.some((generation) => generation.id === first.id));
});

test("a corrupt store file is preserved aside, never silently wiped", async () => {
  const target = researchGenerationsPath("nova");
  const valid = await readFile(target, "utf8");
  await writeFile(target, valid.replace(/\}\s*$/, "},"), "utf8");

  const result = await createResearchGenerationFromMission({
    familiarId: "nova",
    kind: "blog",
    sourceMissionId: "mission-alpha",
  });
  assert.ok(result.ok);

  const siblings = await readdir(path.dirname(target));
  const backups = siblings.filter((name) => name.startsWith("nova.json.corrupt-"));
  assert.ok(backups.length >= 1, "malformed file preserved as .corrupt-<ts>");
});

test("same-millisecond corruption events keep distinct aside captures", async () => {
  const target = researchGenerationsPath("nova");
  const dir = path.dirname(target);
  const valid = await readFile(target, "utf8");
  const before = new Set((await readdir(dir)).filter((name) => name.includes(".corrupt-")));

  // Freeze the clock: the aside name's timestamp is millisecond-resolution,
  // so without the random suffix both captures below would target the SAME
  // path and copyFile would clobber the first (see corruptAsidePath).
  const RealDate = Date;
  const frozenMs = new RealDate("2026-01-01T00:00:00.000Z").getTime();
  globalThis.Date = class extends RealDate {
    constructor() {
      super(frozenMs);
    }
  } as DateConstructor;
  try {
    await writeFile(target, "{ corrupt take one", "utf8");
    assert.deepEqual(await listResearchGenerations("nova"), [], "a corrupt store reads as empty");
    await writeFile(target, "{ corrupt take two", "utf8");
    assert.deepEqual(
      await listResearchGenerations("nova"),
      [],
      "the second corruption also reads as empty",
    );
  } finally {
    globalThis.Date = RealDate;
  }

  const fresh = (await readdir(dir)).filter(
    (name) => name.includes(".corrupt-") && !before.has(name),
  );
  assert.equal(fresh.length, 2, "each corruption event keeps its own capture");
  const captured = await Promise.all(fresh.map((name) => readFile(path.join(dir, name), "utf8")));
  assert.ok(captured.includes("{ corrupt take one"), "the first capture survives");
  assert.ok(captured.includes("{ corrupt take two"), "the second capture survives");

  await writeFile(target, valid, "utf8");
});

test("path safety: traversal-shaped familiar ids are rejected outright", async () => {
  await assert.rejects(() => listResearchGenerations("../evil"), /invalid familiar id/);
  await assert.rejects(() => removeResearchGeneration("a/b", "x"), /invalid familiar id/);
  assert.throws(() => researchGenerationsPath("nova/.."), /invalid familiar id/);
});
