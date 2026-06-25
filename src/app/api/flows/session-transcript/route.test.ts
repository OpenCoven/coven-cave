// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const hook = await readFile(new URL("../../../../components/flow/use-flow-run.ts", import.meta.url), "utf8");

assert.match(route, /export async function GET\(req: Request\)/, "route should expose a GET handler");
assert.match(
  route,
  /isSafeConversationSessionId\(sessionId\)[\s\S]*status: 400/,
  "route should reject unsafe session ids",
);
assert.match(
  route,
  /loadConversation\(sessionId\)[\s\S]*assistantTranscript\(conversation\)[\s\S]*found: true/,
  "route should read persisted Cave conversations",
);
assert.match(
  route,
  /loadConversationFromJsonl\(sessionId, familiarId\)[\s\S]*assistantTranscript\(jsonlConversation\)[\s\S]*found: true/,
  "route should fall back to OpenClaw JSONL transcripts",
);
assert.match(
  route,
  /NextResponse\.json\(\{ ok: true, transcript: "", found: false \}\)/,
  "missing flow transcripts should return an empty successful payload instead of HTTP 404",
);
assert.match(
  hook,
  /\/api\/flows\/session-transcript\?\$\{params\.toString\(\)\}/,
  "flow polling should use the no-404 transcript endpoint",
);
assert.doesNotMatch(
  hook,
  /\/api\/chat\/conversation\//,
  "flow polling should not fetch missing chat conversations directly",
);

console.log("flows session-transcript route.test.ts: ok");
