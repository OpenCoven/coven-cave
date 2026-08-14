import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type {
  ResearchGenerationStoryboardScene,
  ResearchMediaRenderConfig,
} from "../research-generations.ts";
import type { ResearchMediaJobContext } from "./research-media-job-contract.ts";

const mediaRoot = await mkdtemp(path.join(tmpdir(), "cave-short-video-pipeline-"));
const previousMediaRoot = process.env.COVEN_RESEARCH_MEDIA_DIR;
process.env.COVEN_RESEARCH_MEDIA_DIR = mediaRoot;

const { createShortVideoMediaJobDefinition } =
  await import("./research-short-video-pipeline.ts");
const {
  openResearchGenerationMedia,
  readResearchGenerationMediaBytes,
} = await import("./research-media-store.ts");

after(async () => {
  if (previousMediaRoot === undefined) delete process.env.COVEN_RESEARCH_MEDIA_DIR;
  else process.env.COVEN_RESEARCH_MEDIA_DIR = previousMediaRoot;
  await rm(mediaRoot, { recursive: true, force: true });
});

const storyboard: ResearchGenerationStoryboardScene[] = [
  {
    id: "scene-1",
    title: "Finding one",
    bullets: ["First extracted claim"],
    narration: "First narration",
  },
  {
    id: "scene-2",
    title: "Finding two",
    bullets: ["Second extracted claim"],
    narration: "Second narration",
  },
];

function renderConfig(
  overrides: Partial<ResearchMediaRenderConfig> = {},
): ResearchMediaRenderConfig {
  return {
    provider: "local",
    voice: "piper-lessac-medium",
    length: "brief",
    ...overrides,
  };
}

function context(controller = new AbortController()): ResearchMediaJobContext {
  return {
    reportStage: async () => {},
    signal: controller.signal,
    isCancellationRequested: () => controller.signal.aborted,
  };
}

test("short video is a configured wrapper around the shared renderer and streaming publisher", async () => {
  let rendererInput:
    | {
        provider: string;
        voice: string;
        maxDurationMs: number;
        signal: AbortSignal;
      }
    | undefined;
  const controller = new AbortController();
  const definition = createShortVideoMediaJobDefinition(
    {
      familiarId: "nova",
      generationId: "short-1",
      storyboard,
      renderConfig: renderConfig(),
    },
    {
      renderVideoSequence: async (input) => {
        rendererInput = input;
        await writeFile(input.outputPath, "fake-mp4");
        return {
          durationMs: 12_000,
          provider: input.provider,
          voice: input.voice,
        };
      },
    },
  );
  const result = await definition.run(context(controller));
  assert.equal(rendererInput?.provider, "local");
  assert.equal(rendererInput?.voice, "piper-lessac-medium");
  assert.equal(rendererInput?.maxDurationMs, 30_000);
  assert.ok(rendererInput?.signal instanceof AbortSignal);
  assert.equal(rendererInput?.signal.aborted, false);
  assert.equal(result.content.kind, "short-video");
  if (result.content.kind !== "short-video") return;
  assert.equal(result.content.video?.mimeType, "video/mp4");
  assert.equal(result.content.video?.provider, "local");
  assert.equal(result.content.video?.voice, "piper-lessac-medium");
  assert.equal(result.content.video?.durationMs, 12_000);
  assert.deepEqual(
    await readResearchGenerationMediaBytes(
      "nova",
      "short-1",
      "short-video.mp4",
    ),
    new TextEncoder().encode("fake-mp4"),
  );
});

test("kill aborts the same shared signal and cancellation publishes no media", async () => {
  let rendererStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    rendererStarted = resolve;
  });
  const definition = createShortVideoMediaJobDefinition(
    {
      familiarId: "nova",
      generationId: "short-cancel",
      storyboard,
      renderConfig: renderConfig({ length: "standard" }),
    },
    {
      renderVideoSequence: async (input) => {
        rendererStarted();
        await new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener(
            "abort",
            () => reject(new Error("renderer aborted")),
            { once: true },
          );
        });
        assert.fail("aborted renderer cannot return");
      },
    },
  );
  const running = definition.run(context());
  await started;
  definition.kill?.();
  await assert.rejects(() => running, /short-video render cancelled/);
  await assert.rejects(
    () => openResearchGenerationMedia(
      "nova",
      "short-cancel",
      "short-video.mp4",
    ),
    /media file not found/,
  );
});

test("short video rejects a stored storyboard beyond the selected scene budget", async () => {
  const definition = createShortVideoMediaJobDefinition(
    {
      familiarId: "nova",
      generationId: "short-over-budget",
      storyboard: Array.from({ length: 7 }, (_, index) => ({
        id: `scene-${index + 1}`,
        title: `Finding ${index + 1}`,
        bullets: [],
        narration: `Narration ${index + 1}`,
      })),
      renderConfig: renderConfig({ length: "brief" }),
    },
    {
      renderVideoSequence: async () => {
        assert.fail("an over-budget storyboard must not reach the renderer");
      },
    },
  );

  await assert.rejects(
    () => definition.run(context()),
    /brief short-video scene budget \(6\) exceeded/,
  );
});

test("short video rejects a stored storyboard beyond the selected narration budget before rendering", async () => {
  const definition = createShortVideoMediaJobDefinition(
    {
      familiarId: "nova",
      generationId: "short-over-narration-budget",
      storyboard: [
        {
          id: "scene-1",
          title: "Finding one",
          bullets: [],
          narration: "n".repeat(301),
        },
      ],
      renderConfig: renderConfig({ length: "brief" }),
    },
    {
      renderVideoSequence: async () => {
        assert.fail("an over-budget storyboard must not reach the renderer");
      },
    },
  );

  await assert.rejects(
    () => definition.run(context()),
    /brief short-video narration budget \(300\) exceeded/,
  );
});

test("short-video source never buffers the rendered MP4 with readFile", async () => {
  const source = await readFile(
    new URL("./research-short-video-pipeline.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /publishResearchGenerationMediaFile/);
  assert.doesNotMatch(source, /readFile\(outputPath\)/);
});
