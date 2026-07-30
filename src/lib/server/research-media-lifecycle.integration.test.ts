import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { ResearchGeneration } from "../research-generations.ts";
import type { ResearchMission } from "../research-missions.ts";
import type { ResearchMediaJobFactory } from "./research-media-job-contract.ts";

const temporary = await mkdtemp(
  path.join(tmpdir(), "cave-research-media-lifecycle-"),
);
const previousDirectories = {
  generations: process.env.COVEN_RESEARCH_GENERATIONS_DIR,
  missions: process.env.COVEN_RESEARCH_MISSIONS_DIR,
  media: process.env.COVEN_RESEARCH_MEDIA_DIR,
};
process.env.COVEN_RESEARCH_GENERATIONS_DIR = path.join(
  temporary,
  "research-generations",
);
process.env.COVEN_RESEARCH_MISSIONS_DIR = path.join(
  temporary,
  "research-missions",
);
process.env.COVEN_RESEARCH_MEDIA_DIR = path.join(temporary, "research-media");

const {
  createResearchMediaGenerationFromMission,
  listResearchGenerations,
} = await import("./research-generations.ts");
const { queueResearchMediaGeneration } = await import(
  "./research-media-jobs.ts"
);
const { createPodcastMediaJobDefinition } = await import(
  "./research-podcast-pipeline.ts"
);
const { createShortVideoMediaJobDefinition } = await import(
  "./research-short-video-pipeline.ts"
);
const {
  openResearchGenerationMedia,
  parseResearchMediaRange,
} = await import("./research-media-store.ts");
const {
  createResearchMissionWorkspace,
  missionArtifactPath,
  saveResearchMission,
} = await import("./research-mission-store.ts");

after(async () => {
  if (previousDirectories.generations === undefined) {
    delete process.env.COVEN_RESEARCH_GENERATIONS_DIR;
  } else {
    process.env.COVEN_RESEARCH_GENERATIONS_DIR =
      previousDirectories.generations;
  }
  if (previousDirectories.missions === undefined) {
    delete process.env.COVEN_RESEARCH_MISSIONS_DIR;
  } else {
    process.env.COVEN_RESEARCH_MISSIONS_DIR = previousDirectories.missions;
  }
  if (previousDirectories.media === undefined) {
    delete process.env.COVEN_RESEARCH_MEDIA_DIR;
  } else {
    process.env.COVEN_RESEARCH_MEDIA_DIR = previousDirectories.media;
  }
  await rm(temporary, { recursive: true, force: true });
});

function pcmWav(durationMs = 100): Uint8Array {
  const sampleRate = 16_000;
  const sampleCount = Math.round((durationMs / 1_000) * sampleRate);
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (const [index, character] of [...value].entries()) {
      bytes[offset + index] = character.charCodeAt(0);
    }
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  return bytes;
}

