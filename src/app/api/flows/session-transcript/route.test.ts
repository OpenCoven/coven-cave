// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
// The three-source transcript chain moved to the shared resolver so the
// research-mission reconcile can read the same transcripts server-side
// (cave-ibb7); the route is now a thin wrapper over it.
const resolver = await readFile(
  new URL("../../../../lib/server/flow-session-transcript.ts", import.meta.url),
  "utf8",
);

assert.match(route, /export async function GET\(req: Request\)/, "route should expose a GET handler");
assert.match(
  route,
  /isSafeConversationSessionId\(sessionId\)[\s\S]*status: 400/,
  "route should reject unsafe session ids",
);
assert.match(route, /flowSessionTranscript\(sessionId\)/, "route should delegate to the shared transcript resolver");
assert.match(
  route,
  /NextResponse\.json\(\{ ok: true, transcript, found: Boolean\(transcript\.trim\(\)\) \}\)/,
  "missing flow transcripts should return an empty successful payload instead of HTTP 404",
);

assert.match(
  resolver,
  /loadConversation\(sessionId\)[\s\S]*assistantTranscript\(conversation\)/,
  "resolver should read persisted Cave conversations first",
);
assert.match(
  resolver,
  /loadConversationFromJsonl\(sessionId, familiarId\)[\s\S]*assistantTranscript\(jsonlConversation\)/,
  "resolver should fall back to OpenClaw JSONL transcripts",
);
assert.match(resolver, /callDaemon<\{ events: CovenEvent\[\] \}>/, "resolver should read daemon events for live flow sessions");
assert.match(resolver, /eventOutputTranscript/, "resolver should convert daemon output events into a pollable transcript");
assert.match(resolver, /stripAnsi/, "daemon PTY output should be ANSI-stripped before progress parsing");
assert.match(
  resolver,
  /sessionOwned\?\.\[sessionId\]|sessionFamiliar\?\.\[sessionId\]/,
  "daemon events stay gated on Cave session ownership",
);
// (use-flow-run client pins left with the retired flow components — cave-c3yt.)

console.log("flows session-transcript route.test.ts: ok");
