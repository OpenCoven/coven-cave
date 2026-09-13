import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";

import {
  RESEARCH_MEDIA_LENGTH_LIMITS,
  type ResearchMediaRenderConfig,
} from "../research-generations.ts";
import type { ResearchMediaJobContext } from "./research-media-job-contract.ts";
import { KOKORO_NAMED_SPEAKERS, resolveLocalTtsVoice } from "../voice/speech-models.ts";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_PODCAST_MODEL_ID,
  ELEVENLABS_MAX_SEED,
  modelSupportsRequestStitching,
  DEFAULT_ELEVENLABS_VOICE_SETTINGS,
  validateElevenLabsModelSettings,
} from "../voice/elevenlabs-shared.ts";

const mediaRoot = await mkdtemp(path.resolve(".podcast-pipeline-test-"));
const previousMediaRoot = process.env.COVEN_RESEARCH_MEDIA_DIR;
process.env.COVEN_RESEARCH_MEDIA_DIR = mediaRoot;

const {
  buildElevenLabsTtsBody,
  concatPcmWav,
  createPodcastMediaJobDefinition,
  readBoundedElevenLabsAudio,
  readElevenLabsErrorDetail,
  trimPcmWavSilence,
  preparePodcastPcmWav,
  pcmWavDurationMs,
  synthesizeResearchPodcastSegment,
  synthesizeResearchPodcastPreview,
  PODCAST_PREVIEW_TEXT,
  synthesizeLocal,
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

function audibleWav(amplitude = 4_000, sampleRate = 8_000): Uint8Array {
  const bytes = wav(Array.from({ length: sampleRate / 2 }, (_, index) =>
    Math.round(amplitude * Math.sin(2 * Math.PI * 200 * index / sampleRate))));
  const view = new DataView(bytes.buffer);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  return bytes;
}

test("hosted preview and render reject encoded responses before PCM wrapping or publication", async () => {
  const previousApiKey = process.env.ELEVENLABS_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
  const raw = audibleWav(8_000, 24_000).slice(44);
  const config = renderConfig({ provider: "elevenlabs", voice: "21m00Tcm4TlvDq8ikWAM" });
  const signed = (signature: string, offset = 0) => {
    const bytes = raw.slice();
    bytes.set(new TextEncoder().encode(signature), offset);
    return bytes;
  };
  // 86 complete 64 kbps MPEG-2 Layer III frames at 24 kHz, no ID3 tag.
  const mp3 = raw.slice(0, 16_512);
  for (let offset = 0; offset < mp3.length; offset += 192) mp3.set([0xff, 0xf3, 0x84, 0xc4], offset);
  const aac = raw.slice();
  for (const offset of [0, 1_000]) aac.set([0xff, 0xf1, 0x58, 0x80, 0x7d, 0x1f, 0xfc], offset);
  const webm = raw.slice();
  webm.set([0x1a, 0x45, 0xdf, 0xa3]);
  const cases = [
    ...["audio/mpeg", "audio/aac", "audio/ogg", "audio/flac", "audio/wav", "audio/L16", "audio/webm", "application/json"]
      .map((contentType) => ({ contentType, bytes: raw })),
    { contentType: "audio/mpeg", bytes: mp3 },
    ...["ID3", "OggS", "fLaC", "RIFF", "RF64", "FORM", "caff", ".snd"]
      .map((signature) => ({ contentType: "application/octet-stream", bytes: signed(signature) })),
    { contentType: "application/octet-stream", bytes: signed("ftyp", 4) },
    { contentType: "application/octet-stream", bytes: webm },
    { contentType: "audio/pcm", bytes: mp3 },
    { contentType: "", bytes: aac },
  ];
  try {
    for (const [index, { bytes, contentType }] of cases.entries()) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response(bytes.slice(), { headers: contentType ? { "content-type": contentType } : {} });
      };
      const before = await readdir(mediaRoot, { recursive: true });
      await assert.rejects(
        synthesizeResearchPodcastPreview(config, new AbortController().signal),
        /incompatible content type|encoded audio instead of raw PCM/,
      );
      assert.deepEqual(await readdir(mediaRoot, { recursive: true }), before);
      const generationId = `encoded-provider-response-${index}`;
      const definition = createPodcastMediaJobDefinition({
        familiarId: "nova", generationId, renderConfig: config,
        script: [{ id: "1", text: "This should never publish encoded bytes as PCM." }],
      });
      await assert.rejects(definition.run(jobContext()), /segment 1 failed:.*(?:incompatible content type|encoded audio)/);
      await assert.rejects(openResearchGenerationMedia("nova", generationId, "podcast.wav"), /not found/);
      assert.equal(calls, 2, "each invocation makes one request, without retries or provider fallback");
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousApiKey;
  }
});

