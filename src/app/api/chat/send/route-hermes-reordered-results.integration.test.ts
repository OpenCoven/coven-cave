// @ts-nocheck
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const fixture = JSON.parse(await readFile(new URL("../../../../../apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-activity-reordered-results-v1.json", import.meta.url), "utf8"));
const home = await mkdtemp(path.join(tmpdir(), "cave-hermes-reordered-"));
const workspace = path.join(home, "workspace");
await mkdir(workspace);
const previousEnv = { ...process.env };
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
let providerRequests = 0;
const provider = createServer(async (req, res) => {
  for await (const _chunk of req) { /* consume only the controlled request */ }
  providerRequests++;
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const [event, data] of fixture.events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
process.env.HERMES_API_URL = `http://127.0.0.1:${provider.address().port}`;
process.env.HERMES_API_KEY = "local-fixture-key";

try {
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { subscribeRunStream } = await import("@/lib/server/chat-stream-buffer");
  const { POST } = await import("./route.ts");
  await saveConfig({ familiars: { ember: { harness: "hermes", model: "" } } });
  const project = await createProject({ name: "Reordered result fixture", root: workspace });
  await grantProjectToFamiliar({ familiarId: "ember", projectId: project.id, source: "human", access: "write" });
  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: "reordered-results-fixture", familiarId: "ember", projectRoot: workspace, prompt: "Controlled tool correlation fixture" }),
  }));
  assert.equal(response.status, 200);
  const events = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  const tools = events.filter(event => event.kind === "tool_use");
  for (const expected of fixture.expected.tools) {
    const terminal = tools.findLast(event => event.id === expected.id);
    assert.equal(terminal?.status, expected.status, "a result before start must settle under its native call ID");
    assert.equal(terminal.output, expected.output, "duplicate/reordered frames preserve the first terminal result");
    assert.equal(terminal.name, expected.name);
    assert.equal(terminal.activity.authority.effect, "unavailable");
  }
  const done = events.findLast(event => event.kind === "done");
  const saved = (await loadConversation(done.sessionId)).turns.at(-1);
  assert.equal(saved.tools.length, fixture.expected.tools.length, "duplicate same-name envelopes must not create extra cards");
  assert.deepEqual(new Set(saved.tools.map(tool => tool.id)), new Set(fixture.expected.tools.map(tool => tool.id)));
  for (const expected of fixture.expected.tools) {
    const tool = saved.tools.find(tool => tool.id === expected.id);
    assert.equal(tool.status, expected.status);
    assert.equal(tool.output, expected.output);
    assert.deepEqual(tool.activity, tools.findLast(event => event.id === expected.id).activity);
  }
  const replay = subscribeRunStream("reordered-results-fixture", 0, () => {}, () => {});
  assert.ok(replay?.done);
  assert.deepEqual(replay.replay.map(entry => JSON.parse(entry.json)).filter(event => event.kind === "tool_use"), tools);
  replay.unsubscribe();
  assert.equal(providerRequests, 1);
  console.log("route-hermes-reordered-results.integration.test.ts: ok");
} finally {
  await new Promise(resolve => provider.close(resolve));
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  await rm(home, { recursive: true, force: true });
}
