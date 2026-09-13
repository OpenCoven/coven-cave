import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_ELEVENLABS_VOICE_ID, elevenLabsDeliveryPreset } from "../voice/elevenlabs-shared.ts";
import { validateResearchMediaRenderConfig } from "../research-generations.ts";

const {
  getResearchMediaReadiness,
  validateResearchMediaSelection,
} = await import("./research-media-readiness.ts");

const readyLocalVoice = {
  ready: true,
  verified: true,
  id: "piper-lessac-medium",
  name: "Piper Lessac",
  engine: "piper" as const,
};

test("readiness describes every provider and a complete ffmpeg toolchain", async () => {
  const result = await getResearchMediaReadiness({
    speechReadiness: async () => ({ tts: [readyLocalVoice] }),
    probeLocalRuntime: async () => ({ available: true }),
    elevenLabsKey: () => "configured",
    probeCommand: async () => ({ ready: true }),
  });
  assert.deepEqual(result, {
    providers: {
      local: {
        ready: true,
        voices: [
          {
            id: "piper-lessac-medium",
            name: "Piper Lessac",
            engine: "piper",
          },
        ],
      },
      elevenlabs: {
        ready: true,
        defaultVoiceId: DEFAULT_ELEVENLABS_VOICE_ID,
      },
    },
    ffmpeg: { ready: true },
    podcast: { ready: true },
    shortVideo: { ready: true },
    longVideo: { ready: true },
  });
  assert.equal("via" in result.podcast, false);
});

test("readiness returns actionable provider, ffmpeg, and ffprobe hints", async () => {
  const unavailable = await getResearchMediaReadiness({
    speechReadiness: async () => ({ tts: [] }),
    probeLocalRuntime: async () => ({ available: true }),
    elevenLabsKey: () => undefined,
    probeCommand: async (command) => ({
      ready: command === "ffprobe",
    }),
  });
  assert.equal(unavailable.providers.local.ready, false);
  assert.match(unavailable.providers.local.hint ?? "", /Download a local voice/);
  assert.equal(unavailable.providers.elevenlabs.ready, false);
  assert.match(unavailable.providers.elevenlabs.hint ?? "", /ELEVENLABS_API_KEY/);
  assert.equal(unavailable.podcast.ready, false);
  assert.match(unavailable.podcast.hint ?? "", /voice|ELEVENLABS_API_KEY/i);
  assert.equal(unavailable.ffmpeg.ready, false);
  assert.match(unavailable.ffmpeg.hint ?? "", /Install ffmpeg/);

  const missingProbe = await getResearchMediaReadiness({
    speechReadiness: async () => ({ tts: [readyLocalVoice] }),
    probeLocalRuntime: async () => ({ available: true }),
    elevenLabsKey: () => undefined,
    probeCommand: async (command) => ({
      ready: command === "ffmpeg",
    }),
  });
  assert.equal(missingProbe.podcast.ready, true);
  assert.equal(missingProbe.ffmpeg.ready, false);
  assert.match(missingProbe.ffmpeg.hint ?? "", /Install ffprobe/);
  assert.equal(missingProbe.shortVideo.ready, false);
  assert.match(missingProbe.shortVideo.hint ?? "", /Install ffprobe/);
  assert.equal(missingProbe.longVideo.ready, false);
});