test("legitimate PCM with isolated MPEG or ADTS sync bytes is not misclassified as encoded audio", async () => {
  const previousApiKey = process.env.ELEVENLABS_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
  const config = renderConfig({ provider: "elevenlabs", voice: "21m00Tcm4TlvDq8ikWAM" });
  try {
    for (const prefix of [
      [0xff, 0xfb],
      [0xff, 0xff],
      [0xff, 0xf3, 0x84, 0xc4],
      [0xff, 0xf1, 0x58, 0x80, 0x7d, 0x1f, 0xfc],
    ]) {
      const pcm = audibleWav(4_000, 24_000).slice(44);
      pcm.set(prefix);
      for (const contentType of ["audio/pcm; rate=24000", "audio/x-pcm", "application/octet-stream", ""]) {
        globalThis.fetch = async () => new Response(pcm.slice(), {
          headers: contentType ? { "content-type": contentType } : {},
        });
        const bytes = await synthesizeResearchPodcastPreview(config, new AbortController().signal);
        assert.equal(pcmWavDurationMs(bytes), 500);
      }
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousApiKey;
  }
});

test("local synthesis resolves every named Kokoro speaker under the shared base lease", async () => {
  const baseId = "kokoro-en-v0-19";
  const cases = [
    { voice: baseId, speakerId: 0 },
    ...KOKORO_NAMED_SPEAKERS.map((speaker) => ({
      voice: `${baseId}-${speaker.suffix}`, speakerId: speaker.speakerId,
    })),
  ];
  for (const { voice, speakerId } of cases) {
    let leased = false;
    const stages: string[] = [];
    const controller = new AbortController();
    const bytes = audibleWav(4_000, 24_000);
    const result = await synthesizeLocal("A local voice preview.", voice, controller.signal, {
      withModelUse: async (id, work) => {
        assert.equal(id, baseId);
        leased = true;
        stages.push("lease");
        try {
          return await work();
        } finally {
          leased = false;
          stages.push("release");
        }
      },
      readiness: async (model) => {
        assert.equal(leased, true, "integrity validation occurs under the removal lease");
        assert.equal(model.id, baseId);
        stages.push("verify");
        return {
          ...model, ready: true, verified: true, diskSizeBytes: model.sizeBytes,
          path: path.join(mediaRoot, "kokoro.onnx"),
          companionPaths: [path.join(mediaRoot, "voices.bin"), path.join(mediaRoot, "tokens.txt")],
        };
      },
      piper: async () => { assert.fail("Kokoro must not fall back to Piper"); },
      kokoro: async (assets, text, signal) => {
        assert.equal(leased, true, "lease remains held while the runner uses the shared assets");
        assert.equal(assets.speakerId, speakerId);
        assert.equal(assets.modelPath, path.join(mediaRoot, "kokoro.onnx"));
        assert.equal(assets.voicesPath, path.join(mediaRoot, "voices.bin"));
        assert.equal(assets.tokensPath, path.join(mediaRoot, "tokens.txt"));
        assert.equal(text, "A local voice preview.");
        assert.equal(signal, controller.signal);
        stages.push("speak");
        return bytes;
      },
    });
    assert.equal(result.voice, voice, "return the requested derived ID, not the base bundle ID");
    assert.equal(result.bytes, bytes);
    assert.deepEqual(stages, ["lease", "verify", "speak", "release"]);
  }
});

test("local synthesis rejects unknown or missing voices before leasing or choosing another voice", async () => {
  for (const voice of [undefined, "", "kokoro-en-v0-19-unknown", "../piper-amy", "missing-voice"]) {
    await assert.rejects(synthesizeLocal("Hello.", voice, new AbortController().signal, {
      withModelUse: async () => { assert.fail("invalid voice must not lease a fallback model"); },
    }), /registered/);
  }
});

test("local synthesis fails closed on unverified bundles, missing companions, and cancellation", async () => {
  const selected = resolveLocalTtsVoice("kokoro-en-v0-19-emma");
  assert.ok(selected);
  const ready = {
    ...selected.model, ready: true, verified: true, diskSizeBytes: selected.model.sizeBytes,
    path: path.join(mediaRoot, "kokoro.onnx"),
    companionPaths: [path.join(mediaRoot, "voices.bin"), path.join(mediaRoot, "tokens.txt")],
  };
  for (const overrides of [{ ready: false }, { verified: false }, { companionPaths: [] }, { id: "different-bundle" }]) {
    let leased = false;
    await assert.rejects(synthesizeLocal("Hello.", "kokoro-en-v0-19-emma", new AbortController().signal, {
      withModelUse: async (_id, work) => {
        leased = true;
        try { return await work(); } finally { leased = false; }
      },
      readiness: async () => {
        assert.equal(leased, true);
        return { ...ready, ...overrides };
      },
      kokoro: async () => { assert.fail("unusable bundles cannot reach a runtime"); },
    }), /verified|incomplete/);
    assert.equal(leased, false);
  }
  const controller = new AbortController();
  await assert.rejects(synthesizeLocal("Hello.", "kokoro-en-v0-19-emma", controller.signal, {
    readiness: async () => {
      controller.abort(new Error("cancelled during integrity verification"));
      return ready;
    },
    kokoro: async () => { assert.fail("cancelled synthesis cannot reach a runtime"); },
  }), /cancelled during integrity verification/);
});

test("Piper synthesis keeps its exact registered voice and never substitutes Kokoro", async () => {
  const bytes = audibleWav();
  const signal = new AbortController().signal;
  let calls = 0;
  const result = await synthesizeLocal("Hello Amy.", "piper-amy-medium-en-us", signal, {
    readiness: async (model) => ({
      ...model, ready: true, verified: true, diskSizeBytes: model.sizeBytes,
      path: path.join(mediaRoot, "amy.onnx"),
    }),
    piper: async (modelPath, text, requestSignal) => {
      calls += 1;
      assert.equal(modelPath, path.join(mediaRoot, "amy.onnx"));
      assert.equal(text, "Hello Amy.");
      assert.equal(requestSignal, signal);
      return bytes;
    },
    kokoro: async () => { assert.fail("Piper must not switch engines"); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { bytes, voice: "piper-amy-medium-en-us" });
});

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

test("segment silence trimming rejects malformed partial-frame data", () => {
  // Flooring a partial frame would conceal corruption.
  const samples = [...new Array<number>(40_000).fill(0), ...new Array<number>(100).fill(1_000), ...new Array<number>(40_000).fill(0)];
  const malformed = new Uint8Array(wav(samples).length + 1);
  malformed.set(wav(samples));
  malformed[malformed.length - 1] = 0x7f; // stray trailing byte: dataLength % blockAlign !== 0
  const view = new DataView(malformed.buffer, malformed.byteOffset, malformed.byteLength);
  view.setUint32(4, malformed.length - 8, true);
  view.setUint32(40, samples.length * 2 + 1, true);
  assert.throws(() => trimPcmWavSilence(malformed), /malformed WAV|invalid.*PCM WAV metadata/);
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
            bytes: audibleWav(),
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
    assert.ok(calls.every((call) => !call.signal.aborted));
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
    assert.equal(result.content.audio?.durationMs, 1_000);
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
        return { bytes: audibleWav(), voice };
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
        return { bytes: audibleWav(), voice };
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
          return { bytes: audibleWav(), voice };
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
        return { bytes: audibleWav(), voice };
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

test("ElevenLabs error detail reads only a bounded streamed prefix", async () => {
  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(" ".repeat(1_200)));
        controller.enqueue(encoder.encode("provider detail that must not be read"));
        controller.close();
      },
    }),
  );
  assert.equal(await readElevenLabsErrorDetail(response), "");
});

