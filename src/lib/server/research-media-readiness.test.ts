import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_ELEVENLABS_VOICE_ID } from "../voice/elevenlabs-shared.ts";

const {
  getResearchMediaReadiness,
  validateResearchMediaSelection,
} = await import("./research-media-readiness.ts");

const readyLocalVoice = {
  ready: true,
  id: "piper-lessac-medium",
  name: "Piper Lessac",
  engine: "piper" as const,
};

test("readiness describes every provider and a complete ffmpeg toolchain", async () => {
  const result = await getResearchMediaReadiness({
    speechReadiness: async () => ({ tts: [readyLocalVoice] }),
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

  const noFfprobe = await getResearchMediaReadiness({
    speechReadiness: async () => ({ tts: [readyLocalVoice] }),
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
