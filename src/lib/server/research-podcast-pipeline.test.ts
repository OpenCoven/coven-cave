import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  RESEARCH_MEDIA_LENGTH_LIMITS,
  type ResearchMediaRenderConfig,
} from "../research-generations.ts";
import type { ResearchMediaJobContext } from "./research-media-job-contract.ts";

const mediaRoot = await mkdtemp(path.join(tmpdir(), "cave-podcast-pipeline-"));
const previousMediaRoot = process.env.COVEN_RESEARCH_MEDIA_DIR;
process.env.COVEN_RESEARCH_MEDIA_DIR = mediaRoot;

const {
  concatPcmWav,
  createPodcastMediaJobDefinition,
  readBoundedElevenLabsAudio,
  trimPcmWavSilence,
} = await import("./research-podcast-pipeline.ts");
const {
  openResearchGenerationMedia,
  readResearchGenerationMediaBytes,
  RESEARCH_AUDIO_MAX_BYTES,
} = await import("./research-media-store.ts");

after(async () => {
  if (previousMediaRoot === undefined) delete process.env.COVEN_RESEARCH_MEDIA_DIR;
  else process.env.COVEN_RESEARCH_MEDIA_DIR = previousMediaRoot;
  await rm(mediaRoot, { recursive: true, force: true });
});

function wav(samples: number[]): Uint8Array {
  const bytes = wavWithDataBytes(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return bytes;
}

function wavWithDataBytes(dataBytes: number): Uint8Array {
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) => {
      bytes[offset + index] = char.charCodeAt(0);
    });
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function renderConfig(
  overrides: Partial<ResearchMediaRenderConfig> = {},
): ResearchMediaRenderConfig {
  return {
    provider: "local",
    voice: "piper-amy",
    length: "standard",
    ...overrides,
  };
}

function jobContext(
  controller = new AbortController(),
  stages: string[] = [],
): ResearchMediaJobContext {
  return {
    reportStage: async (stage) => {
      stages.push(stage);
    },
    signal: controller.signal,
    isCancellationRequested: () => controller.signal.aborted,
  };
}

test("PCM WAV concatenation preserves one valid header and all samples", () => {
  const result = concatPcmWav([wav([1, 2]), wav([3, 4])]);
  assert.equal(new TextDecoder().decode(result.slice(0, 4)), "RIFF");
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => view.getInt16(44 + index * 2, true)),
    [1, 2, 3, 4],
  );
});

test("segment silence trimming caps dead air while preserving every audible sample", () => {
  // 5s of silence on each side of 100 loud frames at the 8kHz test rate.
  const silence = (seconds: number) => new Array<number>(seconds * 8_000).fill(0);
  const speech = new Array<number>(100).fill(1_000);
  const trimmed = trimPcmWavSilence(wav([...silence(5), ...speech, ...silence(5)]));
  const view = new DataView(trimmed.buffer, trimmed.byteOffset, trimmed.byteLength);
  // Kept: 250ms lead (2000 frames) + speech (100) + 450ms tail (3600 frames).
  assert.equal(view.getUint32(40, true), (2_000 + 100 + 3_600) * 2, "silence capped on both sides");
  assert.equal(view.getInt16(44 + 2_000 * 2, true), 1_000, "first audible sample survives");
  assert.equal(view.getInt16(44 + (2_000 + 99) * 2, true), 1_000, "last audible sample survives");
});

test("segment silence trimming leaves natural pauses and silent segments alone", () => {
  const shortPause = new Array<number>(800).fill(0); // 100ms at 8kHz
  const speech = new Array<number>(50).fill(2_000);
  const natural = wav([...shortPause, ...speech, ...shortPause]);
  assert.equal(trimPcmWavSilence(natural), natural, "sub-cap silence is untouched");
  const silent = wav(new Array<number>(1_600).fill(0));
  assert.equal(trimPcmWavSilence(silent), silent, "an all-silent segment passes through unmasked");
});

test("segment silence trimming passes a partial-frame data chunk through untouched", () => {
  // 5s silence + speech + 5s silence would normally trim, but a data chunk
  // that is not a whole number of frames is malformed — flooring would drop
  // the trailing partial-frame bytes, so the segment must pass through.
  const samples = [...new Array<number>(40_000).fill(0), ...new Array<number>(100).fill(1_000), ...new Array<number>(40_000).fill(0)];
  const malformed = new Uint8Array(wav(samples).length + 1);
  malformed.set(wav(samples));
  malformed[malformed.length - 1] = 0x7f; // stray trailing byte: dataLength % blockAlign !== 0
  const view = new DataView(malformed.buffer, malformed.byteOffset, malformed.byteLength);
  view.setUint32(4, malformed.length - 8, true);
  view.setUint32(40, samples.length * 2 + 1, true);
  assert.equal(trimPcmWavSilence(malformed), malformed, "partial-frame segment is returned unchanged");
});