test("stored bytes equal the single assembled WAV", async () => {
  const chunks = [audibleWav(), audibleWav(6_000)];
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
    concatPcmWav(chunks.map((chunk) => preparePodcastPcmWav(chunk))),
  );
});

test("ElevenLabs TTS body carries delivery controls and optional segment context", () => {
  const full = buildElevenLabsTtsBody("Hello.", {
    modelId: "eleven_multilingual_v2",
    voiceSettings: {
      stability: 0.3,
      similarityBoost: 0.9,
      style: 0.1,
      useSpeakerBoost: false,
      speed: 1.1,
    },
    previousText: "Before.",
    nextText: "After.",
    seed: 4242,
  });
  assert.deepEqual(full, {
    text: "Hello.",
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.3,
      similarity_boost: 0.9,
      style: 0.1,
      use_speaker_boost: false,
      speed: 1.1,
    },
    previous_text: "Before.",
    next_text: "After.",
    seed: 4242,
  });

  // A bare call stays on the latency default and sends the baseline settings,
  // with no segment context keys.
  const minimal = buildElevenLabsTtsBody("Hello.");
  assert.equal(minimal.model_id, DEFAULT_ELEVENLABS_MODEL_ID);
  assert.deepEqual(minimal.voice_settings, {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0,
    use_speaker_boost: true,
    speed: 1,
  });
  assert.equal("previous_text" in minimal, false);
  assert.equal("next_text" in minimal, false);
  assert.equal("seed" in minimal, false);
});

