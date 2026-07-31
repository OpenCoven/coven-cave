import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type {
  ResearchGeneration,
  ResearchGenerationContent,
  ResearchMediaRenderConfig,
} from "../research-generations.ts";
import type { ResearchMission } from "../research-missions.ts";
import type {
  ResearchMediaJobDefinition,
  ResearchMediaJobFactory,
} from "./research-media-job-contract.ts";

const temporary = await mkdtemp(
  path.join(tmpdir(), "cave-research-media-job-factory-"),
);
const originalGenerationsDir = process.env.COVEN_RESEARCH_GENERATIONS_DIR;
const originalMissionsDir = process.env.COVEN_RESEARCH_MISSIONS_DIR;
process.env.COVEN_RESEARCH_GENERATIONS_DIR = path.join(
  temporary,
  "research-generations",
);
process.env.COVEN_RESEARCH_MISSIONS_DIR = path.join(
  temporary,
  "research-missions",
);

const { createResearchMediaJobDefinition } = await import(
  "./research-media-job-factory.ts"
);
const {
  createResearchMediaGenerationFromMission,
  listResearchGenerations,
} = await import("./research-generations.ts");
const { queueResearchMediaGeneration } = await import(
  "./research-media-jobs.ts"
);
const {
  createResearchMissionWorkspace,
  missionArtifactPath,
  saveResearchMission,
} = await import("./research-mission-store.ts");

after(async () => {
  if (originalGenerationsDir === undefined) {
    delete process.env.COVEN_RESEARCH_GENERATIONS_DIR;
  } else {
    process.env.COVEN_RESEARCH_GENERATIONS_DIR = originalGenerationsDir;
  }
  if (originalMissionsDir === undefined) {
    delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
  } else {
    process.env.COVEN_RESEARCH_MISSIONS_DIR = originalMissionsDir;
  }
  await rm(temporary, { recursive: true, force: true });
});

const renderConfig = {
  provider: "local" as const,
  voice: "piper-lessac-medium",
  length: "standard" as const,
};

const podcastContent = {
  kind: "podcast" as const,
  script: [{ id: "segment-1", text: "Source-grounded narration." }],
};

function generation(
  kind: ResearchGeneration["kind"] = "podcast",
  content: ResearchGenerationContent = podcastContent,
  overrides: Partial<ResearchGeneration> = {},
): ResearchGeneration {
  return {
    version: 2,
    id: `generation-${kind}`,
    familiarId: "factory-familiar",
    kind,
    sourceMissionId: "mission-factory",
    sourceTitle: "Factory mission",
    status: "rendering",
    renderConfig,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    content,
    ...overrides,
  };
}

function inertDefinition(
  familiarId: string,
  generationId: string,
  content: ResearchGenerationContent,
): ResearchMediaJobDefinition {
  if (
    content.kind !== "podcast" &&
    content.kind !== "short-video" &&
    content.kind !== "long-video"
  ) {
    throw new Error("test definition requires media content");
  }
  return {
    familiarId,
    generationId,
    run: async () => ({ content }),
  };
}

test("factory dispatches exact persisted content and render configuration", () => {
  const calls: Array<{
    kind: "podcast" | "short-video" | "long-video";
    input: unknown;
  }> = [];
  const dependencies = {
    createPodcast: (input: Parameters<
      typeof import("./research-podcast-pipeline.ts")["createPodcastMediaJobDefinition"]
    >[0]) => {
      calls.push({ kind: "podcast", input });
      return inertDefinition(input.familiarId, input.generationId, podcastContent);
    },
    createShortVideo: (input: Parameters<
      typeof import("./research-short-video-pipeline.ts")["createShortVideoMediaJobDefinition"]
    >[0]) => {
      calls.push({ kind: "short-video", input });
      return inertDefinition(input.familiarId, input.generationId, {
        kind: "short-video",
        storyboard: input.storyboard,
      });
    },
    createLongVideo: (input: {
      familiarId: string;
      generationId: string;
      chapters: Extract<
        ResearchGenerationContent,
        { kind: "long-video" }
      >["chapters"];
      renderConfig: ResearchMediaRenderConfig;
    }) => {
      calls.push({ kind: "long-video", input });
      return inertDefinition(input.familiarId, input.generationId, {
        kind: "long-video",
        chapters: input.chapters,
      });
    },
  };

  createResearchMediaJobDefinition(generation(), dependencies);
  createResearchMediaJobDefinition(
    generation(
      "short-video",
      {
        kind: "short-video",
        storyboard: [
          {
            id: "scene-1",
            title: "Evidence",
            bullets: ["One fact"],
            narration: "One fact.",
          },
        ],
      },
      {
        id: "generation-short",
        renderConfig: { ...renderConfig, length: "brief" },
      },
    ),
    dependencies,
  );
  createResearchMediaJobDefinition(
    generation(
      "long-video",
      {
        kind: "long-video",
        chapters: [
          {
            id: "chapter-1",
            title: "Evidence",
            scenes: [
              {
                id: "scene-1",
                title: "Evidence",
                bullets: ["One fact"],
                narration: "One fact.",
              },
            ],
          },
        ],
      },
      { id: "generation-long" },
    ),
    dependencies,
  );

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.kind), [
    "podcast",
    "short-video",
    "long-video",
  ]);
  for (const call of calls) {
    assert.deepEqual(
      (call.input as { renderConfig: unknown }).renderConfig,
      call.kind === "short-video"
        ? { ...renderConfig, length: "brief" }
        : renderConfig,
    );
  }
});