async function seedMission(): Promise<ResearchMission> {
  const mission: ResearchMission = {
    version: 1,
    id: "mission-controlled-media",
    familiarId: "lifecycle-familiar",
    title: "Controlled media findings",
    intent: "Render published findings through controlled media seams",
    mode: "brief",
    modeSource: "user",
    deliverable: "brief",
    constraints: [],
    bounds: {
      wallClockMinutes: 30,
      maxIterations: 2,
      sourceTarget: 4,
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
        title: "Published findings",
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
    [
      "# Controlled media findings",
      "",
      "## Finding one",
      "",
      "- The first claim is grounded in the published artifact.",
      "",
      "## Finding two",
      "",
      "- The second claim remains in source order.",
      "",
    ].join("\n"),
    "utf8",
  );
  await saveResearchMission(mission);
  return mission;
}

async function readStoredRange(
  generation: ResearchGeneration,
): Promise<Uint8Array> {
  const ref =
    generation.content?.kind === "podcast"
      ? generation.content.audio
      : generation.content?.kind === "short-video"
        ? generation.content.video
        : undefined;
  assert.ok(ref);
  const opened = await openResearchGenerationMedia(
    generation.familiarId,
    generation.id,
    ref.key,
  );
  try {
    const range = parseResearchMediaRange(
      `bytes=0-${Math.min(7, opened.sizeBytes - 1)}`,
      opened.sizeBytes,
    );
    assert.ok(range);
    const bytes = new Uint8Array(range.end - range.start + 1);
    const read = await opened.handle.read(
      bytes,
      0,
      bytes.length,
      range.start,
    );
    return bytes.subarray(0, read.bytesRead);
  } finally {
    await opened.handle.close();
  }
}

test("real mission drafts queue through production runner and publish podcast and short-video media", async () => {
  const mission = await seedMission();
  const config = {
    provider: "local" as const,
    voice: "controlled-voice",
    length: "brief" as const,
  };
  const [podcastDraft, shortVideoDraft] = await Promise.all([
    createResearchMediaGenerationFromMission({
      familiarId: mission.familiarId,
      kind: "podcast",
      sourceMissionId: mission.id,
      renderConfig: config,
    }),
    createResearchMediaGenerationFromMission({
      familiarId: mission.familiarId,
      kind: "short-video",
      sourceMissionId: mission.id,
      renderConfig: config,
    }),
  ]);
  assert.equal(podcastDraft.ok && podcastDraft.generation.status, "draft");
  assert.equal(
    shortVideoDraft.ok && shortVideoDraft.generation.status,
    "draft",
  );
  if (!podcastDraft.ok || !shortVideoDraft.ok) return;

  const factory: ResearchMediaJobFactory = (generation) => {
    if (
      generation.kind === "podcast" &&
      generation.content?.kind === "podcast" &&
      generation.renderConfig
    ) {
      return createPodcastMediaJobDefinition(
        {
          familiarId: generation.familiarId,
          generationId: generation.id,
          script: generation.content.script,
          renderConfig: generation.renderConfig,
        },
        {
          synthesize: async (_text, provider, voice, signal) => {
            assert.equal(provider, config.provider);
            assert.equal(voice, config.voice);
            assert.equal(signal.aborted, false);
            return { bytes: pcmWav(), voice };
          },
        },
      );
    }
    if (
      generation.kind === "short-video" &&
      generation.content?.kind === "short-video" &&
      generation.renderConfig
    ) {
      return createShortVideoMediaJobDefinition(
        {
          familiarId: generation.familiarId,
          generationId: generation.id,
          storyboard: generation.content.storyboard,
          renderConfig: generation.renderConfig,
        },
        {
          renderVideoSequence: async (input) => {
            assert.equal(input.provider, config.provider);
            assert.equal(input.voice, config.voice);
            assert.equal(input.signal.aborted, false);
            await input.reportStage("synthesizing");
            await input.reportStage("encoding");
            await writeFile(
              input.outputPath,
              Buffer.from("controlled-seekable-mp4"),
            );
            return {
              durationMs: 1_000,
              provider: input.provider,
              voice: input.voice,
            };
          },
        },
      );
    }
    throw new Error("unexpected controlled lifecycle generation");
  };

  const podcastQueued = await queueResearchMediaGeneration(
    mission.familiarId,
    podcastDraft.generation.id,
    factory,
  );
  const shortVideoQueued = await queueResearchMediaGeneration(
    mission.familiarId,
    shortVideoDraft.generation.id,
    factory,
  );
  assert.equal(podcastQueued.ok && podcastQueued.generation.status, "queued");
  assert.equal(
    shortVideoQueued.ok && shortVideoQueued.generation.status,
    "queued",
  );
  if (!podcastQueued.ok || !shortVideoQueued.ok) return;
  await Promise.all([podcastQueued.done, shortVideoQueued.done]);

  const ready = await listResearchGenerations(mission.familiarId);
  const podcast = ready.find(
    (generation) => generation.id === podcastDraft.generation.id,
  );
  const shortVideo = ready.find(
    (generation) => generation.id === shortVideoDraft.generation.id,
  );
  assert.equal(podcast?.status, "ready");
  assert.equal(podcast?.content?.kind, "podcast");
  assert.equal(shortVideo?.status, "ready");
  assert.equal(shortVideo?.content?.kind, "short-video");
  assert.equal(
    Buffer.from(await readStoredRange(podcast!))
      .subarray(0, 4)
      .toString("ascii"),
    "RIFF",
  );
  assert.equal(
    Buffer.from(await readStoredRange(shortVideo!)).toString("ascii"),
    "controll",
  );
});
