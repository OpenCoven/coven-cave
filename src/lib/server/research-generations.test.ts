import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";

import type {
  ResearchArtifactRef,
  ResearchMission,
} from "../research-missions.ts";
import { RESEARCH_THREAD_POST_MAX_CHARS } from "../research-generations.ts";

const tmp = await mkdtemp(path.join(tmpdir(), "cave-research-generations-"));
const originalGenerationsDir = process.env.COVEN_RESEARCH_GENERATIONS_DIR;
const originalMissionsDir = process.env.COVEN_RESEARCH_MISSIONS_DIR;
process.env.COVEN_RESEARCH_GENERATIONS_DIR = path.join(tmp, "research-generations");
process.env.COVEN_RESEARCH_MISSIONS_DIR = path.join(tmp, "research-missions");

const {
  MAX_RESEARCH_GENERATIONS,
  createResearchGenerationFromMission,
  createResearchMediaGenerationFromMission,
  draftPodcastContent,
  draftVideoStoryboardContent,
  draftGenerationContent,
  listResearchGenerations,
  pickGenerationSourceArtifact,
  removeResearchGeneration,
  removeResearchGenerationIfInactive,
  researchGenerationsPath,
  transitionResearchGeneration,
} = await import("./research-generations.ts");
const { createResearchMissionWorkspace, missionArtifactPath, saveResearchMission } =
  await import("./research-mission-store.ts");
const execFileAsync = promisify(execFile);

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
  assert.ok(total <= 8, "the thread never exceeds MAX_THREAD_POSTS");
  assert.equal(content.posts[0].text, "Eval-harness pricing landscape", "hook = mission title");
  content.posts.forEach((post, index) => {
    assert.equal(post.pre, `${index + 1}/${total}`, "n/N prefixes are pure structure");
    assert.ok(
      post.text.length <= RESEARCH_THREAD_POST_MAX_CHARS,
      `post ${index + 1} fits the social budget`,
    );
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
  // The closer is fixed boilerplate around verbatim titles (same shape as the
  // blog provenance line) — the thread always says where it came from.
  const closer = content.posts[total - 1].text;
  assert.match(closer, /^Full findings: /);
  assert.ok(closer.includes("Findings — eval pricing"), "closer names the artifact");
  assert.ok(closer.includes("Eval-harness pricing landscape"), "closer names the run");
  // Remaining room is filled with the sections' other bullets, verbatim.
  assert.ok(
    content.posts.some((post) => post.text === "200K-token synthesis threshold"),
    "extra section bullets fill remaining posts",
  );
});

