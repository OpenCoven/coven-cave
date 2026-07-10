// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");

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
assert.match(route, /callDaemon<\{ events: CovenEvent\[\] \}>/, "route should read daemon events for live flow sessions");
assert.match(route, /eventOutputTranscript/, "route should convert daemon output events into a pollable transcript");
assert.match(route, /stripAnsi/, "daemon PTY output should be ANSI-stripped before progress parsing");
assert.match(
  route,
  /NextResponse\.json\(\{ ok: true, transcript: "", found: false \}\)/,
  "missing flow transcripts should return an empty successful payload instead of HTTP 404",
);
// (use-flow-run client pins left with the retired flow components — cave-c3yt.)

console.log("flows session-transcript route.test.ts: ok");