test("v3 renders drop segment context the provider would reject outright", () => {
  // Regression: sending previous_text/next_text to the v3 family returns HTTP
  // 400 invalid_parameters, which failed every v3 podcast render.
  for (const modelId of ["eleven_v3", "eleven_v3_preview", "eleven_v3_alpha"]) {
    const body = buildElevenLabsTtsBody("Hello.", {
      modelId,
      previousText: "Before.",
      nextText: "After.",
      seed: 7,
    });
    assert.equal(body.model_id, modelId);
    assert.equal("previous_text" in body, false, `${modelId} must not stitch`);
    assert.equal("next_text" in body, false, `${modelId} must not stitch`);
    // V3 only receives controls it can implement.
    assert.equal(body.seed, 7);
    assert.deepEqual(body.voice_settings, { stability: 0.5 });
  }
  assert.equal(modelSupportsRequestStitching("eleven_v3"), false);
  assert.equal(modelSupportsRequestStitching("eleven_multilingual_v2"), true);
  assert.equal(modelSupportsRequestStitching(DEFAULT_ELEVENLABS_MODEL_ID), true);
  assert.equal(
    modelSupportsRequestStitching(DEFAULT_ELEVENLABS_PODCAST_MODEL_ID),
    true,
  );
});

test("an out-of-range seed is dropped rather than sent to the provider", () => {
  for (const seed of [-1, 1.5, 4_294_967_296, Number.NaN]) {
    const body = buildElevenLabsTtsBody("Hello.", { seed });
    assert.equal("seed" in body, false, `seed ${seed} must not be sent`);
  }
  assert.equal(buildElevenLabsTtsBody("Hello.", { seed: 0 }).seed, 0);
  assert.equal(
    buildElevenLabsTtsBody("Hello.", { seed: ELEVENLABS_MAX_SEED }).seed,
    ELEVENLABS_MAX_SEED,
  );
});

test("podcast segments synthesize with cross-segment context and the offline model default", async () => {
  type SeenOptions = {
    model: string;
    voiceSettings?: unknown;
    previousText?: string;
    nextText?: string;
  };
  const seen: Array<{ text: string; options: SeenOptions }> = [];
  const config = renderConfig({
    provider: "elevenlabs",
    voice: "21m00Tcm4TlvDq8ikWAM",
  });
  const definition = createPodcastMediaJobDefinition(
    {
      familiarId: "nova",
      generationId: "podcast-context",
      script: [
        { id: "segment-1", text: "Opening" },
        { id: "segment-2", text: "Findings", speaker: "guest" },
        { id: "segment-3", text: "Closing" },
      ],
      renderConfig: config,
    },
    {
      synthesize: async (text, _provider, voice, _signal, options) => {
        seen.push({ text, options: options as SeenOptions });
        return { bytes: audibleWav(), voice };
      },
    },
  );
  await definition.run(jobContext());
  assert.deepEqual(
    seen.map((call) => call.text),
    ["Opening", "Findings", "Closing"],
  );
  assert.equal(seen[0].options.previousText, undefined);
  assert.equal(seen[0].options.nextText, "Findings");
  assert.equal(seen[1].options.previousText, "Opening");
  assert.equal(seen[1].options.nextText, "Closing");
  assert.equal(seen[2].options.previousText, "Findings");
  assert.equal(seen[2].options.nextText, undefined);
  assert.ok(
    seen.every((call) => call.options.model === DEFAULT_ELEVENLABS_PODCAST_MODEL_ID),
    "the offline render defaults to the quality-tier model, not the live-voice turbo default",
  );
});