test("factory rejects missing config, mismatched content, and unsupported kinds", () => {
  assert.throws(
    () =>
      createResearchMediaJobDefinition(
        generation("podcast", podcastContent, { renderConfig: undefined }),
      ),
    /render configuration/,
  );
  assert.throws(
    () =>
      createResearchMediaJobDefinition(
        generation("podcast", {
          kind: "short-video",
          storyboard: [],
        }),
      ),
    /matching media content/,
  );
  assert.throws(
    () =>
      createResearchMediaJobDefinition(
        generation("blog", { kind: "blog", markdown: "# Draft" }),
      ),
    /not a renderable media generation/,
  );
  assert.throws(
    () =>
      createResearchMediaJobDefinition(
        generation("long-video", {
          kind: "long-video",
          chapters: [],
        }),
      ),
    /at least one chapter/,
  );
});

test("factory registers the production long-video definition", () => {
  const definition = createResearchMediaJobDefinition(
    generation(
      "long-video",
      {
        kind: "long-video",
        chapters: [
          {
            id: "chapter-1",
            title: "Evidence",
            scenes: [
              {
                id: "scene-1",
                title: "Evidence",
                bullets: ["One fact"],
                narration: "One fact.",
              },
            ],
          },
        ],
      },
      { id: "generation-long-production" },
    ),
  );
  assert.equal(definition.generationId, "generation-long-production");
  assert.equal(typeof definition.run, "function");
  assert.equal(typeof definition.kill, "function");
});

test("a real mission artifact drafts, queues once, and reaches ready", async () => {
  const familiarId = "factory-lifecycle";
  const mission: ResearchMission = {
    version: 1,
    id: "mission-media-lifecycle",
    familiarId,
    title: "Evidence synthesis",
    intent: "Synthesize the published evidence",
    mode: "brief",
    modeSource: "user",
    deliverable: "brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 30,
      maxIterations: 2,
      sourceTarget: 3,
      checkpointEvery: 1,
      stopWhenCostUnavailable: false,
    },
    status: "completed",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    iterations: [],
    artifacts: [
      {
        key: "primary",
        kind: "brief",
        title: "Published brief",
        relativePath: "artifacts/primary.md",
        iteration: 1,
        state: "published",
        updatedAt: "2026-07-29T00:00:00.000Z",
      },
    ],
    sources: [],
  };
  await createResearchMissionWorkspace(mission);
  await writeFile(
    missionArtifactPath(mission.id, "primary.md"),
    "# Evidence synthesis\n\n## Finding\n\nThe verified result is source grounded.\n",
    "utf8",
  );
  await saveResearchMission(mission);

  const drafted = await createResearchMediaGenerationFromMission({
    familiarId,
    kind: "podcast",
    sourceMissionId: mission.id,
    renderConfig,
  });
  assert.equal(drafted.ok && drafted.generation.status, "draft");
  if (!drafted.ok) return;

  const fakeFactory: ResearchMediaJobFactory = (queued) => {
    assert.equal(queued.renderConfig?.voice, renderConfig.voice);
    assert.equal(queued.content?.kind, "podcast");
    return {
      familiarId: queued.familiarId,
      generationId: queued.id,
      run: async () => ({
        content: {
          kind: "podcast",
          script:
            queued.content?.kind === "podcast" ? queued.content.script : [],
          audio: {
            key: "podcast.wav",
            mimeType: "audio/wav",
            sizeBytes: 44,
            provider: renderConfig.provider,
            voice: renderConfig.voice,
          },
        },
      }),
    };
  };

  const [queued, duplicate] = await Promise.all([
    queueResearchMediaGeneration(familiarId, drafted.generation.id, fakeFactory),
    queueResearchMediaGeneration(familiarId, drafted.generation.id, fakeFactory),
  ]);
  const accepted = queued.ok ? queued : duplicate;
  const rejected = queued.ok ? duplicate : queued;
  assert.equal(accepted.ok && accepted.generation.status, "queued");
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "invalid-state");
  if (!accepted.ok) return;

  await accepted.done;
  const ready = (await listResearchGenerations(familiarId)).find(
    (candidate) => candidate.id === drafted.generation.id,
  );
  assert.equal(ready?.status, "ready");
  assert.equal(ready?.content?.kind, "podcast");
});
