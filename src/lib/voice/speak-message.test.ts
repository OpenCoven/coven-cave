import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  resolveSpeechPlan,
  speechRequestFor,
  speechTextFor,
  stripMarkdownForSpeech,
  SPEAK_MAX_CHARS,
} from "./speak-message.ts";

// ── Engine selection ────────────────────────────────────────────────────────
// Only /api/voice/local/tts and /api/voice/elevenlabs/tts accept arbitrary
// text; /api/voice/preview returns a canned sample, so it can never voice a
// reply. Everything else must land on the platform synthesizer.

assert.deepEqual(
  resolveSpeechPlan({ provider: "local", name: "piper-amy-medium-en-us" }),
  { engine: "local", voiceName: "piper-amy-medium-en-us" },
  "a local provider with a known Piper voice uses the local neural route",
);
assert.deepEqual(
  resolveSpeechPlan({ provider: "familiar", name: "piper-amy-medium-en-us" }),
  { engine: "local", voiceName: "piper-amy-medium-en-us" },
  "'familiar' is the studio's other spelling of the local provider",
);
assert.equal(
  resolveSpeechPlan({ provider: "local", name: "Samantha" }).engine,
  "system",
  "a local provider pointed at a system voice is NOT a neural voice",
);
assert.deepEqual(
  resolveSpeechPlan({ provider: "elevenlabs", name: "voice-1", model: "model-1" }),
  { engine: "elevenlabs", voiceId: "voice-1", modelId: "model-1" },
  "elevenlabs carries both the voice and the model",
);
assert.deepEqual(
  resolveSpeechPlan({ provider: "elevenlabs", name: "voice-1" }),
  { engine: "elevenlabs", voiceId: "voice-1" },
  "an absent model is omitted rather than sent empty",
);
assert.equal(
  resolveSpeechPlan({ provider: "openai", name: "alloy" }).engine,
  "system",
  "openai has no arbitrary-text route, so a reply falls back to the platform voice",
);
assert.deepEqual(resolveSpeechPlan({}), { engine: "system" }, "no config at all still speaks");
assert.equal(
  resolveSpeechPlan({ provider: "elevenlabs" }).engine,
  "system",
  "elevenlabs without a voice id cannot be called — fall back rather than POST a broken body",
);
assert.equal(
  resolveSpeechPlan({ provider: "  LOCAL  ", name: "piper-amy-medium-en-us" }).engine,
  "local",
  "provider matching is case- and whitespace-insensitive",
);

// ── Request shape ───────────────────────────────────────────────────────────
assert.deepEqual(
  speechRequestFor({ engine: "local", voiceName: "piper-amy-medium-en-us" }, "hi"),
  { url: "/api/voice/local/tts", body: { text: "hi", voiceName: "piper-amy-medium-en-us" } },
  "the local route takes text + voiceName",
);
assert.deepEqual(
  speechRequestFor({ engine: "elevenlabs", voiceId: "v", modelId: "m" }, "hi"),
  { url: "/api/voice/elevenlabs/tts", body: { text: "hi", voiceId: "v", modelId: "m" } },
  "the elevenlabs route takes text + voiceId + modelId",
);
assert.equal(
  speechRequestFor({ engine: "system" }, "hi"),
  null,
  "the system engine has no request — null tells the caller to use speechSynthesis",
);

// ── Markdown is unlistenable ────────────────────────────────────────────────
assert.equal(
  stripMarkdownForSpeech("Here is `code` and **bold** and _soft_ text."),
  "Here is code and bold and soft text.",
  "inline markers are dropped but their words survive",
);
assert.match(
  stripMarkdownForSpeech("Before\n```js\nconst a = 1;\n```\nAfter"),
  /Before\n\(code block\)\nAfter/,
  "a fenced block is announced, not read out line by line, with no stranded spaces",
);
assert.equal(
  stripMarkdownForSpeech("See [the docs](https://example.com) now"),
  "See the docs now",
  "link text is spoken and the URL is not",
);
assert.equal(
  stripMarkdownForSpeech("![alt text](img.png)Hello"),
  "Hello",
  "images contribute nothing spoken",
);
assert.equal(
  stripMarkdownForSpeech("## Heading\n\n> quoted\n\n- one\n- two"),
  "Heading\n\nquoted\n\none\ntwo",
  "headings, quotes and bullets lose their punctuation",
);
assert.equal(
  stripMarkdownForSpeech("A claim[^1]\n\n[^1]: https://example.com \"Title\""),
  "A claim",
  "citation markers and their definitions are not read aloud",
);

// ── Length cap ──────────────────────────────────────────────────────────────
const long = `${"word ".repeat(2000)}. tail`;
const capped = speechTextFor(long);
assert.ok(capped.length <= SPEAK_MAX_CHARS, "output respects the cap");
assert.equal(speechTextFor("short"), "short", "short replies pass through untouched");
assert.equal(speechTextFor("   "), "", "whitespace-only yields nothing to speak");
const sentences = `${"Sentence here. ".repeat(400)}`;
assert.ok(
  speechTextFor(sentences).endsWith("."),
  "when a sentence boundary is near the cap, playback stops on it rather than mid-word",
);

// ── Wiring: assistant More owns a persistent speech controller ──────────────
const bubble = await readFile(new URL("../../components/message-bubble.tsx", import.meta.url), "utf8");
const speak = await readFile(new URL("../../components/speak-bubble.tsx", import.meta.url), "utf8");

assert.match(
  bubble,
  /<SpeakBubble\s+text=\{content\}\s+familiarId=\{feedbackContext\?\.familiarId\}\s+hidden\s+controllerRef=\{speechRef\}/,
  "assistant replies retain a mounted speaker controller and read the familiar from feedbackContext",
);
assert.match(
  bubble,
  /<PopoverItem[\s\S]*?onSelect=\{\(\) => speechRef\.current\?\.toggle\(\)\}[\s\S]*?Read aloud/,
  "Read aloud is exposed through the assistant response More menu",
);
assert.match(speak, /aria-label=\{busy \? "Stop reading response" : "Read response aloud"\}/, "the control names both of its states");
assert.match(speak, /state === "playing"\s*\?\s*"ph:stop-fill"/, "playing shows a stop affordance");
assert.match(speak, /"ph:speaker-high-fill"/, "idle shows the audio icon");
assert.match(speak, /let activeStop: \(\(\) => void\) \| null = null;/, "only one message speaks at a time");
assert.match(speak, /activeStop\?\.\(\);/, "starting playback stops whatever was already speaking");
assert.match(speak, /useEffect\(\(\) => \(\) => \{ teardown\(\);/, "unmounting a bubble stops its audio");
assert.match(speak, /URL\.revokeObjectURL/, "blob urls are revoked rather than leaked");
assert.match(speak, /voicesCache = null;/, "a failed familiars load is not cached for the app's lifetime");
assert.match(speak, /gen !== genRef\.current/, "a superseded synthesis never starts playing");

console.log("speak-message guard passed");