test("podcast uses the exact frozen provider and voice and stores measured metadata", async () => {
  const cases: ResearchMediaRenderConfig[] = [
    renderConfig(),
    renderConfig({
      provider: "elevenlabs",
      voice: "21m00Tcm4TlvDq8ikWAM",
    }),
  ];
  for (const [caseIndex, config] of cases.entries()) {
    const calls: Array<{
      text: string;
      provider: string;
      voice: string;
      signal: AbortSignal;
    }> = [];
    const stages: string[] = [];
    const definition = createPodcastMediaJobDefinition(
      {
        familiarId: "nova",
        generationId: `podcast-provider-${caseIndex}`,
        script: [
          { id: "segment-1", text: "Opening" },
          { id: "segment-2", text: "Findings" },
        ],
        renderConfig: config,
      },
      {
        synthesize: async (text, provider, voice, signal) => {
          calls.push({ text, provider, voice, signal });
          return {
            bytes: wav(text === "Opening" ? [1, 2] : [3, 4]),
            voice,
          };
        },
      },
    );
    const controller = new AbortController();
    const result = await definition.run(jobContext(controller, stages));
    assert.deepEqual(
      calls.map(({ text, provider, voice }) => ({ text, provider, voice })),
      [
        { text: "Opening", provider: config.provider, voice: config.voice },
        { text: "Findings", provider: config.provider, voice: config.voice },
      ],
    );
    assert.ok(calls.every((call) => call.signal === controller.signal));
    assert.deepEqual(stages, [
      "scripting",
      "synthesizing",
      "synthesizing",
      "encoding",
    ]);
    assert.equal(result.content.kind, "podcast");
    if (result.content.kind !== "podcast") continue;
    assert.equal(result.content.audio?.provider, config.provider);
    assert.equal(result.content.audio?.voice, config.voice);
    assert.equal(result.content.audio?.durationMs, 1);
  }
});

test("dialogue segments synthesize with their speaker's frozen voice", async () => {
  const config = renderConfig({
    voices: { host: "piper-amy", guest: "piper-lessac-medium" },
  });
  const calls: Array<{ text: string; voice: string }> = [];
  const definition = createPodcastMediaJobDefinition(
    {
      familiarId: "nova",
      generationId: "podcast-dialogue-voices",
      script: [
        { id: "segment-1", text: "Welcome in.", speaker: "host" },
        { id: "segment-2", text: "A verbatim finding.", speaker: "guest" },
        { id: "segment-3", text: "Legacy narration." },
      ],
      renderConfig: config,
    },
    {
      synthesize: async (text, _provider, voice) => {
        calls.push({ text, voice });
        return { bytes: wav([1]), voice };
      },
    },
  );
  const result = await definition.run(jobContext());
  assert.deepEqual(calls, [
    { text: "Welcome in.", voice: "piper-amy" },
    { text: "A verbatim finding.", voice: "piper-lessac-medium" },
    // Speaker-less segments keep the primary voice — old drafts render unchanged.
    { text: "Legacy narration.", voice: "piper-amy" },
  ]);
  assert.equal(result.content.kind, "podcast");
});

test("a segment failure is honest and names the failing index", async () => {
  const definition = createPodcastMediaJobDefinition(
    {
      familiarId: "nova",
      generationId: "podcast-failure",
      script: [
        { id: "segment-1", text: "first" },
        { id: "segment-2", text: "second" },
      ],
      renderConfig: renderConfig(),
    },
    {
      synthesize: async (text, _provider, voice) => {
        if (text === "second") throw new Error("engine offline");
        return { bytes: wav([1]), voice };
      },
    },
  );
  await assert.rejects(
    () => definition.run(jobContext()),
    /podcast segment 2 failed: engine offline/,
  );
});