test("thread posts clamp at a word boundary and dedupe against the hook", () => {
  const longClaim =
    "Retrieval-augmented evaluation pipelines consistently outperform naive context stuffing on both cost and accuracy across every model family we measured, with the gap widening as corpora grow beyond the two-hundred-thousand-token synthesis threshold that hosted tiers meter so aggressively today";
  assert.ok(longClaim.length > RESEARCH_THREAD_POST_MAX_CHARS, "fixture must exceed the budget");
  const markdown = [
    "# Doc",
    "",
    `**${longClaim}**`,
    "",
    "**Eval-harness pricing landscape** repeated as bold.",
    "",
  ].join("\n");
  const content = draftGenerationContent("thread", {
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown,
  });
  assert.equal(content.kind, "thread");
  if (content.kind !== "thread") return;
  const clamped = content.posts.find((post) => post.text.endsWith("…"));
  assert.ok(clamped, "over-budget claims are clamped with a visible ellipsis");
  assert.ok(clamped.text.length <= RESEARCH_THREAD_POST_MAX_CHARS);
  assert.ok(
    longClaim.startsWith(clamped.text.slice(0, -1)),
    "clamp truncates verbatim text — never rephrases",
  );
  assert.notEqual(clamped.text.at(-2), " ", "clamp cuts at a word boundary");
  // A bold line repeating the mission title doesn't produce a duplicate post.
  const hookMatches = content.posts.filter(
    (post) => post.text === "Eval-harness pricing landscape",
  );
  assert.equal(hookMatches.length, 1, "the hook is never duplicated by a bold claim");
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

test("podcast drafter creates bounded extractive narration segments", () => {
  const content = draftPodcastContent({
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: [
      "# Heading-less source",
      "",
      "A standalone paragraph with a claim.",
      "",
      "Another paragraph with enough source material to become narration.",
    ].join("\n"),
  }, "standard");
  assert.equal(content.kind, "podcast");
  if (content.kind !== "podcast") return;
  assert.ok(content.script.length >= 2, "heading-less artifacts still produce a draft");
  assert.ok(content.script.every((segment) => segment.text.length > 0));
  assert.ok(content.script.every((segment) => segment.text.length <= 4_000));
  assert.equal(content.script[0].speaker, "host", "a host opening frames the episode");
  assert.ok(content.script[1].text.includes("A standalone paragraph with a claim."));
  assert.ok(
    content.script.every(
      (segment) => segment.speaker === "host" || segment.speaker === "guest",
    ),
    "every drafted segment carries a dialogue speaker",
  );
});

test("podcast drafter drafts a host/guest dialogue with templated framing only", () => {
  const content = draftPodcastContent({
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: [
      "# Findings",
      "",
      "## Gating mechanisms",
      "",
      "- Gates bind proxies, not purposes.",
      "",
      "## Consolidation levers",
      "",
      "- Does goal-guarding generalize?",
    ].join("\n"),
  }, "standard");
  assert.equal(content.kind, "podcast");
  if (content.kind !== "podcast") return;
  const script = content.script;
  assert.equal(script[0].speaker, "host");
  assert.ok(
    script[0].text.includes(mission.title),
    "the opening names the mission title, nothing invented",
  );
  const framing = script.filter(
    (segment) =>
      segment.text.includes("Gating mechanisms") || segment.text.includes("Consolidation levers"),
  );
  assert.deepEqual(
    framing.map((segment) => segment.speaker),
    ["host", "host"],
    "each titled section gets one host framing line",
  );
  assert.ok(
    framing.every((segment) => !segment.text.includes("..")),
    "framing reuses punctuation-aware headings",
  );
  // Charm review #2: host bridges rotate through distinct jobs rather than
  // repeating one generic line per style.
  assert.notEqual(
    framing[0].text.replace("Gating mechanisms", "§"),
    framing[1].text.replace("Consolidation levers", "§"),
    "consecutive sections get different bridge copy",
  );
  const guests = script.filter((segment) => segment.speaker === "guest");
  assert.ok(
    guests.some((segment) => segment.text.includes("Gates bind proxies, not purposes.")),
    "findings are delivered verbatim by the guest",
  );
  assert.deepEqual(
    script.map((segment) => segment.id),
    script.map((_, index) => `segment-${index + 1}`),
    "segment ids stay sequential",
  );
  // Charm review #5: a section ends on the host's synthesis turn, never on
  // the guest's last list item.
  const last = script[script.length - 1];
  assert.equal(last.speaker, "host", "the episode closes on a host synthesis turn");
  assert.ok(
    !last.text.includes("Consolidation levers"),
    "the closing host turn is a synthesis, not an orphan framing line",
  );
});

test("podcast drafter translates document furniture into listener questions", () => {
  const content = draftPodcastContent({
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: [
      "# Findings",
      "",
      "## Executive summary",
      "",
      "- Gates bind proxies, not purposes.",
      "",
      "## Open questions",
      "",
      "- Does goal-guarding generalize?",
      "",
      "## Recommended next steps",
      "",
      "- Re-run the sweep in a quarter.",
    ].join("\n"),
  }, "standard");
  assert.equal(content.kind, "podcast");
  if (content.kind !== "podcast") return;
  const texts = content.script.map((segment) => segment.text);
  for (const furniture of ["Executive summary", "Open questions", "Recommended next steps"]) {
    assert.ok(
      texts.every((text) => !text.includes(furniture)),
      `"${furniture}" is never spoken aloud`,
    );
  }
  const questions = content.script.filter((segment) =>
    [
      "what's the headline here?",
      "What's still unsettled after all of this?",
      "So where does this go from here?",
    ].some((question) => segment.text.includes(question)),
  );
  assert.equal(questions.length, 3, "each furniture heading becomes a listener question");
  assert.ok(
    questions.every((segment) => segment.speaker === "host"),
    "furniture questions are host turns",
  );
});

test("podcast drafter strips citation apparatus from speech, keeps prose verbatim", () => {
  const content = draftPodcastContent({
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: [
      "# Findings",
      "",
      "## Gating mechanisms",
      "",
      "- Formal proofs are blocked (S8, S16; high).",
      "- Benchmarks preserve scores, not intent (the DGM lesson).",
      "- External outcomes should decide promotion [S01](../sources.json) [S06].",
      "- Robust goal-guarding traces to training choices (S20 2025-06; high confidence).",
    ].join("\n"),
  }, "standard");
  assert.equal(content.kind, "podcast");
  if (content.kind !== "podcast") return;
  const narration = content.script.map((segment) => segment.text).join(" ");
  assert.ok(
    narration.includes("Formal proofs are blocked."),
    `ledger-id parentheticals never reach speech (${narration})`,
  );
  assert.ok(
    narration.includes("(the DGM lesson)"),
    "prose parentheticals stay verbatim",
  );
  assert.ok(
    narration.includes("External outcomes should decide promotion."),
    `bracketed and link-form ledger ids never reach speech (${narration})`,
  );
  assert.ok(
    narration.includes("Robust goal-guarding traces to training choices."),
    `dated confidence parentheticals never reach speech (${narration})`,
  );
  assert.ok(!/\bS\d{1,3}\b/.test(narration), `no bare ledger ids in speech (${narration})`);
});

test("podcast styles branch the drafter without inventing findings", () => {
  const source = {
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: [
      "# Findings",
      "",
      "## Gating mechanisms",
      "",
      "- Gates bind proxies, not purposes.",
      "",
      "## Open questions",
      "",
      "- Does goal-guarding generalize?",
    ].join("\n"),
  };
  const recap = draftPodcastContent(source, "standard", "recap");
  assert.equal(recap.kind, "podcast");
  if (recap.kind !== "podcast") return;
  assert.ok(
    recap.script.every((segment) => segment.speaker === undefined),
    "recap is a single-narrator read-through with no dialogue turns",
  );
  assert.ok(
    recap.script[0].text.includes("Gates bind proxies, not purposes."),
    "recap starts straight into the findings, no templated opening",
  );

  const debate = draftPodcastContent(source, "standard", "debate");
  assert.equal(debate.kind, "podcast");
  if (debate.kind !== "podcast") return;
  assert.ok(debate.script[0].text.includes("stress-testing"));
  const debateUnsettled = debate.script.findIndex((segment) =>
    segment.text.includes("What's still unsettled"),
  );
  const debateGates = debate.script.findIndex((segment) =>
    segment.text.includes("Gating mechanisms"),
  );
  assert.ok(
    debateUnsettled !== -1 && debateGates !== -1 && debateUnsettled < debateGates,
    "debate leads with the contested section",
  );

  const interview = draftPodcastContent(source, "standard", "interview");
  assert.equal(interview.kind, "podcast");
  if (interview.kind !== "podcast") return;
  assert.ok(interview.script[0].text.includes("my guest walks us through"));
  assert.ok(
    interview.script.some((segment) =>
      segment.text.startsWith("Walk me through this part — Gating mechanisms"),
    ),
  );

  // The default is breakdown — an unstyled call and an explicit breakdown
  // call draft the identical script.
  assert.deepEqual(
    draftPodcastContent(source, "standard"),
    draftPodcastContent(source, "standard", "breakdown"),
  );
});

test("podcast drafter joins are punctuation-aware — never a double period", () => {
  const content = draftPodcastContent({
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: [
      "# Punctuated findings",
      "",
      "## Claim ledger (with caveats)",
      "",
      "- Formal proofs are blocked (by Löb's theorem).",
      "- Does goal-guarding generalize?",
      "- Benchmarks bind proxies (the DGM lesson)",
      "- an unterminated bullet",
    ].join("\n"),
  }, "standard");
  assert.equal(content.kind, "podcast");
  if (content.kind !== "podcast") return;
  const narration = content.script.map((segment) => segment.text).join(" ");
  assert.ok(!narration.includes(".."), `no double periods (${narration})`);
  assert.ok(!narration.includes("?."), `no punctuation stacking after ? (${narration})`);
  assert.ok(
    narration.includes("(the DGM lesson) an unterminated bullet."),
    "paren-terminated fragments are not re-punctuated",
  );
  assert.ok(
    narration.includes("Claim ledger (with caveats)"),
    "the heading still frames its details",
  );
});

test("podcast drafter skips table-only sections instead of speaking bare headings", () => {
  const content = draftPodcastContent({
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: [
      "# Findings",
      "",
      "## Mechanism comparison",
      "",
      "| Mechanism | Guarantee |",
      "|---|---|",
      "| Proof-gated | formal |",
      "",
      "## Empty section",
      "",
      "## Detailed findings",
      "",
      "- Gates bind proxies, not purposes.",
    ].join("\n"),
  }, "standard");
  assert.equal(content.kind, "podcast");
  if (content.kind !== "podcast") return;
  const texts = content.script.map((segment) => segment.text);
  assert.ok(
    texts.every((text) => text !== "Mechanism comparison" && text !== "Mechanism comparison."),
    "table-only sections never become orphan spoken headings",
  );
  assert.ok(
    texts.every((text) => !text.startsWith("Empty section")),
    "empty sections are skipped",
  );
  assert.ok(
    texts.some((text) => text.includes("Gates bind proxies, not purposes.")),
    "sections with speakable details survive",
  );
});

test("podcast drafter clamps a long source mechanically at the local TTS limit", () => {
  const longLine = `A ${"verbatim source claim ".repeat(300)}`;
  const content = draftPodcastContent({
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: `# Long source\n\n${longLine}`,
  }, "standard");
  assert.equal(content.kind, "podcast");
  if (content.kind !== "podcast") return;
  assert.ok(content.script.length > 1, "long narration is split into bounded segments");
  assert.ok(content.script.every((segment) => segment.text.length <= 4_000));
  assert.ok(content.script.some((segment) => segment.text.includes("verbatim source claim")));
});

test("podcast drafter prefers sentence boundaries when splitting long units into turns", () => {
  // Dogfood round 2 (cave-2emgc): chunks become separate spoken turns, so a
  // continuation turn opening mid-sentence ("it can appear where you didn't…")
  // is a speech bug. Sentences short enough to pack many per chunk.
  const sentences = Array.from(
    { length: 60 },
    (_, i) => `Claim number ${i + 1} holds under repeated evaluation pressure.`,
  ).join(" ");
  const content = draftPodcastContent({
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: `# Long findings\n\n## Detailed findings\n\n- ${sentences}`,
  }, "standard");
  assert.equal(content.kind, "podcast");
  if (content.kind !== "podcast") return;
  const guestTurns = content.script.filter((segment) => segment.speaker === "guest");
  assert.ok(guestTurns.length > 1, "long unit split into multiple turns");
  for (const turn of guestTurns) {
    assert.match(
      turn.text,
      /^[A-Z0-9(“"']/,
      `turn never opens mid-sentence (${turn.text.slice(0, 40)}…)`,
    );
    assert.match(
      turn.text,
      /[.!?…]["'”’)\]]*$/,
      `turn never ends mid-sentence (…${turn.text.slice(-40)})`,
    );
  }
});

test("podcast openings speak a cleaned mission title — no trailing '.…' garbage", () => {
  const messyMission = {
    ...mission,
    title: "Research and compare: Identity Preservation for Agents during Self-Evolution.…",
  };
  for (const style of ["breakdown", "debate", "interview"] as const) {
    const content = draftPodcastContent({
      mission: messyMission,
      artifact: { key: "findings", title: "Findings" },
      markdown: "# Findings\n\n## Detailed findings\n\n- Gates bind proxies, not purposes.",
    }, "standard", style);
    assert.equal(content.kind, "podcast");
    if (content.kind !== "podcast") return;
    const opening = content.script[0]?.text ?? "";
    assert.ok(
      opening.includes("“Identity Preservation for Agents during Self-Evolution”"),
      `${style} opening speaks the framed question, cleanly terminated (${opening})`,
    );
    assert.ok(
      !opening.includes("Research and compare:"),
      `${style} opening never reads the research-prompt prefix aloud (${opening})`,
    );
    assert.ok(!opening.includes(".…"), `${style} opening never speaks '.…'`);
  }
});

test("podcast drafter normalizes TTS-hostile glyphs into spoken words", () => {
  const content = draftPodcastContent({
    mission,
    artifact: { key: "findings", title: "Findings" },
    markdown: [
      "# Findings",
      "",
      "## Throughput → cost curve",
      "",
      "- Throughput improved 3× at ≥ 90% recall (≈ baseline cost).",
    ].join("\n"),
  }, "standard", "debate");
  assert.equal(content.kind, "podcast");
  if (content.kind !== "podcast") return;
  const narration = content.script.map((segment) => segment.text).join(" ");
  assert.ok(narration.includes("Throughput to cost curve"), `arrow spoken as 'to' (${narration})`);
  assert.ok(narration.includes("3 times at at least 90%"), `× and ≥ spoken (${narration})`);
  assert.ok(narration.includes("about baseline cost"), `≈ spoken as 'about' (${narration})`);
  for (const glyph of ["→", "×", "≥", "≈"]) {
    assert.ok(!narration.includes(glyph), `no raw ${glyph} reaches speech`);
  }
});

test("video storyboard drafter maps headings, bullets, and narration without invention", () => {
  const content = draftVideoStoryboardContent({
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: FINDINGS_MD,
  }, "standard");
  assert.equal(content.kind, "short-video");
  if (content.kind !== "short-video") return;
  assert.deepEqual(content.storyboard[0], {
    id: "scene-1",
    title: "Key numbers",
    bullets: [
      "4–9× cost advantage at matched quality",
      "200K-token synthesis threshold",
      "fifth bullet caps at four",
    ],
    narration: "Key numbers. 4–9× cost advantage at matched quality. 200K-token synthesis threshold. fifth bullet caps at four",
  });
  assert.ok(content.storyboard.every((scene) => scene.id.startsWith("scene-")));
});

test("short-video drafts keep complete source bullets within each preset narration budget", () => {
  const source = {
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: [
      "# Bounded video source",
      "",
      "## Executive summary",
      "",
      `- ${"First evidence-backed finding ".repeat(6).trim()}.`,
      `- ${"Second evidence-backed finding ".repeat(6).trim()}.`,
      `- ${"Third evidence-backed finding ".repeat(6).trim()}.`,
      "",
      "## Next steps",
      "",
      `- ${"Follow-up finding ".repeat(6).trim()}.`,
    ].join("\n"),
  };

  const brief = draftVideoStoryboardContent(source, "brief");
  const standard = draftVideoStoryboardContent(source, "standard");
  assert.equal(brief.kind, "short-video");
  assert.equal(standard.kind, "short-video");
  if (brief.kind !== "short-video" || standard.kind !== "short-video") return;

  const narrationLength = (content: typeof brief) =>
    content.storyboard.reduce((total, scene) => total + scene.narration.length, 0);
  assert.ok(narrationLength(brief) <= 300, "brief narration must fit its 30-second budget");
  assert.ok(narrationLength(standard) <= 600, "standard narration must fit its 60-second budget");
  assert.ok(brief.storyboard.length > 0, "brief keeps the leading fitting source bullet");
  assert.ok(
    narrationLength(standard) > narrationLength(brief),
    "standard admits more source detail",
  );
  assert.ok(brief.storyboard.length <= standard.storyboard.length);
  for (const content of [brief, standard]) {
    for (const scene of content.storyboard) {
      assert.equal(scene.narration, [scene.title, ...scene.bullets].join(". "));
      assert.ok(source.markdown.includes(scene.title), "scene heading remains source-extractive");
      assert.ok(
        scene.bullets.every((bullet) => source.markdown.includes(bullet)),
        "scene bullets remain source-extractive",
      );
    }
  }
});

test("short-video drafts retain a fitting title when its source detail exceeds the remaining budget", () => {
  const content = draftVideoStoryboardContent({
    mission,
    artifact: { key: "findings", title: "Findings — eval pricing" },
    markdown: [
      "# Bounded video source",
      "",
      "## Fitting heading",
      "",
      `- ${"Oversized source detail ".repeat(20).trim()}.`,
    ].join("\n"),
  }, "brief");

  assert.equal(content.kind, "short-video");
  if (content.kind !== "short-video") return;
  assert.deepEqual(content.storyboard, [{
    id: "scene-1",
    title: "Fitting heading",
    bullets: [],
    narration: "Fitting heading",
  }]);
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

test("media creation drafts reviewable source content into a queued record", async () => {
  const result = await createResearchMediaGenerationFromMission({
    familiarId: "nova",
    kind: "podcast",
    sourceMissionId: "mission-alpha",
    renderConfig: {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.generation.status, "draft");
  assert.equal(result.generation.content?.kind, "podcast");
  assert.deepEqual(result.generation.renderConfig, {
    provider: "local",
    voice: "piper-lessac-medium",
    length: "standard",
  });
  assert.equal(result.generation.stage, undefined, "draft records do not invent progress");
  assert.equal(result.generation.progress, undefined, "draft records do not invent progress units");
});

test("media creation rejects an artifact with no narratable findings", async () => {
  await seedMission(
    "mission-title-only",
    "title-only-familiar",
    [
      artifactRef({
        key: "primary",
        title: "Title only",
        relativePath: "artifacts/primary.md",
      }),
    ],
    { "primary.md": "# Title only\n" },
  );
  const result = await createResearchMediaGenerationFromMission({
    familiarId: "title-only-familiar",
    kind: "podcast",
    sourceMissionId: "mission-title-only",
    renderConfig: {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "brief",
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "media-not-ready");
    assert.match(result.error, /no narratable findings/);
  }
  assert.deepEqual(
    await listResearchGenerations("title-only-familiar"),
    [],
  );
});

test("old WIP v2 media rows without render config remain readable but cannot queue", async () => {
  const familiarId = "wip-v2-familiar";
  const oldWip = {
    version: 2,
    generations: [
      {
        version: 2,
        id: "wip-media-generation",
        familiarId,
        kind: "podcast",
        sourceMissionId: "mission-alpha",
        sourceTitle: "Old WIP media",
        status: "draft",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        content: {
          kind: "podcast",
          script: [{ id: "segment-1", text: "Verbatim source narration." }],
        },
      },
    ],
  };
  await mkdir(path.dirname(researchGenerationsPath(familiarId)), { recursive: true });
  await writeFile(researchGenerationsPath(familiarId), JSON.stringify(oldWip), "utf8");

  const [generation] = await listResearchGenerations(familiarId);
  assert.equal(generation.id, "wip-media-generation");
  assert.equal(generation.renderConfig, undefined);

  const transition = await transitionResearchGeneration(
    familiarId,
    generation.id,
    ["draft"],
    { status: "queued" },
  );
  assert.deepEqual(transition, {
    ok: false,
    code: "invalid-state",
    generation,
  });
});

test("long-video drafting groups H2 sections into ordered, preset-bounded chapters", async () => {
  const markdown = [
    "# Study",
    "",
    "## Context",
    "",
    "Context sentence.",
    "",
    "### Prior work",
    "",
    "- Prior detail",
    "",
    "## Methods",
    "",
    "- Method A",
    "",
    "### Sampling",
    "",
    "Sampling detail.",
    "",
    "## Results",
    "",
    "- Result A",
    "",
    "## Limits",
    "",
    "- Limit A",
    "",
    "## Appendix",
    "",
    "- Appendix detail",
  ].join("\n");
  await seedMission(
    "mission-chapters",
    "chapters-familiar",
    [
      artifactRef({
        key: "primary",
        title: "Chapter findings",
        relativePath: "artifacts/primary.md",
      }),
    ],
    { "primary.md": markdown },
  );

  const result = await createResearchMediaGenerationFromMission({
    familiarId: "chapters-familiar",
    kind: "long-video",
    sourceMissionId: "mission-chapters",
    renderConfig: {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "brief",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok || result.generation.content?.kind !== "long-video") return;
  assert.deepEqual(
    result.generation.content.chapters.map((chapter) => chapter.title),
    ["Context", "Methods", "Results", "Limits"],
    "brief long video preserves the first four H2 chapters in source order",
  );
  assert.deepEqual(
    result.generation.content.chapters[0].scenes.map((scene) => scene.title),
    ["Context", "Prior work"],
    "subordinate sections stay with their H2 chapter",
  );
});

test("simultaneous draft compare-and-set transitions produce exactly one winner", async () => {
  const result = await createResearchMediaGenerationFromMission({
    familiarId: "nova",
    kind: "podcast",
    sourceMissionId: "mission-alpha",
    renderConfig: {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "brief",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const outcomes = await Promise.all([
    transitionResearchGeneration("nova", result.generation.id, ["draft"], {
      status: "queued",
    }),
    transitionResearchGeneration("nova", result.generation.id, ["draft"], {
      status: "queued",
    }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
  assert.equal(
    outcomes.filter((outcome) => !outcome.ok && outcome.code === "invalid-state").length,
    1,
  );
});

test("compare-and-set stays atomic across separate Node processes", async () => {
  const familiarId = "cross-process-cas";
  await seedMission(
    "mission-cross-process-cas",
    familiarId,
    [
      artifactRef({
        key: "primary",
        title: "CAS source",
        relativePath: "artifacts/primary.md",
      }),
    ],
    { "primary.md": FINDINGS_MD },
  );
  const result = await createResearchMediaGenerationFromMission({
    familiarId,
    kind: "podcast",
    sourceMissionId: "mission-cross-process-cas",
    renderConfig: {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "brief",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const moduleUrl = new URL("./research-generations.ts", import.meta.url).href;
  const childSource = [
    `process.env.COVEN_RESEARCH_GENERATIONS_DIR = ${JSON.stringify(process.env.COVEN_RESEARCH_GENERATIONS_DIR)};`,
    `const store = await import(${JSON.stringify(moduleUrl)});`,
    `const result = await store.transitionResearchGeneration(${JSON.stringify(familiarId)}, ${JSON.stringify(result.generation.id)}, ["draft"], { status: "queued" });`,
    "console.log(JSON.stringify(result));",
  ].join("\n");
  const outcomes = await Promise.all(
    [1, 2].map(async () => {
      const { stdout } = await execFileAsync(process.execPath, [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        childSource,
      ]);
      return JSON.parse(stdout.trim()) as { ok: boolean; code?: string };
    }),
  );

  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
  assert.equal(
    outcomes.filter(
      (outcome) => !outcome.ok && outcome.code === "invalid-state",
    ).length,
    1,
  );
});

test("atomic removal rejects queued media until it reaches a non-active state", async () => {
  const result = await createResearchMediaGenerationFromMission({
    familiarId: "nova",
    kind: "podcast",
    sourceMissionId: "mission-alpha",
    renderConfig: {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "brief",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const queued = await transitionResearchGeneration(
    "nova",
    result.generation.id,
    ["draft"],
    { status: "queued" },
  );
  assert.equal(queued.ok, true);

  const activeRemoval = await removeResearchGenerationIfInactive(
    "nova",
    result.generation.id,
  );
  assert.equal(activeRemoval.ok, false);
  if (!activeRemoval.ok) assert.equal(activeRemoval.code, "active");
  assert.ok(
    (await listResearchGenerations("nova")).some(
      (generation) => generation.id === result.generation.id,
    ),
  );

  const cancelled = await transitionResearchGeneration(
    "nova",
    result.generation.id,
    ["queued"],
    { status: "cancelled" },
  );
  assert.equal(cancelled.ok, true);
  const removed = await removeResearchGenerationIfInactive(
    "nova",
    result.generation.id,
  );
  assert.equal(removed.ok, true);
  assert.ok(
    !(await listResearchGenerations("nova")).some(
      (generation) => generation.id === result.generation.id,
    ),
  );
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

test("a full store returns a typed capacity conflict without evicting any row", async () => {
  const familiarId = "capacity-familiar";
  await seedMission(
    "mission-capacity",
    familiarId,
    [
      artifactRef({
        key: "primary",
        title: "Capacity source",
        relativePath: "artifacts/primary.md",
      }),
    ],
    { "primary.md": FINDINGS_MD },
  );
  const originalIds = Array.from(
    { length: MAX_RESEARCH_GENERATIONS },
    (_, index) => `capacity-${index + 1}`,
  );
  await mkdir(path.dirname(researchGenerationsPath(familiarId)), {
    recursive: true,
  });
  await writeFile(
    researchGenerationsPath(familiarId),
    JSON.stringify({
      version: 2,
      generations: originalIds.map((id, index) => ({
        version: 2,
        id,
        familiarId,
        kind: "blog",
        sourceMissionId: "mission-capacity",
        sourceTitle: "Capacity source",
        status: "ready",
        createdAt: new Date(index).toISOString(),
        updatedAt: new Date(index).toISOString(),
        content: { kind: "blog", markdown: `# Existing ${index + 1}` },
      })),
    }),
    "utf8",
  );

  const extractive = await createResearchGenerationFromMission({
    familiarId,
    kind: "blog",
    sourceMissionId: "mission-capacity",
  });
  const media = await createResearchMediaGenerationFromMission({
    familiarId,
    kind: "podcast",
    sourceMissionId: "mission-capacity",
    renderConfig: {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "brief",
    },
  });

  assert.deepEqual(extractive, {
    ok: false,
    code: "capacity",
    error:
      "Research Studio has reached its 200-generation limit. Remove a generation before creating another.",
  });
  assert.equal(media.ok, false);
  if (!media.ok) assert.equal(media.code, "capacity");
  const after = await listResearchGenerations(familiarId);
  assert.equal(after.length, MAX_RESEARCH_GENERATIONS);
  assert.deepEqual(
    new Set(after.map((generation) => generation.id)),
    new Set(originalIds),
  );
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
  assert.equal(onDisk.version, 2);
  assert.equal(onDisk.generations.length, listed.length);

  assert.deepEqual(await listResearchGenerations("someone-else"), [], "files are per familiar");

  const [first] = listed;
  assert.equal(await removeResearchGeneration("nova", first.id), true);
  assert.equal(await removeResearchGeneration("nova", first.id), false, "second removal misses");
  const afterRemove = await listResearchGenerations("nova");
  assert.ok(!afterRemove.some((generation) => generation.id === first.id));
});

test("v1 records migrate to the v2 contract on read without changing their content", async () => {
  const familiarId = "legacy-familiar";
  const legacy = {
    version: 1,
    generations: [
      {
        version: 1,
        id: "legacy-generation",
        familiarId,
        kind: "blog",
        sourceMissionId: "mission-alpha",
        sourceTitle: "Legacy mission",
        status: "ready",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        content: { kind: "blog", markdown: "# Legacy content" },
      },
    ],
  };
  await mkdir(path.dirname(researchGenerationsPath(familiarId)), { recursive: true });
  await writeFile(researchGenerationsPath(familiarId), JSON.stringify(legacy), "utf8");

  const [generation] = await listResearchGenerations(familiarId);
  assert.equal(generation.version, 2);
  assert.equal(generation.id, "legacy-generation");
  assert.equal(generation.status, "ready");
  assert.deepEqual(generation.content, { kind: "blog", markdown: "# Legacy content" });
  assert.equal(JSON.parse(await readFile(researchGenerationsPath(familiarId), "utf8")).version, 1);
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