test("ElevenLabs podcast config reaches the outbound request and stored WAV", async () => {
  const previousApiKey = process.env.ELEVENLABS_API_KEY;
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit; body: unknown }> = [];
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
  globalThis.fetch = async (input, init = {}) => {
    requests.push({
      url: String(input),
      init,
      body: JSON.parse(String(init.body)),
    });
    return new Response(audibleWav(4_000, 24_000).slice(44), { status: 200 });
  };

  try {
    const definition = createPodcastMediaJobDefinition({
      familiarId: "nova",
      generationId: "podcast-elevenlabs-request",
      script: [
        { id: "segment-1", text: "Opening." },
        { id: "segment-2", text: "Findings.", speaker: "guest" },
        { id: "segment-3", text: "Closing." },
      ],
      renderConfig: renderConfig({
        provider: "elevenlabs",
        voice: "21m00Tcm4TlvDq8ikWAM",
        voices: {
          host: "21m00Tcm4TlvDq8ikWAM",
          guest: "AZnzlk1XvdvUeBnXmlld",
        },
        model: "eleven_multilingual_v2",
        seed: 20_260_817,
        voiceSettings: {
          stability: 0.3,
          similarityBoost: 0.9,
          style: 0.2,
          useSpeakerBoost: false,
          speed: 1.2,
        },
      }),
    });

    const result = await definition.run(jobContext());
    assert.deepEqual(
      requests.map(({ url }) => url),
      [
        "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=pcm_24000",
        "https://api.elevenlabs.io/v1/text-to-speech/AZnzlk1XvdvUeBnXmlld?output_format=pcm_24000",
        "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=pcm_24000",
      ],
    );
    assert.ok(
      requests.every(
        ({ init }) =>
          init.method === "POST" &&
          new Headers(init.headers).get("xi-api-key") === "test-elevenlabs-key",
      ),
    );
    assert.deepEqual(requests.map(({ body }) => body), [
      {
        text: "Opening.",
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.3,
          similarity_boost: 0.9,
          style: 0.2,
          use_speaker_boost: false,
          speed: 1.2,
        },
        next_text: "Findings.",
        seed: 20_260_817,
      },
      {
        text: "Findings.",
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.3,
          similarity_boost: 0.9,
          style: 0.2,
          use_speaker_boost: false,
          speed: 1.2,
        },
        previous_text: "Opening.",
        next_text: "Closing.",
        seed: 20_260_817,
      },
      {
        text: "Closing.",
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.3,
          similarity_boost: 0.9,
          style: 0.2,
          use_speaker_boost: false,
          speed: 1.2,
        },
        previous_text: "Findings.",
        seed: 20_260_817,
      },
    ]);
    assert.equal(result.content.kind, "podcast");
    if (result.content.kind === "podcast") {
      assert.equal(result.content.audio?.provider, "elevenlabs");
      assert.equal(result.content.audio?.voice, "21m00Tcm4TlvDq8ikWAM");
      assert.equal(result.content.audio?.durationMs, 1_500);
    }
    const stored = await readResearchGenerationMediaBytes(
      "nova",
      "podcast-elevenlabs-request",
      "podcast.wav",
    );
    assert.equal(new TextDecoder().decode(stored.slice(0, 4)), "RIFF");
    const header = new DataView(stored.buffer, stored.byteOffset, stored.byteLength);
    assert.equal(header.getUint32(40, true), 72_000);
    assert.equal(header.getUint32(24, true), 24_000);
    assert.equal(header.getUint32(28, true), 48_000);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousApiKey;
  }
});

test("an eleven_v3 podcast render completes instead of failing every segment", async () => {
  // Before the capability guard this render returned `http 400` on segment 1
  // for every user who selected the v3 model.
  const previousApiKey = process.env.ELEVENLABS_API_KEY;
  const previousFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
  globalThis.fetch = async (_input, init = {}) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    if ("previous_text" in body || "next_text" in body) {
      return new Response(
        JSON.stringify({
          detail: {
            status: "invalid_parameters",
            message:
              "Providing previous_text or next_text is not yet supported with the 'eleven_v3' model.",
          },
        }),
        { status: 400 },
      );
    }
    return new Response(audibleWav(4_000, 24_000).slice(44), { status: 200 });
  };

  try {
    const definition = createPodcastMediaJobDefinition({
      familiarId: "nova",
      generationId: "podcast-v3-render",
      script: [
        { id: "segment-1", text: "Opening." },
        { id: "segment-2", text: "Findings.", speaker: "guest" },
        { id: "segment-3", text: "Closing." },
      ],
      renderConfig: renderConfig({
        provider: "elevenlabs",
        voice: "21m00Tcm4TlvDq8ikWAM",
        model: "eleven_v3",
      }),
    });
    const result = await definition.run(jobContext());
    assert.equal(bodies.length, 3);
    assert.ok(
      bodies.every((body) => body.model_id === "eleven_v3"),
      "the selected v3 model is still what gets rendered",
    );
    assert.ok(
      bodies.every(
        (body) => !("previous_text" in body) && !("next_text" in body),
      ),
      "v3 segments must not carry the context keys the provider rejects",
    );
    assert.equal(result.content.kind, "podcast");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousApiKey;
  }
});

