import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

import { parseResearchMediaRange } from "../src/lib/server/research-media-store.ts";
import {
  renderResearchVideoSequence,
  runResearchVideoCommand,
  validateResearchVideoProbe,
} from "../src/lib/server/research-video-renderer.ts";

console.log("TAP version 13");

function commandAvailable(command) {
  return spawnSync(command, ["-version"], {
    encoding: "utf8",
    stdio: "ignore",
  }).status === 0;
}

if (!commandAvailable("ffmpeg") || !commandAvailable("ffprobe")) {
  console.log(
    "ok 1 - production research media sequence # SKIP ffmpeg and ffprobe are required",
  );
  process.exit(0);
}

function pcmWav(durationMs, frequencyHz) {
  const sampleRate = 16_000;
  const sampleCount = Math.round((durationMs / 1_000) * sampleRate);
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => {
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
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate) * 4_000,
    );
    view.setInt16(44 + index * 2, sample, true);
  }
  return bytes;
}

async function readRange(handle, range) {
  const bytes = Buffer.alloc(range.end - range.start + 1);
  const { bytesRead } = await handle.read(
    bytes,
    0,
    bytes.length,
    range.start,
  );
  return bytes.subarray(0, bytesRead);
}

const temporary = await mkdtemp(
  path.join(tmpdir(), "cave-research-media-ffmpeg-"),
);
try {
  const outputPath = path.join(temporary, "short-video.mp4");
  const stills = await Promise.all([
    sharp({
      create: {
        width: 1_280,
        height: 720,
        channels: 4,
        background: { r: 35, g: 33, b: 40, alpha: 1 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="1280" height="720"><text x="96" y="360" fill="#9386d0" font-size="64">Finding one</text></svg>',
          ),
        },
      ])
      .png()
      .toBuffer(),
    sharp({
      create: {
        width: 1_280,
        height: 720,
        channels: 4,
        background: { r: 42, g: 38, b: 52, alpha: 1 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="1280" height="720"><text x="96" y="360" fill="#f5f3ff" font-size="64">Finding two</text></svg>',
          ),
        },
      ])
      .png()
      .toBuffer(),
  ]);
  const wavs = [pcmWav(750, 220), pcmWav(750, 330)];
  let stillIndex = 0;
  let audioIndex = 0;
  const controller = new AbortController();
  const rendered = await renderResearchVideoSequence(
    {
      scenes: [
        {
          id: "scene-1",
          title: "Finding one",
          bullets: ["First source-grounded claim"],
          narration: "First source-grounded claim.",
        },
        {
          id: "scene-2",
          title: "Finding two",
          bullets: ["Second source-grounded claim"],
          narration: "Second source-grounded claim.",
        },
      ],
      provider: "local",
      voice: "integration-voice",
      maxDurationMs: 60_000,
      outputPath,
      workDir: temporary,
      signal: controller.signal,
      reportStage: async () => {},
    },
    {
      synthesize: async (_text, provider, voice, signal) => {
        assert.equal(provider, "local");
        assert.equal(voice, "integration-voice");
        assert.equal(signal, controller.signal);
        return { bytes: wavs[audioIndex++], voice };
      },
      renderStill: async () => new Uint8Array(stills[stillIndex++]),
    },
  );

  const probeResult = await runResearchVideoCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      outputPath,
    ],
    { cwd: temporary, signal: controller.signal },
  );
  const probe = JSON.parse(probeResult.stdout);
  const durationMs = validateResearchVideoProbe(probe, 60_000);
  assert.equal(durationMs, rendered.durationMs);
  assert.ok(durationMs > 0 && durationMs <= 60_000);

  const handle = await open(outputPath, "r");
  try {
    const { size } = await handle.stat();
    const prefix = Buffer.alloc(Math.min(size, 1024 * 1024));
    const { bytesRead: prefixBytesRead } = await handle.read(
      prefix,
      0,
      prefix.length,
      0,
    );
    const boxes = prefix.subarray(0, prefixBytesRead).toString("latin1");
    const moovIndex = boxes.indexOf("moov");
    const mdatIndex = boxes.indexOf("mdat");
    assert.ok(moovIndex >= 0, "faststart output has an early moov box");
    assert.ok(mdatIndex >= 0, "output has an mdat box");
    assert.ok(moovIndex < mdatIndex, "faststart places moov before mdat");
    const earlyRange = parseResearchMediaRange("bytes=0-127", size);
    const lateRange = parseResearchMediaRange("bytes=-128", size);
    assert.ok(earlyRange);
    assert.ok(lateRange);
    const early = await readRange(handle, earlyRange);
    const late = await readRange(handle, lateRange);
    assert.match(early.toString("latin1"), /ftyp/);
    assert.equal(early.length, 128);
    assert.equal(late.length, 128);
    assert.notDeepEqual(early, late);
  } finally {
    await handle.close();
  }

  console.log(
    `ok 1 - production research media sequence renders seekable H.264/AAC MP4 (${durationMs}ms)`,
  );
} catch (error) {
  console.log("not ok 1 - production research media sequence");
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
