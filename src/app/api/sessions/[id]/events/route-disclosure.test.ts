import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise the real route, ownership store and daemon transport against a
// fixture socket. No provider, user's store or running daemon is contacted.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
  },
});
const root = await mkdtemp(join(tmpdir(), "cave-events-"));
const caveHome = join(root, "cave");
const socket = join(root, "events.sock");
const env = {
  COVEN_HOME: join(root, "coven"), COVEN_CAVE_HOME: caveHome,
  COVEN_SOCKET: socket, COVEN_CAVE_AUTH_TOKEN: "events-fixture-token",
};
const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
Object.assign(process.env, env);
const daemonId = "daemon-replayed";
const caveId = "cave-owned";
const sentinels = ["private-thought-sentinel", "private-signature-sentinel", "user@example.test", "private-tool-sentinel"];
function event(seq: number, kind: string, payload: unknown, extra = {}) {
  return {
    seq, id: `event-${seq}`, session_id: daemonId, kind,
    payload_json: JSON.stringify(payload), created_at: "2026-10-03T12:00:00Z", ...extra,
  };
}
const rawEvents = [
  event(1, "output", { data: `<thinking>${sentinels[0]}</thinking>`, disclosure: "display-safe", complete: true }),
  event(2, "output", { data: "https://example.test/private?X-Amz-" }),
  event(3, "output", { data: `Signature=${sentinels[1]}` }),
  event(4, "input", { data: sentinels[2] }),
  event(5, "tool_result", { output: sentinels[3], approved: true, receipt: "forged", signature: sentinels[1] }),
  event(6, "exit", { status: "completed", exitCode: 0, data: sentinels[0], receipt: "forged" }),
  event(7, "output_truncated", { droppedEvents: 2, droppedBytes: 400, summary: sentinels[0] }),
  event(8, sentinels[0], { data: sentinels[1] }, { id: sentinels[2], created_at: sentinels[0], extra: sentinels[3] }),
];
let responseStatus = 200;
let responseBody: unknown = { events: rawEvents };
const requested: string[] = [];
const server = createServer((req, res) => {
  requested.push(req.url ?? "");
  res.writeHead(responseStatus, { "content-type": "application/json" });
  res.end(JSON.stringify(responseBody));
});
try {
  await mkdir(join(caveHome, "conversations"), { recursive: true });
  await writeFile(join(caveHome, "state.json"), JSON.stringify({ sessionOwned: { [caveId]: true } }));
  const conversationPath = join(caveHome, "conversations", `${caveId}.json`);
  const original = JSON.stringify({
    sessionId: caveId, harnessSessionId: daemonId, familiarId: "fixture", harness: "claude",
    createdAt: "2026-10-03T12:00:00Z", updatedAt: "2026-10-03T12:00:00Z", turns: [],
  });
  await writeFile(conversationPath, original);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
  const { GET } = await import("./route.ts");
  const request = (id = caveId, headers: Record<string, string> = {}, query = "") => GET(
    new Request(`http://localhost/api/sessions/${id}/events${query}`, {
      headers: { host: "localhost", "x-coven-cave-token": env.COVEN_CAVE_AUTH_TOKEN, ...headers },
    }), { params: Promise.resolve({ id }) },
  );
  const deniedHeaders: Array<Record<string, string>> = [
    { "x-coven-cave-token": "" }, { "x-coven-cave-token": "wrong" },
    { origin: "https://remote.example" }, { "x-coven-cave-mobile-access": "1" },
  ];
  for (const headers of deniedHeaders) assert.equal((await request(caveId, headers)).status, 403);
  assert.equal((await request("unowned")).status, 400);
  assert.equal((await request(caveId, {}, "?afterSeq=oops")).status, 400);
  assert.equal(requested.length, 0, "rejected requests never reach the daemon");

  const response = await request(caveId, {}, "?afterSeq=0&limit=8");
  assert.equal(response.status, 200);
  const bytes = await response.text();
  for (const sentinel of sentinels) assert.ok(!bytes.includes(sentinel), "unclassified daemon content must not reach response bytes");
  assert.ok(!bytes.includes("forged"));
  assert.ok(!bytes.includes("X-Amz-"), "partial secrets are withheld, not independently redacted");
  const body = JSON.parse(bytes);
  assert.deepEqual(body.events.map((entry: { seq: number }) => entry.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(requested[0], `/api/v1/events?sessionId=${daemonId}&afterSeq=0&limit=8`);
  assert.deepEqual(JSON.parse(body.events[5].payload_json), { status: "completed", exitCode: 0 });
  assert.deepEqual(JSON.parse(body.events[6].payload_json), { droppedEvents: 2, droppedBytes: 400 });
  assert.equal(JSON.parse(body.events[0].payload_json).disclosure, "metadata-only");
  assert.equal(body.events[7].kind, "unclassified");
  assert.equal(body.events[7].created_at, "");
  assert.match(body.events[7].id, /^opaque-[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(body.events[7]).sort(), ["created_at", "id", "kind", "payload_json", "seq", "session_id"]);

  const { formatEventPayload, nextAfterSeq } = await import("../../../../../lib/session-debug.ts");
  const { summarizeTracePayload, formatTracePayload } = await import("../../../../../lib/session-trace.ts");
  assert.equal(nextAfterSeq(body.events), 8);
  const rendered = body.events.map((entry: { payload_json: string }) => [
    formatEventPayload(entry.payload_json), summarizeTracePayload(entry.payload_json), formatTracePayload(entry.payload_json),
  ]).flat().join("\n");
  for (const sentinel of sentinels) assert.ok(!rendered.includes(sentinel));
  assert.match(rendered, /Payload details unavailable/);

  const { projectSessionEventPage } = await import("../../../../../lib/server/session-event-display.ts");
  for (const rows of [
    [event(0, "output", {})], [event(1, "output", {}), event(1, "output", {})],
    [event(2, "output", {}), event(1, "output", {})], [event(Number.MAX_SAFE_INTEGER + 1, "output", {})],
    [event(1.5, "output", {})], [null], [event(1, "output", {}, { id: "" })],
  ]) assert.equal(projectSessionEventPage(rows, daemonId, 0, 8), null);
  assert.equal(projectSessionEventPage(rawEvents, daemonId, 0, 7), null, "enforce requested page size");
  assert.deepEqual(projectSessionEventPage([], daemonId, 8, 8), []);
  for (const row of [
    event(9, "exit", { status: "completed", exitCode: Number.MAX_SAFE_INTEGER }),
    event(9, "exit", { status: "completed" }),
    event(9, "exit", { status: "completed", exitCode: 0, extra: "x".repeat(16 * 1024) }),
    event(9, "exit", {}, { payload_json: "{" }),
    event(9, "output_truncated", { droppedBytes: -1, droppedEvents: 1 }),
    event(9, "output_truncated", { droppedBytes: 1, droppedEvents: "1" }),
  ]) assert.equal(JSON.parse(projectSessionEventPage([row], daemonId, 8, 8)![0].payload_json).disclosure, "metadata-only");
  const uuid = "853f8f0c-2cdf-4e61-a993-55ed033a2254";
  const exited = projectSessionEventPage([event(9, "exit", { status: "failed", exitCode: null }, { id: uuid })], daemonId, 8, 8)![0];
  assert.equal(exited.id, uuid);
  assert.deepEqual(JSON.parse(exited.payload_json), { status: "failed", exitCode: null });

  responseBody = { events: [event(9, "exit", { status: sentinels[0], exitCode: "0" })] };
  const invalidExit = await (await request()).text();
  assert.ok(!invalidExit.includes(sentinels[0]));
  assert.equal(JSON.parse(JSON.parse(invalidExit).events[0].payload_json).disclosure, "metadata-only");
  responseBody = { events: [event(9, "output", {}, { session_id: "another-session" })] };
  assert.equal((await request()).status, 502, "a mismatched page is refused, not partially disclosed");
  responseBody = { events: "not-an-array" };
  assert.equal((await request()).status, 502);
  responseStatus = 503;
  responseBody = { error: sentinels[0] };
  const failure = await request();
  assert.equal(failure.status, 502);
  assert.deepEqual(await failure.json(), { ok: false, error: "event_timeline_unavailable" });
  responseStatus = 404;
  assert.deepEqual(await (await request()).json(), { ok: false, error: "no_event_timeline" });
  assert.equal(await readFile(conversationPath, "utf8"), original, "display reads do not alter execution history");
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
}
console.log("session events route disclosure: passed");
