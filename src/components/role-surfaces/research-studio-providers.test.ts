import assert from "node:assert/strict";
import test from "node:test";

import { describeProviderChips, researchProviderChips } from "./research-studio-providers";
import type { ResearchGenerationReadiness } from "@/lib/research-generations";

function readiness(patch: Partial<ResearchGenerationReadiness> = {}): ResearchGenerationReadiness {
  return {
    providers: {
      local: { ready: true, voices: [{ id: "v1", name: "Joe", engine: "piper" }] },
      elevenlabs: { ready: false, defaultVoiceId: "", hint: "Sign in to ElevenLabs." },
    },
    ffmpeg: { ready: true },
    podcast: { ready: true },
    shortVideo: { ready: true },
    longVideo: { ready: true },
    ...patch,
  };
}

test("a missing snapshot renders the strip as unknown, not as ready", () => {
  // The dangerous failure is a blank or optimistic strip: "we don't know yet"
  // is information, and a vanished row is not.
  const chips = researchProviderChips(null);
  assert.equal(chips.length, 4);
  assert.ok(chips.every((chip) => chip.state === "unknown"));
  assert.ok(chips.every((chip) => chip.detail.length > 0));
});

test("each chip reports the endpoint's own state", () => {
  const chips = researchProviderChips(readiness());
  const byId = Object.fromEntries(chips.map((chip) => [chip.id, chip]));
  assert.equal(byId.local.state, "ready");
  assert.equal(byId.elevenlabs.state, "blocked");
  assert.equal(byId.ffmpeg.state, "ready");
  assert.equal(byId.podcast.state, "ready");
});

test("a blocked chip carries the endpoint's own hint, verbatim", () => {
  // The chip and the card it blocks must say the same string — two different
  // remediation texts for one cause is how a user ends up fixing the wrong thing.
  const chips = researchProviderChips(readiness({
    ffmpeg: { ready: false, hint: "ffprobe was not found on PATH." },
  }));
  const ffmpeg = chips.find((chip) => chip.id === "ffmpeg");
  assert.equal(ffmpeg?.state, "blocked");
  assert.equal(ffmpeg?.detail, "ffprobe was not found on PATH.");
});

test("a blocked provider with no hint still explains itself", () => {
  const chips = researchProviderChips(readiness({
    podcast: { ready: false },
    providers: {
      local: { ready: false, voices: [] },
      elevenlabs: { ready: false, defaultVoiceId: "" },
    },
  }));
  for (const chip of chips.filter((entry) => entry.state === "blocked")) {
    assert.ok(chip.detail.trim().length > 0, `${chip.id} has a fallback detail`);
  }
});

test("the local chip counts the voices it actually found", () => {
  const one = researchProviderChips(readiness());
  assert.match(one.find((chip) => chip.id === "local")!.detail, /1 voice installed/);

  const many = researchProviderChips(readiness({
    providers: {
      local: {
        ready: true,
        voices: [
          { id: "a", name: "A", engine: "piper" },
          { id: "b", name: "B", engine: "kokoro" },
        ],
      },
      elevenlabs: { ready: true, defaultVoiceId: "x" },
    },
  }));
  assert.match(many.find((chip) => chip.id === "local")!.detail, /2 voices installed/);
});

test("the strip summary counts ready providers, and says so while loading", () => {
  assert.equal(describeProviderChips(researchProviderChips(readiness())), "Media providers — 3 of 4 ready");
  assert.equal(
    describeProviderChips(researchProviderChips(null)),
    "Media provider readiness is still loading",
  );
});
