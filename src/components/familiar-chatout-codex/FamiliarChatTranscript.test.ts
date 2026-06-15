// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const transcriptSource = readFileSync(new URL("./FamiliarChatTranscript.tsx", import.meta.url), "utf8");
const mockSource = readFileSync(new URL("./mockTranscript.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

assert.match(
  transcriptSource,
  /export function FamiliarChatTranscript/,
  "FamiliarChatTranscript should export the transcript composer",
);

assert.match(
  transcriptSource,
  /mockTranscript|transcript\.map|entries\.map/,
  "FamiliarChatTranscript should render a transcript array instead of hardcoded rows",
);

assert.match(transcriptSource, /<UserRow/, "Transcript should render user rows");
assert.match(transcriptSource, /<AssistantProseRow/, "Transcript should render assistant prose rows");
assert.match(transcriptSource, /<CenteredPill/, "Transcript should render centered pill rows");
assert.match(transcriptSource, /<TranscriptCard/, "Transcript should render edit cards");
assert.match(transcriptSource, /<RetryRow/, "Transcript should render retry footer rows");
assert.match(transcriptSource, /<RunTimeChip/, "Transcript should render run-time chips");

assert.match(
  mockSource,
  /Worked for 12m 04s/,
  "Mock transcript should include the requested run-time chip text",
);

assert.match(
  mockSource,
  /commit and publish after we confirm/,
  "Mock transcript should include the centered commit/publish directive",
);

assert.match(
  mockSource,
  /files:\s*\[[\s\S]*?\{[\s\S]*?\}[\s\S]*?\]/,
  "Mock transcript should include aggregate file rows",
);

assert.match(
  indexSource,
  /export \{ FamiliarChatTranscript \}/,
  "Barrel should export FamiliarChatTranscript",
);

console.log("FamiliarChatTranscript.test.ts: ok");
