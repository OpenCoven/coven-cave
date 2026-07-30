import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import type {
  ResearchGenerationVideoChapter,
  ResearchMediaRenderConfig,
} from "../research-generations.ts";
import type { ResearchMediaJobContext } from "./research-media-job-contract.ts";
import type { ResearchVideoProbe } from "./research-video-renderer.ts";

const { createLongVideoMediaJobDefinition } = await import(
  "./research-long-video-pipeline.ts"
);

const chapters: ResearchGenerationVideoChapter[] = [
  {
    id: "chapter-1",
    title: "First finding",
    scenes: [
      {
        id: "scene-1",
        title: "First finding",
        bullets: ["First source-grounded claim"],
        narration: "First source-grounded claim.",
      },
    ],
  },
  {
    id: "chapter-2",
    title: "Second finding",
    scenes: [
      {
        id: "scene-2",
        title: "Second finding",
        bullets: ["Second source-grounded claim"],
        narration: "Second source-grounded claim.",
      },
    ],
  },
];

const renderConfig: ResearchMediaRenderConfig = {
  provider: "local",
  voice: "piper-lessac-medium",
  length: "brief",
};

function context(
  controller: AbortController,
  reports: Parameters<ResearchMediaJobContext["reportStage"]>[],
): ResearchMediaJobContext {
  return {
    signal: controller.signal,
    isCancellationRequested: () => controller.signal.aborted,
    reportStage: async (...report) => {
      reports.push(report);
    },
  };
}

function validProbe(durationSeconds = "3"): ResearchVideoProbe {
  return {
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1280,
        height: 720,
        pix_fmt: "yuv420p",
      },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { duration: durationSeconds },
  };
}

test("renders chapters in order, reports chapter progress, and concatenates in order", async () => {
  const reports: Parameters<ResearchMediaJobContext["reportStage"]>[] = [];
  const rendered: Array<{
    title: string;
    provider: string;
    voice: string;
    signal: AbortSignal;
  }> = [];
  let concatArgs: string[] = [];
  let manifest = "";
  const durationCaps: number[] = [];
  const job = createLongVideoMediaJobDefinition(
    {
      familiarId: "long-order",
      generationId: "generation-long-order",
      chapters,
      renderConfig,
    },
    {
      renderVideoSequence: async (input) => {
        durationCaps.push(input.maxDurationMs);
        rendered.push({
          title: input.scenes[0].title,
          provider: input.provider,
          voice: input.voice,
          signal: input.signal,
        });
        await input.reportStage("synthesizing");
        await writeFile(input.outputPath, `chapter:${input.scenes[0].title}`);
        return {
          durationMs: rendered.length * 1_000,
          provider: input.provider,
          voice: input.voice,
        };
      },
      runFfmpeg: async (args, cwd) => {
        concatArgs = args;
        const manifestPath = args[args.indexOf("-i") + 1];
        manifest = await readFile(
          new URL(`file://${cwd}/${manifestPath}`),
          "utf8",
        );
        await writeFile(args.at(-1)!, "joined");
      },
      probeVideo: async () => validProbe(),
      publishMedia: async (input) => ({
        key: input.key,
        mimeType: input.mimeType,
        sizeBytes: 6,
        durationMs: input.durationMs,
      }),
      removeTemporary: async (target, options) => {
        await rm(target, options);
        throw new Error("simulated cleanup failure");
      },
    },
  );
  const controller = new AbortController();
  const result = await job.run(context(controller, reports));

  assert.deepEqual(
    rendered.map((entry) => entry.title),
    ["First finding", "Second finding"],
  );
  assert.ok(rendered.every((entry) => entry.provider === "local"));
  assert.ok(
    rendered.every((entry) => entry.voice === "piper-lessac-medium"),
  );
  assert.deepEqual(durationCaps, [300_000, 299_000]);
  assert.ok(
    rendered.every((entry) => entry.signal === rendered[0].signal),
    "every chapter shares one abort signal",
  );
  assert.deepEqual(
    reports
      .filter(([, progress]) => progress)
      .map(([, progress]) => progress),
    [
      { unit: "chapter", current: 1, total: 2, label: "First finding" },
      { unit: "chapter", current: 1, total: 2, label: "First finding" },
      { unit: "chapter", current: 2, total: 2, label: "Second finding" },
      { unit: "chapter", current: 2, total: 2, label: "Second finding" },
      { unit: "chapter", current: 2, total: 2, label: "Second finding" },
    ],
  );
  assert.ok(concatArgs.includes("concat"));
  assert.ok(concatArgs.includes("copy"));
  assert.ok(concatArgs.includes("+faststart"));
  assert.ok(
    manifest.indexOf("chapter-001.mp4") <
      manifest.indexOf("chapter-002.mp4"),
  );
  assert.equal(result.content.kind, "long-video");
  assert.deepEqual(result.content.chapters, chapters);
  assert.deepEqual(result.content.video, {
    key: "long-video.mp4",
    mimeType: "video/mp4",
    sizeBytes: 6,
    durationMs: 3_000,
    provider: "local",
    voice: "piper-lessac-medium",
  });
});