test("cancellation aborts in-flight synthesis and removes partial media", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const synthesisStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const definition = createPodcastMediaJobDefinition(
    {
      familiarId: "nova",
      generationId: "podcast-cancel",
      script: [{ id: "segment-1", text: "first" }],
      renderConfig: renderConfig(),
    },
    {
      synthesize: async (_text, _provider, voice, signal) => {
        started();
        return new Promise((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("synthesis aborted")),
            { once: true },
          );
          if (signal.aborted) reject(new Error("synthesis aborted"));
          void resolve;
          void voice;
        });
      },
    },
  );
  const running = definition.run(jobContext(controller));
  await synthesisStarted;
  controller.abort();
  await assert.rejects(() => running, /podcast render cancelled/);
  await assert.rejects(
    () => openResearchGenerationMedia(
      "nova",
      "podcast-cancel",
      "podcast.wav",
    ),
    /media file not found/,
  );
});

test("output above the audio cap fails without publishing a media ref", async () => {
  const definition = createPodcastMediaJobDefinition(
    {
      familiarId: "nova",
      generationId: "podcast-too-large",
      script: [{ id: "segment-1", text: "oversized" }],
      renderConfig: renderConfig(),
    },
    {
      synthesize: async (_text, _provider, voice) => ({
        bytes: wavWithDataBytes(RESEARCH_AUDIO_MAX_BYTES),
        voice,
      }),
    },
  );
  await assert.rejects(() => definition.run(jobContext()), /size limit/);
  await assert.rejects(
    () => openResearchGenerationMedia(
      "nova",
      "podcast-too-large",
      "podcast.wav",
    ),
    /media file not found/,
  );
});

test("every preset budget is enforced before synthesis", async () => {
  const lengths = ["brief", "standard", "extended"] as const;
  for (const length of lengths) {
    let synthesisCalls = 0;
    const maxCharacters =
      RESEARCH_MEDIA_LENGTH_LIMITS.podcast[length].maxCharacters;
    const definition = createPodcastMediaJobDefinition(
      {
        familiarId: "nova",
        generationId: `podcast-budget-${length}`,
        script: [
          {
            id: "segment-1",
            text: "x".repeat(maxCharacters + 1),
          },
        ],
        renderConfig: renderConfig({ length }),
      },
      {
        synthesize: async (_text, _provider, voice) => {
          synthesisCalls += 1;
          return { bytes: wav([1]), voice };
        },
      },
    );
    await assert.rejects(
      () => definition.run(jobContext()),
      new RegExp(`${length} podcast character budget`),
    );
    assert.equal(synthesisCalls, 0);
  }
});

test("each segment is bounded for one TTS request before synthesis", async () => {
  let synthesisCalls = 0;
  const definition = createPodcastMediaJobDefinition(
    {
      familiarId: "nova",
      generationId: "podcast-request-bound",
      script: [{ id: "segment-1", text: "x".repeat(4_001) }],
      renderConfig: renderConfig({ length: "standard" }),
    },
    {
      synthesize: async (_text, _provider, voice) => {
        synthesisCalls += 1;
        return { bytes: wav([1]), voice };
      },
    },
  );
  await assert.rejects(
    () => definition.run(jobContext()),
    /segment 1 must be between 1 and 4000 characters/,
  );
  assert.equal(synthesisCalls, 0);
});

test("ElevenLabs response streaming stops at the audio byte cap", async () => {
  const declaredTooLarge = new Response(new Uint8Array([1]), {
    headers: { "content-length": "5" },
  });
  await assert.rejects(
    () => readBoundedElevenLabsAudio(declaredTooLarge, 4),
    /size limit/,
  );

  const streamedTooLarge = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    }),
  );
  await assert.rejects(
    () => readBoundedElevenLabsAudio(streamedTooLarge, 4),
    /size limit/,
  );
});

test("stored bytes equal the single assembled WAV", async () => {
  const chunks = [wav([1, 2]), wav([3, 4])];
  let index = 0;
  const definition = createPodcastMediaJobDefinition(
    {
      familiarId: "nova",
      generationId: "podcast-bytes",
      script: [
        { id: "segment-1", text: "Opening" },
        { id: "segment-2", text: "Findings" },
      ],
      renderConfig: renderConfig(),
    },
    {
      synthesize: async (_text, _provider, voice) => ({
        bytes: chunks[index++],
        voice,
      }),
    },
  );
  await definition.run(jobContext());
  assert.deepEqual(
    await readResearchGenerationMediaBytes(
      "nova",
      "podcast-bytes",
      "podcast.wav",
    ),
    concatPcmWav(chunks),
  );
});
