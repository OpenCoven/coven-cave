// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./TranscriptCard.tsx", import.meta.url), "utf8");
const mockSource = readFileSync(new URL("./mockTranscript.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

assert.match(source, /export function TranscriptCard/, "TranscriptCard should be exported");
assert.match(source, /card\.kind === "aggregate"/, "TranscriptCard should branch on aggregate edit cards");
assert.match(source, /card\.path/, "TranscriptCard should render the single-file edit path");
assert.match(mockSource, /kind:\s*"single"/, "Mock data should define a single-file edit shape");
assert.match(mockSource, /kind:\s*"aggregate"/, "Mock data should define an aggregate edit shape");
assert.match(source, /Show \{hiddenCount\} more files/, "Aggregate cards should include the disclosure copy");
assert.match(source, /Open in/, "Cards should expose the Open in action");
assert.match(source, /Undo/, "Cards should expose the Undo action");
assert.match(source, /Review/, "Cards should expose the Review action");
assert.match(source, /styles\.addition/, "Cards should style addition counts");
assert.match(source, /styles\.deletion/, "Cards should style deletion counts");

assert.match(
  mockSource,
  /kind:\s*"single"[\s\S]*?path:\s*"src\/components\/chat-router\.tsx"/,
  "Mock transcript should include a single-file edit card",
);

assert.match(
  mockSource,
  /kind:\s*"aggregate"[\s\S]*?fileCount:\s*9[\s\S]*?additions:\s*121[\s\S]*?deletions:\s*107/,
  "Mock transcript should include the requested 9-file aggregate totals",
);

assert.match(
  indexSource,
  /export \{ TranscriptCard \}/,
  "Barrel should export TranscriptCard",
);

console.log("TranscriptCard.test.ts: ok");
