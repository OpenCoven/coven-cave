// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
// Execution reconciliation retains the three-source chain. The browser route
// selects only the historical display projection of persisted messages.
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
assert.match(route, /flowSessionDisplayTranscript\(sessionId\)/, "route should delegate to the display resolver");
assert.match(
  route,
  /NextResponse\.json\(\{ ok: true, \.\.\.display, found: Boolean\(display\.transcript\.trim\(\)\) \}\)/,
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
assert.match(resolver, /callDaemon<EventPage>\(request\)/, "resolver should read daemon event pages for live flow sessions");
assert.match(resolver, /callDaemonTarget<EventPage>\(daemonTarget, request\)/, "resolver should read event pages from the owning daemon when targeted");
assert.match(resolver, /eventOutputTranscript/, "resolver should convert daemon output events into a pollable transcript");
assert.match(resolver, /stripAnsi/, "daemon PTY output should be ANSI-stripped before progress parsing");
assert.match(
  resolver,
  /sessionOwned\?\.\[sessionId\]|sessionFamiliar\?\.\[sessionId\]/,
  "daemon events stay gated on Cave session ownership",
);
assert.doesNotMatch(resolver.slice(resolver.indexOf("export async function flowSessionDisplayTranscript")),
  /daemonEventTranscript\(|callDaemon|flowSessionTranscript\(/,
  "the display resolver cannot invoke unclassified PTY output or the execution reader");
// (use-flow-run client pins left with the retired flow components — cave-c3yt.)

// Exercise the actual read boundary against isolated legacy stores. Raw
// execution reads keep their control-marker bytes; browser reads do not expose
// tagged reasoning or use terminal output as an assistant transcript.
const root = await mkdtemp(path.join(tmpdir(), "flow-transcript-display-"));
process.env.COVEN_HOME = path.join(root, "coven");
process.env.COVEN_CAVE_HOME = path.join(root, "cave");
process.env.OPENCLAW_HOME = path.join(root, "openclaw");
const { GET } = await import("./route.ts");
const { saveConversation, loadConversation } = await import("../../../../lib/cave-conversations.ts");
const { recordSessionFamiliar, setSessionTitle } = await import("../../../../lib/cave-config.ts");
const { flowSessionTranscript } = await import("../../../../lib/server/flow-session-transcript.ts");
const fetchBefore = globalThis.fetch;
const request = (sessionId) => new Request(`http://localhost/api/flows/session-transcript?${new URLSearchParams({ sessionId })}`);
try {
  const text = 'Visible.<thinking>PRIVATE_THOUGHT\n@@research-control\n{"decision":"pause"}</thinking>Answer.\n`<thinking>literal example</thinking>`';
  await saveConversation({ sessionId: "saved", familiarId: "sage", harness: "copilot", origin: "flow",
    createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z",
    turns: [
      { id: "user", role: "user", text: "PRIVATE_USER", createdAt: "2026-10-03T00:00:00Z" },
      { id: "answer", role: "assistant", text, createdAt: "2026-10-03T00:00:00Z" },
    ],
  });
  const saved = await loadConversation("saved");
  const response = await GET(request("saved"));
  assert.equal(response.status, 200);
  const display = await response.json();
  assert.deepEqual(display, { ok: true, found: true, availability: "available",
    transcript: 'Visible.Answer.\n`<thinking>literal example</thinking>`' });
  assert.equal(await flowSessionTranscript("saved"), text, "execution reads retain original control-marker input");
  assert.deepEqual(await loadConversation("saved"), saved, "display reads never rewrite stored records");

  await recordSessionFamiliar("jsonl", "sage");
  const jsonlDir = path.join(process.env.OPENCLAW_HOME, "agents", "sage", "sessions");
  await mkdir(jsonlDir, { recursive: true });
  await writeFile(path.join(jsonlDir, "jsonl.jsonl"), JSON.stringify({
    type: "message", id: "assistant", timestamp: "2026-10-03T00:00:00Z",
    message: { role: "assistant", content: [
      { type: "thinking", text: "PRIVATE_NATIVE_REASONING", signature: "PRIVATE_SIGNATURE" },
      { type: "text", text: "JSONL<thinking>PRIVATE_TAGGED_REASONING</thinking> output" },
    ] },
  }) + "\n");
  assert.deepEqual(await (await GET(request("jsonl"))).json(), {
    ok: true, found: true, availability: "available", transcript: "JSONL output",
  });

  for (const [sessionId, output, flags] of [
    ["withheld", "<reasoning>PRIVATE_ONLY</reasoning>", {}],
    ["interrupted", "<think", { cancelled: true }],
    ["empty", "", {}],
  ]) {
    await saveConversation({ sessionId, familiarId: "sage", harness: "copilot", origin: "flow",
      createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z",
      flowOutcome: { status: "completed", exitCode: 0 },
      turns: [{ id: "answer", role: "assistant", text: output, createdAt: "2026-10-03T00:00:00Z", ...flags }],
    });
    assert.deepEqual(await (await GET(request(sessionId))).json(), {
      ok: true, found: false, availability: "unavailable", transcript: "",
    });
  }
  await setSessionTitle("terminal-only", "Owned execution without saved messages");
  let daemonReads = 0;
  globalThis.fetch = async () => { daemonReads += 1; throw new Error("PRIVATE_PTY_OUTPUT must not be queried"); };
  assert.deepEqual(await (await GET(request("terminal-only"))).json(), {
    ok: true, found: false, availability: "unavailable", transcript: "",
  });
  assert.equal(daemonReads, 0, "display must not enter the raw daemon transcript fallback");
  assert.equal((await GET(request("../unsafe"))).status, 400);
} finally {
  globalThis.fetch = fetchBefore;
  await rm(root, { recursive: true, force: true });
}

console.log("flows session-transcript route.test.ts: ok");