test("rejects the total scene budget before starting expensive chapter renders", async () => {
  let renderCalls = 0;
  const overBudget = [
    {
      id: "chapter-1",
      title: "Dense chapter",
      scenes: Array.from({ length: 21 }, (_, index) => ({
        id: `scene-${index + 1}`,
        title: `Finding ${index + 1}`,
        bullets: [],
        narration: `Finding ${index + 1}`,
      })),
    },
  ];
  const job = createLongVideoMediaJobDefinition(
    {
      familiarId: "long-scenes",
      generationId: "generation-long-scenes",
      chapters: overBudget,
      renderConfig,
    },
    {
      renderVideoSequence: async () => {
        renderCalls += 1;
        throw new Error("must not render");
      },
    },
  );

  await assert.rejects(
    () => job.run(context(new AbortController(), [])),
    /brief long-video scene budget \(20\) exceeded/,
  );
  assert.equal(renderCalls, 0);
});

test("a chapter failure names the chapter and never publishes or starts later work", async () => {
  const started: string[] = [];
  let published = false;
  const job = createLongVideoMediaJobDefinition(
    {
      familiarId: "long-failure",
      generationId: "generation-long-failure",
      chapters: [
        ...chapters,
        { ...chapters[1], id: "chapter-3", title: "Never starts" },
      ],
      renderConfig,
    },
    {
      renderVideoSequence: async (input) => {
        started.push(input.scenes[0].title);
        if (started.length === 2) throw new Error("encoder exploded");
        await writeFile(input.outputPath, "chapter");
        return {
          durationMs: 1_000,
          provider: input.provider,
          voice: input.voice,
        };
      },
      publishMedia: async () => {
        published = true;
        throw new Error("must not publish");
      },
    },
  );

  await assert.rejects(
    () => job.run(context(new AbortController(), [])),
    /chapter 2 \(Second finding\) failed: encoder exploded/,
  );
  assert.deepEqual(started, ["First finding", "Second finding"]);
  assert.equal(published, false);
});

test("kill aborts the active chapter, skips remaining chapters, and removes partial media", async () => {
  const started: string[] = [];
  let concatCalled = false;
  let publishCalled = false;
  let removed = 0;
  let markStarted!: () => void;
  const chapterStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const job = createLongVideoMediaJobDefinition(
    {
      familiarId: "long-cancel",
      generationId: "generation-long-cancel",
      chapters,
      renderConfig,
    },
    {
      renderVideoSequence: async (input) => {
        started.push(input.scenes[0].title);
        markStarted();
        await new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
        throw new Error("unreachable");
      },
      runFfmpeg: async () => {
        concatCalled = true;
      },
      publishMedia: async () => {
        publishCalled = true;
        throw new Error("must not publish");
      },
      removeMedia: async () => {
        removed += 1;
      },
    },
  );
  const controller = new AbortController();
  const running = job.run(context(controller, []));
  await chapterStarted;
  job.kill?.();

  await assert.rejects(() => running, /long-video render cancelled/);
  assert.deepEqual(started, ["First finding"]);
  assert.equal(concatCalled, false);
  assert.equal(publishCalled, false);
  assert.equal(removed, 1);
});

test("final ffprobe enforces the selected duration cap before publication", async () => {
  let published = false;
  const job = createLongVideoMediaJobDefinition(
    {
      familiarId: "long-cap",
      generationId: "generation-long-cap",
      chapters,
      renderConfig,
    },
    {
      renderVideoSequence: async (input) => {
        await writeFile(input.outputPath, "chapter");
        return {
          durationMs: 1_000,
          provider: input.provider,
          voice: input.voice,
        };
      },
      runFfmpeg: async (args) => {
        await writeFile(args.at(-1)!, "joined");
      },
      probeVideo: async () => validProbe("301"),
      publishMedia: async () => {
        published = true;
        throw new Error("must not publish");
      },
    },
  );

  await assert.rejects(
    () => job.run(context(new AbortController(), [])),
    /duration cap/,
  );
  assert.equal(published, false);
});
