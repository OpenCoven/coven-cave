import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Exercise the imported send handler with a deterministic executable. Pin the
// in-memory manifest to an absolute fixture so host PATH can never select the
// installed Copilot. No production registry or trust material is changed.
const home = await mkdtemp(path.join(homedir(), "cave-copilot-identity-"));
const workspace = path.join(home, "familiars", "opal");
const framesPath = path.join(home, "frames.jsonl");
const launchesPath = path.join(home, "launches.jsonl");
const bin = path.join(home, "bin");
const executable = path.join(bin, process.platform === "win32" ? "copilot.cmd" : "copilot");
const entry = path.join(bin, "node_modules", "@github", "copilot", "index.js");
const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");

const { REGISTRY_RUNTIMES } = await import("@/lib/runtime-registry.gen");
const manifest = REGISTRY_RUNTIMES.find((runtime) => runtime.id === "copilot")?.adapterManifest as {
  adapters: Array<{ id: string; executable: string }>;
};
const adapter = manifest.adapters.find((candidate) => candidate.id === "copilot")!;
const previousExecutable = adapter.executable;

try {
  await mkdir(workspace, { recursive: true });
  await mkdir(path.dirname(entry), { recursive: true });
  const program = [
    `#!${process.execPath}`,
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "if (args.includes('--version')) { console.log('1.0.82'); process.exit(0); }",
    "if (!args.includes('--output-format') || !args.includes('json')) process.exit(12);",
    `fs.appendFileSync(${JSON.stringify(launchesPath)}, JSON.stringify(args) + '\\n');`,
    `process.stdout.write(fs.readFileSync(${JSON.stringify(framesPath)}, 'utf8'));`,
  ].join("\n");
  if (process.platform === "win32") {
    await writeFile(entry, program);
    await writeFile(executable, '@echo off\n"%~dp0\\node_modules\\@github\\copilot\\index.js" %*\n');
  } else {
    await writeFile(executable, program, { mode: 0o755 });
  }
  adapter.executable = executable;

  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { subscribeRunStream } = await import("@/lib/server/chat-stream-buffer");
  const { POST } = await import("./route.ts");
  await saveConfig({ familiars: { opal: { harness: "copilot" } } });
  const project = await createProject({ name: "Copilot identity fixture", root: workspace });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });

  const cases = [
    { name: "later exact report", first: "gpt-6.1-sol", later: "claude-sonnet-5", expected: "claude-sonnet-5" },
    { name: "later unavailable report", first: "gpt-6.1-sol", later: "unknown", expected: null },
    { name: "later null report", first: "gpt-6.1-sol", later: null, expected: null },
    { name: "later empty report", first: "gpt-6.1-sol", later: "", expected: null },
    { name: "later malformed report", first: "gpt-6.1-sol", later: { model: "forged" }, expected: null },
    { name: "later numeric report", first: "gpt-6.1-sol", later: 42, expected: null },
    { name: "later alias", first: "gpt-6.1-sol", later: "auto", expected: null },
    { name: "absent later report", first: "gpt-6.1-sol", later: undefined, expected: "gpt-6.1-sol" },
    { name: "no assistant report", first: undefined, later: undefined, expected: null },
  ];
  const sessionIds = new Set<string>();
  for (const scenario of cases) {
    const runId = randomUUID();
    const frames = [
      { type: "tool.execution_start", data: { toolCallId: "probe", toolName: "read_file", model: "PRIVATE_TOOL_MODEL" } },
      { type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "First.", model: "PRIVATE_DELTA_MODEL" } },
      { type: "assistant.message", data: { messageId: "m1", content: "First.", model: scenario.first } },
      { type: "assistant.message", data: { messageId: "m2", content: "Final.", model: scenario.later } },
      { type: "tool.execution_complete", data: { toolCallId: "probe", success: true, result: { content: "safe" }, model: "PRIVATE_TOOL_END_MODEL" } },
      { type: "result", exitCode: 0, model: "PRIVATE_RESULT_MODEL" },
    ];
    await writeFile(framesPath, frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n");
    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, familiarId: "opal", prompt: "fixture", projectRoot: workspace,
        modelOverride: "requested-only", modelOverrideScope: "next-message", permissionMode: "read" }),
    }));
    const body = await response.text();
    assert.equal(response.status, 200, body);
    const events = body.split("\n").filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    const done = events.findLast((event) => event.kind === "done");
    assert.ok(done?.sessionId, scenario.name);
    assert.equal(sessionIds.has(done.sessionId), false, "each fixture launches a fresh session");
    sessionIds.add(done.sessionId);
    assert.equal(done.responseMetadata?.runtimeIdentity?.model, scenario.expected, scenario.name);
    assert.equal(done.responseMetadata?.runtimeIdentity?.version, "1.0.82");
    assert.equal(done.responseMetadata?.runtimeIdentity?.activity?.tools, "supported");
    assert.equal(done.responseMetadata?.requestedModel, "requested-only");
    assert.equal(done.responseMetadata?.forwardedModel, "requested-only");
    assert.equal(done.responseMetadata?.confirmedModel, scenario.expected ?? undefined);
    assert.doesNotMatch(body, /PRIVATE_/, "unqualified fields never reach stream metadata");

    const reports = events.filter((event) => event.kind === "response_metadata")
      .map((event) => event.responseMetadata.runtimeIdentity.model);
    const transitions = reports.filter((model, index) => index === 0 || model !== reports[index - 1]);
    const expectedTransitions: Array<string | null> = [null];
    if (scenario.first) expectedTransitions.push(scenario.first);
    if (scenario.expected !== expectedTransitions.at(-1)) expectedTransitions.push(scenario.expected);
    assert.deepEqual(transitions, expectedTransitions, "live identity follows qualified assistant reports");
    const conversation = await loadConversation(done.sessionId);
    assert.deepEqual(conversation?.turns.at(-1)?.responseMetadata?.runtimeIdentity,
      done.responseMetadata.runtimeIdentity, "history keeps the final report, including explicit unavailability");
    assert.equal(conversation?.turns.at(-1)?.responseMetadata?.confirmedModel, scenario.expected ?? undefined);
    assert.doesNotMatch(JSON.stringify(conversation), /PRIVATE_/);
    const replay = subscribeRunStream(runId, 0, () => {}, () => {});
    assert.ok(replay?.done, "completed turns remain available to reconnecting clients");
    const replayed = replay.replay.map((entry) => JSON.parse(entry.json));
    assert.deepEqual(replayed.filter((event) => event.kind === "response_metadata"),
      events.filter((event) => event.kind === "response_metadata"), "replay retains each original identity observation");
    assert.deepEqual(replayed.findLast((event) => event.kind === "done")?.responseMetadata, done.responseMetadata);
    assert.doesNotMatch(JSON.stringify(replayed), /PRIVATE_/);
    replay.unsubscribe();
  }
  const launches = (await readFile(launchesPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(launches.length, cases.length, "exactly one deterministic child per request");
  assert.ok(launches.every((args: string[]) => args[args.indexOf("--model") + 1] === "requested-only"),
    "reported changes never rewrite requested launch intent");
  console.log("route-copilot-identity.integration.test.ts: ok");
} finally {
  adapter.executable = previousExecutable;
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  await rm(home, { recursive: true, force: true });
}
