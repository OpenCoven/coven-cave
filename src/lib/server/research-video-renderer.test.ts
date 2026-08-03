import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import sharp from "sharp";

import type { ResearchGenerationStoryboardScene } from "../research-generations.ts";

const temporary = await mkdtemp(path.join(tmpdir(), "cave-video-renderer-"));

const {
  COVEN_VIDEO_RENDER_PALETTE,
  renderResearchVideoSequence,
  renderStoryboardStill,
  runResearchVideoCommand,
  storyboardSceneToSvg,
  validateResearchVideoProbe,
} = await import("./research-video-renderer.ts");

after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

const scene: ResearchGenerationStoryboardScene = {
  id: "scene-1",
  title: "Finding one",
  bullets: ["First extracted claim"],
  narration: "First narration",
};

function wav(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) => {
      bytes[offset + index] = char.charCodeAt(0);
    });
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return bytes;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("server SVG uses a concrete palette pinned to the Coven foundations", async () => {
  const svg = storyboardSceneToSvg(scene);
  assert.doesNotMatch(svg, /var\(/);
  // Sharp's librsvg silently renders oklch() fills as black (cave-6f88w), so
  // every palette color must be plain hex and no oklch may reach the SVG.
  assert.doesNotMatch(svg, /oklch\(/);
  for (const value of Object.values(COVEN_VIDEO_RENDER_PALETTE)) {
    assert.match(value, /^#[0-9a-f]{6}$/);
    assert.match(svg, new RegExp(escapeRegExp(value)));
  }

  // The hex values are the sRGB equivalents of these foundations.css
  // declarations; if the source tokens move, this pin flags the drift.
  const paletteSources: Record<string, string> = {
    "--background": "oklch(0.225 0.004 291)",
    "--accent-presence": COVEN_VIDEO_RENDER_PALETTE.accent,
    "--foreground": "oklch(0.985 0 0)",
    "--muted-foreground": "oklch(0.66 0.010 291)",
  };
  const foundations = await readFile(
    new URL("../../styles/globals/foundations.css", import.meta.url),
    "utf8",
  );
  for (const [token, value] of Object.entries(paletteSources)) {
    assert.match(
      foundations,
      new RegExp(`${escapeRegExp(token)}:\\s*${escapeRegExp(value)}`),
    );
  }
});

test("Sharp emits an opaque 1280x720 still with distinct background and accent", async () => {
  const png = await renderStoryboardStill(storyboardSceneToSvg(scene));
  const image = sharp(png);
  const metadata = await image.metadata();
  assert.equal(metadata.width, 1_280);
  assert.equal(metadata.height, 720);
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels;
    return [...data.subarray(offset, offset + info.channels)];
  };
  const background = pixel(10, 10);
  const accent = pixel(76, 100);
  assert.equal(background[3], 255);
  assert.equal(accent[3], 255);
  assert.notDeepEqual(background, accent);
});

test("sequence rendering passes frozen config, required codecs, and the shared signal", async () => {
  const workDir = path.join(temporary, "sequence");
  const outputPath = path.join(workDir, "output.mp4");
  const controller = new AbortController();
  const stages: string[] = [];
  const synthesisCalls: unknown[][] = [];
  let ffmpegCall:
    | { args: string[]; cwd: string; signal: AbortSignal }
    | undefined;
  const result = await renderResearchVideoSequence(
    {
      scenes: [scene],
      provider: "local",
      voice: "piper-lessac-medium",
      maxDurationMs: 30_000,
      outputPath,
      workDir,
      signal: controller.signal,
      reportStage: async (stage) => {
        stages.push(stage);
      },
    },
    {
      synthesize: async (...args) => {
        synthesisCalls.push(args);
        return { bytes: wav([1, 2]), voice: "piper-lessac-medium" };
      },
      renderStill: async () => new Uint8Array([80, 78, 71]),
      runFfmpeg: async (args, cwd, signal) => {
        ffmpegCall = { args, cwd, signal };
        await writeFile(outputPath, "fake-mp4");
      },
      probeVideo: async () => ({
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
        format: { duration: "0.001" },
      }),
    },
  );
  assert.deepEqual(stages, ["scripting", "synthesizing", "encoding"]);
  assert.deepEqual(
    synthesisCalls.map((call) => call.slice(0, 3)),
    [["First narration", "local", "piper-lessac-medium"]],
  );
  assert.equal(synthesisCalls[0][3], controller.signal);
  assert.equal(ffmpegCall?.cwd, workDir);
  assert.equal(ffmpegCall?.signal, controller.signal);
  assert.ok(ffmpegCall?.args.includes("libx264"));
  assert.ok(ffmpegCall?.args.includes("aac"));
  assert.ok(ffmpegCall?.args.includes("yuv420p"));
  assert.ok(ffmpegCall?.args.includes("+faststart"));
  assert.deepEqual(result, {
    durationMs: 1,
    provider: "local",
    voice: "piper-lessac-medium",
  });
});

test("abort sends SIGTERM, escalates to SIGKILL, and rejects as AbortError", async () => {
  class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    exitCode: number | null = null;
    signals: NodeJS.Signals[] = [];

    kill(signal: NodeJS.Signals) {
      this.signals.push(signal);
      if (signal === "SIGKILL") {
        this.exitCode = 1;
        setImmediate(() => this.emit("close", 1, signal));
      }
      return true;
    }
  }
  const child = new FakeChild();
  const controller = new AbortController();
  const running = runResearchVideoCommand("ffmpeg", ["-version"], {
    cwd: temporary,
    signal: controller.signal,
    killGraceMs: 5,
    spawnProcess: () => child,
  });
  controller.abort();
  await assert.rejects(
    () => running,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("an unresponsive ffprobe force-settles after TERM and KILL", async () => {
  class WedgedChild extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    exitCode: number | null = null;
    signals: NodeJS.Signals[] = [];

    kill(signal: NodeJS.Signals) {
      this.signals.push(signal);
      return true;
    }
  }
  const child = new WedgedChild();
  const controller = new AbortController();
  const running = runResearchVideoCommand("ffprobe", ["output.mp4"], {
    cwd: temporary,
    signal: controller.signal,
    killGraceMs: 2,
    forceSettleMs: 2,
    spawnProcess: () => child,
  });
  controller.abort();
  await assert.rejects(
    () => running,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("sequence duration is bounded after each synthesis, before later still work", async () => {
  let synthesisCalls = 0;
  let stillCalls = 0;
  await assert.rejects(
    () =>
      renderResearchVideoSequence(
        {
          scenes: [
            scene,
            { ...scene, id: "scene-2", narration: "Second narration" },
            { ...scene, id: "scene-3", narration: "Never synthesized" },
          ],
          provider: "local",
          voice: "piper-lessac-medium",
          maxDurationMs: 1_500,
          outputPath: path.join(temporary, "over-duration.mp4"),
          workDir: path.join(temporary, "over-duration"),
          signal: new AbortController().signal,
          reportStage: async () => {},
        },
        {
          synthesize: async () => {
            synthesisCalls += 1;
            return {
              bytes: wav(Array.from({ length: 8_000 }, () => 1)),
              voice: "piper-lessac-medium",
            };
          },
          renderStill: async () => {
            stillCalls += 1;
            return new Uint8Array([1]);
          },
        },
      ),
    /duration cap/,
  );
  assert.equal(synthesisCalls, 2);
  assert.equal(stillCalls, 1);
});

test("ffprobe validation enforces codecs, dimensions, and duration", () => {
  const valid = {
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
    format: { duration: "29.5" },
  };
  assert.equal(validateResearchVideoProbe(valid, 30_000), 29_500);
  assert.throws(
    () => validateResearchVideoProbe({
      ...valid,
      streams: [
        { codec_type: "video", codec_name: "vp9", width: 1280, height: 720 },
        valid.streams[1],
      ],
    }, 30_000),
    /H\.264/,
  );
  assert.throws(
    () => validateResearchVideoProbe({
      ...valid,
      streams: [valid.streams[0]],
    }, 30_000),
    /AAC/,
  );
  assert.throws(
    () => validateResearchVideoProbe({
      ...valid,
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          pix_fmt: "yuv420p",
        },
        valid.streams[1],
      ],
    }, 30_000),
    /1280×720/,
  );
  assert.throws(
    () =>
      validateResearchVideoProbe(
        {
          ...valid,
          streams: [{ ...valid.streams[0], pix_fmt: "yuv444p" }, valid.streams[1]],
        },
        30_000,
      ),
    /yuv420p/,
  );
  assert.throws(
    () => validateResearchVideoProbe({
      ...valid,
      format: { duration: "30.5" },
    }, 30_000),
    /duration cap/,
  );
});