test("a rejected ElevenLabs render reports the provider's reason, not a bare status", async () => {
  const previousApiKey = process.env.ELEVENLABS_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        detail: { status: "invalid_uid", message: "A voice for the voice_id was not found." },
      }),
      { status: 400 },
    );

  try {
    const definition = createPodcastMediaJobDefinition({
      familiarId: "nova",
      generationId: "podcast-error-detail",
      script: [{ id: "segment-1", text: "Opening." }],
      renderConfig: renderConfig({
        provider: "elevenlabs",
        voice: "21m00Tcm4TlvDq8ikWAM",
      }),
    });

    await assert.rejects(
      definition.run(jobContext()),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /http 400/);
        assert.match(message, /invalid_uid/);
        assert.match(message, /voice_id/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousApiKey;
  }
});

test("quality gates reject corrupt metadata, empty, silent, clipped and unusable audio before publishing", async () => {
      const corrupt = (offset: number, value: number, width = 4) => {
        const bytes = audibleWav();
        const view = new DataView(bytes.buffer);
        if (width === 2) view.setUint16(offset, value, true);
        else view.setUint32(offset, value, true);
        return bytes;
      };
      const cases = [
        wav([]),
        wav(new Array<number>(4_000).fill(0)),
        wav([1, 2]),
        audibleWav(100),
        wav(new Array<number>(4_000).fill(2_000)),
        wav(Array.from({ length: 4_000 }, (_, index) => index % 2 ? 32_767 : -32_768)),
        corrupt(4, 100),
        corrupt(22, 0, 2),
        corrupt(24, 0),
        corrupt(28, 0),
        corrupt(28, 16_001),
        corrupt(32, 1, 2),
        corrupt(34, 32, 2),
        corrupt(40, 7_999),
      ];
      for (const [index, bytes] of cases.entries()) {
        assert.throws(() => preparePodcastPcmWav(bytes), /PCM|WAV|silent|clipped|duration|unusable/i);
        let calls = 0;
        const generationId = `podcast-quality-${index}`;
        const definition = createPodcastMediaJobDefinition({
          familiarId: "nova",
          generationId,
          script: [{ id: "1", text: "A finding." }],
          renderConfig: renderConfig(),
        }, {
          synthesize: async (_text, _provider, voice) => {
            calls += 1;
            return { bytes, voice };
          },
        });
        await assert.rejects(definition.run(jobContext()), /segment 1 failed/);
        assert.equal(calls, 1, "failed audio never triggers another paid request");
        await assert.rejects(openResearchGenerationMedia("nova", generationId, "podcast.wav"), /not found/);
      }
      assert.throws(() => pcmWavDurationMs(corrupt(28, 0)), /metadata/);
    });

    test("near-full-scale speech peaks are accepted while sustained full-scale clipping is rejected", () => {
      const speech = audibleWav(6_740, 24_000);
      const view = new DataView(speech.buffer);
      // Match the observed successful hosted sample's extrema without treating
      // proximity to full scale as proof of clipping.
      view.setInt16(44, -32_739, true);
      view.setInt16(46, 32_571, true);
      const sampleCount = (speech.byteLength - 44) / 2;
      let squareSum = 0;
      for (let index = 0; index < sampleCount; index += 1) {
        squareSum += view.getInt16(44 + index * 2, true) ** 2;
      }
      const rmsDbfs = 20 * Math.log10(Math.sqrt(squareSum / sampleCount) / 32_768);
      assert.ok(Math.abs(rmsDbfs - (-16.72)) < 0.05);
      const prepared = preparePodcastPcmWav(speech);
      assert.equal(pcmWavDurationMs(prepared), 500);
      const output = new DataView(prepared.buffer, prepared.byteOffset, prepared.byteLength);
      let peak = 0;
      for (let index = 0; index < sampleCount; index += 1) {
        peak = Math.max(peak, Math.abs(output.getInt16(44 + index * 2, true)));
      }
      assert.ok(peak <= 32_767 * 10 ** (-1 / 20) + 1);

      const clipped = speech.slice();
      const clippedView = new DataView(clipped.buffer);
      for (let index = 100; index < 500; index += 1) {
        clippedView.setInt16(44 + index * 2, index < 300 ? 32_767 : -32_768, true);
      }
      assert.throws(() => preparePodcastPcmWav(clipped), /clipped/);
    });

    test("turn alignment brings different speaker levels together with gain cap and peak headroom", () => {
      const samples = (bytes: Uint8Array) => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return Array.from({ length: view.getUint32(40, true) / 2 }, (_, index) => view.getInt16(44 + index * 2, true));
      };
      const rms = (values: number[]) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
      const quiet = samples(preparePodcastPcmWav(audibleWav(3_000)));
      const loud = samples(preparePodcastPcmWav(audibleWav(8_000)));
      assert.ok(Math.abs(20 * Math.log10(rms(quiet) / rms(loud))) < 0.3);
      const veryQuiet = samples(preparePodcastPcmWav(audibleWav(500)));
      assert.ok(Math.max(...veryQuiet.map(Math.abs)) <= 500 * 10 ** (6 / 20) + 1);
      const transient = audibleWav(2_000);
      new DataView(transient.buffer).setInt16(44 + 101 * 2, 32_000, true);
      const aligned = samples(preparePodcastPcmWav(transient));
      assert.ok(Math.max(...aligned.map(Math.abs)) <= 32_767 * 10 ** (-1 / 20) + 1);
      const before = samples(transient);
      const gain = aligned[101] / before[101];
      assert.ok(aligned.every((sample, index) => Math.abs(sample - before[index] * gain) <= 1.5), "one gain preserves within-turn dynamics");
    });

    test("model-specific settings fail without remapping custom delivery or making paid requests", async () => {
      assert.equal(validateElevenLabsModelSettings("eleven_v3"), null);
      for (const stability of [0, 0.5, 1]) {
        const settings = { ...DEFAULT_ELEVENLABS_VOICE_SETTINGS, stability, useSpeakerBoost: false };
        assert.equal(validateElevenLabsModelSettings("eleven_v3", settings), null);
        assert.deepEqual(buildElevenLabsTtsBody("Hello.", { modelId: "eleven_v3", voiceSettings: settings }).voice_settings, { stability });
      }
      for (const settings of [
        { ...DEFAULT_ELEVENLABS_VOICE_SETTINGS, stability: 0.35 },
        DEFAULT_ELEVENLABS_VOICE_SETTINGS,
        { ...DEFAULT_ELEVENLABS_VOICE_SETTINGS, useSpeakerBoost: false, speed: 1.1 },
      ]) {
        assert.throws(() => buildElevenLabsTtsBody("Hello.", { modelId: "eleven_v3", voiceSettings: settings }), /Eleven v3/);
        let calls = 0;
        const definition = createPodcastMediaJobDefinition({
          familiarId: "nova", generationId: "bad-model-settings",
          script: [{ id: "1", text: "Hello." }],
          renderConfig: renderConfig({ provider: "elevenlabs", model: "eleven_v3", voiceSettings: settings }),
        }, { synthesize: async (_text, _provider, voice) => { calls += 1; return { bytes: audibleWav(), voice }; } });
        await assert.rejects(definition.run(jobContext()), /Eleven v3/);
        assert.equal(calls, 0);
      }
      assert.match(validateElevenLabsModelSettings("eleven_multilingual_v2", { ...DEFAULT_ELEVENLABS_VOICE_SETTINGS, speed: 1.25 })!, /0.7 and 1.2/);
    });

    test("preview uses only fixed demo text and the same frozen podcast synthesis options", async () => {
          const mediaBefore = await readdir(mediaRoot, { recursive: true });
      const controller = new AbortController();
      const config = renderConfig({
        provider: "elevenlabs", voice: "AZnzlk1XvdvUeBnXmlld",
        model: "eleven_multilingual_v2", seed: 123,
        voiceSettings: { ...DEFAULT_ELEVENLABS_VOICE_SETTINGS, stability: 0.3 },
      });
      let calls = 0;
      const raw = audibleWav(4_000, 24_000);
      const bytes = await synthesizeResearchPodcastPreview(config, controller.signal, {
        synthesize: async (text, provider, voice, signal, options) => {
          calls += 1;
          assert.equal(text, PODCAST_PREVIEW_TEXT);
          assert.equal(provider, config.provider);
          assert.equal(voice, config.voice);
          assert.equal(signal, controller.signal);
          assert.deepEqual(options, {
            model: config.model, voiceSettings: config.voiceSettings, seed: 123,
            sampleRate: 24_000, maxAudioBytes: 1_440_000,
          });
          return { bytes: raw, voice };
        },
      });
      assert.equal(calls, 1);
      assert.deepEqual(bytes, preparePodcastPcmWav(raw));
      assert.deepEqual(await readdir(mediaRoot, { recursive: true }), mediaBefore, "preview creates no media files");
    });

    test("preview cancels an uncooperative provider promptly and refuses late success", async () => {
      const controller = new AbortController();
      let resolve!: (result: { bytes: Uint8Array; voice: string }) => void;
      const preview = synthesizeResearchPodcastPreview(renderConfig(), controller.signal, {
        synthesize: async () => new Promise((done) => { resolve = done; }),
      });
      controller.abort(new Error("cancelled"));
      await assert.rejects(preview, /cancelled/);
      resolve({ bytes: audibleWav(), voice: "piper-amy" });
    });

    test("aborting a stalled hosted audio body cancels its reader", async () => {
      let cancelled = false;
      const controller = new AbortController();
      const response = new Response(new ReadableStream<Uint8Array>({
        cancel() { cancelled = true; },
      }));
      const reading = readBoundedElevenLabsAudio(response, 10_000, controller.signal);
      controller.abort(new Error("cancelled"));
      await assert.rejects(reading, /cancelled/);
      assert.equal(cancelled, true);
    });

    test("cancellation during encoding stage cannot publish audio", async () => {
      const controller = new AbortController();
      const definition = createPodcastMediaJobDefinition({
        familiarId: "nova", generationId: "cancel-at-encoding",
        script: [{ id: "1", text: "Hello." }], renderConfig: renderConfig(),
      }, { synthesize: async (_text, _provider, voice) => ({ bytes: audibleWav(), voice }) });
      await assert.rejects(definition.run({
        ...jobContext(controller),
        reportStage: async (stage) => { if (stage === "encoding") controller.abort(); },
      }), /abort|cancel/i);
      await assert.rejects(openResearchGenerationMedia("nova", "cancel-at-encoding", "podcast.wav"), /not found/);
    });

    test("segment-count bound refuses fragmented scripts before paid synthesis", async () => {
      let calls = 0;
      const definition = createPodcastMediaJobDefinition({
        familiarId: "nova", generationId: "too-many-segments",
        script: Array.from({ length: 129 }, (_, index) => ({ id: String(index), text: "Hi." })),
        renderConfig: renderConfig(),
      }, { synthesize: async (_text, _provider, voice) => { calls += 1; return { bytes: audibleWav(), voice }; } });
      await assert.rejects(definition.run(jobContext()), /segment limit/);
      assert.equal(calls, 0);
    });

    test("shared video synthesis retains 16 kHz while podcast previews request 24 kHz with no fallback", async () => {
      const previousApiKey = process.env.ELEVENLABS_API_KEY;
      const previousFetch = globalThis.fetch;
      process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
      const requests: string[] = [];
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        const rate = String(url).endsWith("24000") ? 24_000 : 16_000;
        return new Response(audibleWav(4_000, rate).slice(44));
      };
      try {
        const config = renderConfig({ provider: "elevenlabs", voice: "21m00Tcm4TlvDq8ikWAM" });
        const shared = await synthesizeResearchPodcastSegment("Video.", config.provider, config.voice, new AbortController().signal);
        assert.equal(new DataView(shared.bytes.buffer).getUint32(24, true), 16_000);
        const preview = await synthesizeResearchPodcastPreview(config, new AbortController().signal);
        assert.equal(new DataView(preview.buffer).getUint32(24, true), 24_000);
        assert.ok(requests[0].endsWith("pcm_16000"));
        assert.ok(requests[1].endsWith("pcm_24000"));
        let failures = 0;
        globalThis.fetch = async () => { failures += 1; throw new Error("network unavailable"); };
        await assert.rejects(synthesizeResearchPodcastPreview(config, new AbortController().signal), /network unavailable/);
        assert.equal(failures, 1);
      } finally {
        globalThis.fetch = previousFetch;
        if (previousApiKey === undefined) delete process.env.ELEVENLABS_API_KEY;
        else process.env.ELEVENLABS_API_KEY = previousApiKey;
      }
    });