test("selection validation freezes exact voices and video prerequisites", async () => {
  const ready = await getResearchMediaReadiness({
    speechReadiness: async () => ({ tts: [readyLocalVoice] }),
    probeLocalRuntime: async () => ({ available: true }),
    elevenLabsKey: () => "configured",
    probeCommand: async () => ({ ready: true }),
  });
  assert.deepEqual(
    validateResearchMediaSelection(
      "podcast",
      {
        provider: "local",
        voice: "piper-lessac-medium",
        length: "standard",
      },
      ready,
    ),
    { ok: true },
  );
  const missingVoice = validateResearchMediaSelection(
    "podcast",
    {
      provider: "local",
      voice: "piper-not-installed",
      length: "brief",
    },
    ready,
  );
  assert.equal(missingVoice.ok, false);
  if (!missingVoice.ok) assert.match(missingVoice.error, /selected local voice/);

  assert.deepEqual(
    validateResearchMediaSelection(
      "podcast",
      {
        provider: "elevenlabs",
        voice: DEFAULT_ELEVENLABS_VOICE_ID,
        length: "extended",
      },
      ready,
    ),
    { ok: true },
  );
  const invalidElevenLabs = validateResearchMediaSelection(
    "podcast",
    {
      provider: "elevenlabs",
      voice: "bad id",
      length: "brief",
    },
    ready,
  );
  assert.equal(invalidElevenLabs.ok, false);
  if (!invalidElevenLabs.ok) assert.match(invalidElevenLabs.error, /voice id/i);

  assert.deepEqual(
    validateResearchMediaSelection(
      "podcast",
      {
        provider: "local",
        voice: "piper-lessac-medium",
        length: "standard",
        voices: {
          host: "piper-lessac-medium",
          guest: "piper-lessac-medium",
        },
      },
      ready,
    ),
    { ok: true },
  );
  const missingGuest = validateResearchMediaSelection(
    "podcast",
    {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
      voices: { host: "piper-lessac-medium", guest: "piper-not-installed" },
    },
    ready,
  );
  assert.equal(missingGuest.ok, false);
  if (!missingGuest.ok) assert.match(missingGuest.error, /host and guest/i);
  const invalidGuestId = validateResearchMediaSelection(
    "podcast",
    {
      provider: "elevenlabs",
      voice: DEFAULT_ELEVENLABS_VOICE_ID,
      length: "brief",
      voices: { host: DEFAULT_ELEVENLABS_VOICE_ID, guest: "bad id" },
    },
    ready,
  );
  assert.equal(invalidGuestId.ok, false);
  if (!invalidGuestId.ok) assert.match(invalidGuestId.error, /host and guest/i);

  const noFfprobe = await getResearchMediaReadiness({
    speechReadiness: async () => ({ tts: [readyLocalVoice] }),
    probeLocalRuntime: async () => ({ available: true }),
    elevenLabsKey: () => undefined,
    probeCommand: async (command) => ({ ready: command === "ffmpeg" }),
  });
  const video = validateResearchMediaSelection(
    "short-video",
    {
      provider: "local",
      voice: "piper-lessac-medium",
      length: "standard",
    },
    noFfprobe,
  );
  assert.equal(video.ok, false);
  if (!video.ok) assert.match(video.error, /ffprobe/);
});

test("installed voice files do not make an unavailable runtime ready", async () => {
  const result = await getResearchMediaReadiness({
    speechReadiness: async () => ({ tts: [readyLocalVoice] }),
    elevenLabsKey: () => undefined,
    probeCommand: async () => ({ ready: true }),
    probeLocalRuntime: async () => ({
      available: false,
      hint: "Install the local Piper runtime before selecting a Piper voice.",
    }),
  });
  assert.equal(result.providers.local.ready, false);
  assert.deepEqual(result.providers.local.voices, []);
  assert.match(result.providers.local.hint ?? "", /Install the local Piper runtime/);
  assert.equal(result.podcast.ready, false);
  assert.match(result.podcast.hint ?? "", /Install the local Piper runtime/);
});

test("research voice choices include named Kokoro speakers from a verified runnable bundle", async () => {
  const inspected: string[] = [];
  const result = await getResearchMediaReadiness({
    speechReadiness: async () => ({
      tts: [
        readyLocalVoice,
        { ...readyLocalVoice, id: "unverified", verified: false },
        {
          id: "kokoro-v0-19",
          name: "Kokoro",
          engine: "kokoro",
          ready: true,
          verified: true,
          kokoroSpeakerId: 0,
        },
      ],
    }),
    elevenLabsKey: () => undefined,
    probeCommand: async () => ({ ready: true }),
    probeLocalRuntime: async (engine) => {
      inspected.push(engine);
      return { available: engine === "kokoro" };
    },
  });
  assert.deepEqual(inspected.sort(), ["kokoro", "piper"]);
  assert.equal(result.providers.local.ready, true);
  const voices = result.providers.local.voices;
  assert.equal(voices.length, 11);
  assert.ok(voices.some((voice) => voice.id === "kokoro-v0-19-bella"));
  assert.ok(voices.some((voice) => voice.id === "kokoro-v0-19-george"));
  assert.ok(voices.every((voice) => voice.engine === "kokoro"));
});

test("incompatible stored v3 settings remain readable but fail before rendering", async () => {
  const config = {
    provider: "elevenlabs" as const,
    voice: DEFAULT_ELEVENLABS_VOICE_ID,
    length: "brief" as const,
    model: "eleven_v3",
    voiceSettings: elevenLabsDeliveryPreset("conversational")!.settings,
  };
  assert.equal(validateResearchMediaRenderConfig("podcast", config).ok, true);
  const readiness = await getResearchMediaReadiness({
    speechReadiness: async () => ({ tts: [] }),
    elevenLabsKey: () => "configured",
    probeCommand: async () => ({ ready: true }),
  });
  const result = validateResearchMediaSelection("podcast", config, readiness);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /v3.*Neutral|v3.*stability/i);
  assert.deepEqual(
    validateResearchMediaSelection("podcast", { ...config, voiceSettings: undefined }, readiness),
    { ok: true },
  );
});
