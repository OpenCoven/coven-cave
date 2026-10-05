// Opt-in production HTTP recovery qualification. External provider events are
// controlled; the counter is a fresh child process with an fsynced append.
// This does not establish browser/native rendering or protected-effect authority.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
const args = process.argv.slice(2);
const flags = args.slice(3);
const includeExpiry = flags.includes("--include-expiry");
const ringEviction = flags.includes("--ring-eviction");
const persistenceFailure = flags.includes("--persistence-failure");
const splitSecrets = flags.includes("--split-secrets");
const parallelCalls = flags.includes("--parallel-calls");
const invokeChild = promisify(execFile);
assert.ok(args[0] === "--execute" && args[1] === "--evidence" && path.isAbsolute(args[2] ?? "") && new Set(flags).size === flags.length && flags.every(flag => ["--include-expiry", "--ring-eviction", "--persistence-failure", "--split-secrets", "--parallel-calls"].includes(flag)) && !(persistenceFailure && (ringEviction || includeExpiry || splitSecrets || parallelCalls)) && !(parallelCalls && (ringEviction || splitSecrets)), "Usage: node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-effect-recovery.mjs --execute --evidence <new absolute directory> [--include-expiry] [--ring-eviction] [--split-secrets] OR [--include-expiry] --parallel-calls OR --persistence-failure");
assert.ok(["darwin", "linux"].includes(process.platform), "POSIX counter fixture only; other platforms remain unverified.");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), evidence = args[2];
await mkdir(evidence, { recursive: false, mode: 0o700 });
const root = await realpath(await mkdtemp(path.join(tmpdir(), "cave-activity-effects-")));
const covenHome = path.join(root, "coven"), caveHome = path.join(covenHome, "cave"), projectRoot = path.join(root, "project");
const imp = (f) => import(pathToFileURL(path.join(repo, f)).href);
const { startCave, stopCave, freePort } = await imp("scripts/client-v1-conformance.mjs");
const binary = execFileSync("which", ["coven"], { encoding: "utf8" }).trim();
const adminToken = randomUUID(), providerToken = randomUUID(), mobileToken = randomUUID();
const sourceFiles = ["scripts/runtime-activity-effect-recovery.mjs", "scripts/runtime-activity-effect-counter.mjs", "scripts/runtime-activity-effect-counter.test.mjs", "apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-activity-effect-http-v1.json", "apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-activity-reordered-results-v1.json", "src/app/api/chat/send/route.ts", "src/lib/chat-tool-events.ts", "src/lib/hermes-responses-stream.ts"];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash("sha256").update(await readFile(path.join(repo, file))).digest("hex")])));
const deadline = new AbortController();
const deadlineTimer = setTimeout(() => deadline.abort(new Error("qualification deadline exceeded")), includeExpiry ? 480_000 : 240_000);
const onInterrupt = () => deadline.abort(new Error("qualification interrupted"));
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onInterrupt);
const report = { schemaVersion: 1, scenario: "hermes-durable-effect-recovery", startedAt: (new Date()).toISOString(), omissions: ["HTTP client only; no browser/native renderer, real provider, protected receipts or human acceptance.", "Coven-specific state is isolated; HOME is unchanged.", "Ring eviction, access revocation and persistence-failure injection remain unverified."], head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: repo }).trim(), buildId: (await readFile(path.join(repo, ".next/BUILD_ID"), "utf8")).trim(), classification: "Production send/replay/history HTTP and process restart; synthetic external provider executing a real durable append counter in a child process. No browser/native rendering or protected-effect authority claim.", passed: false, checkpoints: [], providerRequests: 0, host: { node: process.version, platform: process.platform, architecture: process.arch } };
report.sourceHashes = await sourceHashes();
report.options = { includeExpiry, ringEviction, persistenceFailure, splitSecrets, parallelCalls };
report.productSourceUncommitted = Boolean(execFileSync("git", ["status", "--porcelain", "--", "src/app/api/chat/send/route.ts", "src/lib/chat-tool-events.ts", "src/lib/hermes-responses-stream.ts"], { encoding: "utf8", cwd: repo }).trim());
report.scenario = parallelCalls ? "hermes-durable-effect-parallel-reordered-results" : persistenceFailure ? "hermes-durable-effect-persistence-failure" : ringEviction ? "hermes-durable-effect-ring-eviction" : splitSecrets ? "hermes-durable-effect-split-secrets" : report.scenario;
report.omissions[2] = "Access revocation and process-crash durability remain unverified.";
if (!ringEviction) report.omissions.push("Ring eviction not run; use --ring-eviction.");
if (!persistenceFailure) report.omissions.push("Persistence failure not injected; use --persistence-failure separately.");
let serverLogs = "";
let serverLogOverflow = false;
const captureLogs = server => {
  if (!splitSecrets) return;
  for (const pipe of [server.child.stdout, server.child.stderr]) pipe.on("data", chunk => {
    if (serverLogOverflow) return;
    if (Buffer.byteLength(serverLogs) + chunk.length > 1024 * 1024) { serverLogOverflow = true; deadline.abort(new Error("fixture logs exceeded bound")); return; }
    serverLogs += chunk.toString();
  });
};
let cave, provider, daemon = false, releaseTool, releaseFinal, blockedDirectory;
const toolGate = new Promise((r) => releaseTool = r), finalGate = new Promise((r) => releaseFinal = r);
const ledger = path.join(projectRoot, "effect-invocations.jsonl");
const toolFile = path.join(repo, "scripts/runtime-activity-effect-counter.mjs");
const count = async () => (await readFile(ledger, "utf8")).split("\n").filter(Boolean).length;
const native = (args2) => execFileSync(binary, args2, { env: process.env, cwd: projectRoot, encoding: "utf8", timeout: 2e4, stdio: ["ignore", "pipe", "pipe"] });
const expectedCount = async (label, n = parallelCalls ? 3 : 1) => {
  report.stage = label;
  const value = await count();
  assert.equal(value, n, label);
  assert.equal(report.providerRequests, 1, label + " provider dispatch");
  report.checkpoints.push({ label, counter: value });
  console.log(JSON.stringify({ phase: label, counter: value }));
};
const frame = async (res, event, data) => {
  const bytes = Buffer.from(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (!splitSecrets) { res.write(bytes); return; }
  for (let offset = 0; offset < bytes.length; offset += 7) {
    if (offset > 0 && (bytes[offset] & 0xc0) === 0x80) report.providerUtf8SplitBoundaries++;
    if (!res.write(bytes.subarray(offset, offset + 7))) await once(res, "drain", { signal: deadline.signal });
    await delay(1, undefined, { signal: deadline.signal });
  }
};
const parse = (wire) => wire.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
let caveInput;
try {
  await mkdir(caveHome, { recursive: true, mode: 0o700 });
  await mkdir(projectRoot, { mode: 0o700 });
  await writeFile(ledger, "", { flag: "wx", mode: 0o600 });
  await writeFile(path.join(covenHome, "familiars.toml"), '[[familiar]]\nid = "effectfixture"\ndisplay_name = "Controlled effect fixture"\nrole = "Verification"\ndescription = "Isolated durable counter fixture."\n');
  execFileSync("git", ["init", "--quiet", projectRoot]);
  Object.assign(process.env, { COVEN_HOME: covenHome, COVEN_CAVE_HOME: caveHome, COVEN_SOCKET: path.join(covenHome, "coven.sock"), COVEN_BIN: binary, COVEN_WORKSPACE_ROOT: projectRoot, COVEN_WORKSPACES_ROOT: root, COVEN_VAULT_FILE: path.join(root, "vault.yaml"), COVEN_CAVE_ENV_FILE: path.join(root, ".env.local"), COVEN_CAVE_LOCAL_VAULT_FILE: path.join(root, "vault.enc.json"), COVEN_CAVE_LOCAL_VAULT_KEY_FILE: path.join(root, "vault.key"), COVEN_PREFERENCES_PATH: path.join(root, "preferences.json"), COVEN_THEME_PATH: path.join(root, "theme.json"), CAVE_PROJECTS_PATH_OVERRIDE: path.join(root, "projects.json"), CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE: path.join(root, "permissions.json"), CAVE_QUEUE_PROJECT_PATH_OVERRIDE: path.join(root, "queue.json") });
  delete process.env.COVEN_CAVE_E2E;
  const scenario = JSON.parse(await readFile(path.join(repo, "apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-activity-effect-http-v1.json"), "utf8"));
  let reordered;
  if (parallelCalls) {
    reordered = JSON.parse(await readFile(path.join(repo, "apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-activity-reordered-results-v1.json"), "utf8"));
    assert.equal(reordered.schemaVersion, 1);
    assert.equal(reordered.expected.tools.length, 3);
    const firstResult = reordered.events.findIndex(([, data]) => data.item?.type === "function_call_output");
    assert.ok(firstResult > 0);
    // Keep the reasoning/Unicode prefix, then use the shared call-order corpus.
    scenario.beforeRelease = [...scenario.beforeRelease.slice(0, 5), ...reordered.events.slice(1, firstResult)];
    scenario.expected.counter = 3;
    reordered.resultEvents = reordered.events.slice(firstResult, -1);
  }
  if (splitSecrets) {
    const secret = "sk-" + randomBytes(24).toString("hex");
    const signed = "https://fixture.invalid/result?X-Amz-Signature=PRIVATE_SIGNED_URL_SENTINEL&expires=1";
    const opaque = "PRIVATE_ENCRYPTED_TOOL_SENTINEL";
    const email = "fixture.person@example.invalid";
    const ssn = "123-45-6789", phone = "+1 202-555-0123";
    const unsafe = JSON.stringify({ count: "{{COUNTER}}", authorization: "Bearer " + secret, url: signed, email, ssn, phone, signature: opaque });
    const rawArguments = JSON.stringify({ path: "effect-invocations.jsonl", authorization: "Bearer " + secret, url: signed, email, ssn, phone, encrypted_content: opaque });
    scenario.expected.privateSentinels.push(secret, signed, "PRIVATE_SIGNED_URL_SENTINEL", opaque, email, ssn, phone);
    const call = scenario.beforeRelease.find(([event, data]) => event === "response.output_item.added" && data.item?.type === "function_call")[1].item;
    call.arguments = "";
    const deltas = Array.from(rawArguments).map(delta => ["response.function_call_arguments.delta", { item_id: call.id, call_id: call.call_id, delta }]);
    scenario.beforeRelease.splice(scenario.beforeRelease.length - 1, 0, ...deltas, ["response.function_call_arguments.done", { item_id: call.id, call_id: call.call_id, arguments: rawArguments }]);
    scenario.afterRelease[0][1].item.output[0].text = unsafe;
    report.providerUtf8SplitBoundaries = 0;
  }
  if (ringEviction) {
    const padding = "Large trace 🧙 café.\n".repeat(3000);
    scenario.beforeRelease.splice(5, 0, ...Array.from({ length: 12 }, () => ["response.output_text.delta", { delta: padding }]));
    scenario.expected.answer = "Inspecting 🧙 café.\n" + padding.repeat(12) + "Done: {{COUNTER}}";
    report.largeTrace = { chunks: 12, answerUtf8Bytes: Buffer.byteLength(scenario.expected.answer), ringLimitBytes: 512 * 1024 };
  }
  provider = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== "Bearer " + providerToken) {
        report.providerFailure = "provider-auth-mismatch";
        res.writeHead(403).end();
        return;
      }
      if (req.method === "GET" && req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "served-fixture-v3" }] }));
        return;
      }
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/responses");
      let requestBytes = 0;
      for await (const chunk of req) {
        requestBytes += chunk.length;
        assert.ok(requestBytes <= 1024 * 1024, "provider request exceeded fixture bound");
      }
      report.providerRequests++;
      assert.equal(report.providerRequests, 1, "no recovery may redispatch");
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const [event, data] of scenario.beforeRelease) {
        await frame(res, event, data);
      }
      await toolGate;
      deadline.signal.throwIfAborted();
      let effect;
      if (parallelCalls) {
        const invocations = await Promise.all(reordered.expected.tools.map(() => invokeChild(process.execPath, [toolFile, "--execute", projectRoot, "effect-invocations.jsonl"], { encoding: "utf8", timeout: 5e3 })));
        assert.ok(invocations.every(({ stdout }) => ["1", "2", "3"].includes(stdout)));
        assert.equal(await count(), 3);
        effect = "3";
        for (const [event, data] of reordered.resultEvents) {
          const rendered = structuredClone(data);
          const expected = reordered.expected.tools.find(tool => tool.id === rendered.item?.call_id);
          if (expected && rendered.item?.type === "function_call_output" && rendered.item.output[0].text === expected.output) rendered.item.output[0].text += ":" + effect;
          await frame(res, event, rendered);
        }
      } else {
        effect = execFileSync(process.execPath, [toolFile, "--execute", projectRoot, "effect-invocations.jsonl"], { encoding: "utf8", timeout: 5e3 });
        assert.equal(effect, "1");
        const output = scenario.afterRelease[0];
        await frame(res, output[0], JSON.parse(JSON.stringify(output[1]).replaceAll("{{COUNTER}}", effect)));
      }
      await finalGate;
      for (const [event, data] of scenario.afterRelease.slice(1)) await frame(res, event, JSON.parse(JSON.stringify(data).replaceAll("{{COUNTER}}", effect)));
      res.end();
    } catch (error) {
      report.providerFailure = { name: error.name, code: error.code ?? null };
      res.destroy();
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  Object.assign(process.env, { HERMES_API_URL: `http://127.0.0.1:${provider.address().port}`, HERMES_API_KEY: providerToken });
  const { saveConfig } = await imp("src/lib/cave-config.ts");
  const { createProject } = await imp("src/lib/cave-projects.ts");
  const { grantProjectToFamiliar } = await imp("src/lib/project-permissions.ts");
  const { selectQueueProject } = await imp("src/lib/queue-project-readiness.ts");
  await saveConfig({ familiars: { effectfixture: { harness: "hermes", model: "" } } });
  const project = await createProject({ name: "Controlled durable effect fixture", root: projectRoot });
  await grantProjectToFamiliar({ familiarId: "effectfixture", projectId: project.id, source: "human", access: "write" });
  await selectQueueProject(project.id);
  report.covenVersion = native(["--version"]).trim();
  daemon = true;
  native(["daemon", "start"]);
  report.daemonPid = JSON.parse(await readFile(path.join(covenHome, "daemon.json"), "utf8")).pid;
  caveInput = { port: await freePort(), caveHomeDir: caveHome, covenHomeDir: covenHome, adminToken, mobileAccessToken: mobileToken };
  cave = await startCave(caveInput);
  captureLogs(cave);
  const assertPublic = value => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    for (const sentinel of scenario.expected.privateSentinels) assert.ok(!text.includes(sentinel), "private provider sentinel escaped");
  };
  const runId = randomUUID();
  report.runId = runId;
  const headers = { "x-coven-cave-token": adminToken };
  const request = (url, init = {}) => fetch(cave.origin + url, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.any([deadline.signal, init.signal ?? AbortSignal.timeout(30_000)]) });
  const until = async (reader, predicate) => {
    let wire2 = "";
    const decoder = new TextDecoder();
    while (true) {
      const value = await reader.read();
      if (value.done) assert.fail("stream ended before checkpoint");
      wire2 += decoder.decode(value.value, { stream: true });
      assert.ok(wire2.length <= 1024 * 1024, "SSE fixture exceeded its bound");
      if (predicate(parse(wire2.slice(0, wire2.lastIndexOf("\n"))))) return wire2;
    }
  };
  report.stage = "initial-send";
  const sent = new AbortController();
  const response = await request("/api/chat/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familiarId: "effectfixture", sessionId: randomUUID(), runId, startNewConversation: true, projectRoot, permissionMode: "write", prompt: "Run the controlled isolated counter tool once." }), signal: sent.signal });
  assert.equal(response.status, 200);
  const initialWire = await until(response.body.getReader(), (e) => parallelCalls ? reordered.expected.tools.slice(0, 2).every(tool => e.some(x => x.kind === "tool_use" && x.id === tool.id && x.status === "running")) : e.some(x => x.kind === "tool_use" && x.status === "running"));
  assertPublic(initialWire);
  assert.equal(await count(), 0);
  sent.abort();
  report.checkpoints.push({ label: "transport drop before effect", counter: 0 });
  const tailController = new AbortController();
  const tail = await request("/api/chat/stream?runId=" + runId + "&cursor=0", { signal: tailController.signal });
  assert.equal(tail.status, 200);
  releaseTool();
  await until(tail.body.getReader(), (e) => parallelCalls ? reordered.expected.tools.slice(0, 2).every(tool => e.some(x => x.kind === "tool_use" && x.id === tool.id && x.status === "ok")) : e.some(x => x.kind === "tool_use" && x.status === "ok"));
  await expectedCount("effect after initial transport drop");
  tailController.abort();
  const final = await request("/api/chat/stream?runId=" + runId + "&cursor=0");
  assert.equal(final.status, 200);
  if (persistenceFailure) {
    blockedDirectory = path.join(caveHome, "conversations");
    await chmod(blockedDirectory, 0o500);
    report.injectedFault = "Own fixture conversation directory denies writes after the real effect.";
  }
  releaseFinal();
  const wire = await final.text();
  const events = parse(wire), done = events.findLast((e) => e.kind === "done");
  assertPublic(wire);
  report.stage = "terminal-persistence-state";
  if (persistenceFailure) {
    assert.ok(done?.isError, "unsaved terminal response must be marked error");
    assert.equal(done.persistedTurnId, undefined, "unsaved response cannot mint a persisted turn id");
    assert.ok(events.some(event => event.kind === "error" && event.code === "transcript_save_failed"));
    assert.ok(events.some(event => event.kind === "progress" && event.id === "save-transcript" && event.status === "error"));
    assert.equal(events.filter(event => event.kind === "assistant_chunk").map(event => event.text).join(""), "Inspecting 🧙 café.\nDone: 1");
    await chmod(blockedDirectory, 0o700);
    blockedDirectory = undefined;
    report.visiblePersistenceFailureVerified = true;
  } else {
    assert.ok(done?.persistedTurnId && !done.isError);
  }
  if (ringEviction) {
    assert.ok(events.some(event => event.kind === "progress" && event.id === "resume-gap"), "real production ring must report the evicted cursor gap");
    report.ringEvictionGapVerified = true;
  }
  if (splitSecrets) {
    const inputSnapshots = [...parse(initialWire), ...events].filter(event => event.kind === "tool_use" && typeof event.input === "string");
    const checkInputs = snapshots => {
      assert.ok(snapshots.length > 0, "complete argument snapshot must be present");
      for (const event of snapshots) assert.deepEqual(JSON.parse(event.input), { path: "effect-invocations.jsonl", authorization: "[redacted]", url: "[redacted signed URL]", email: "[redacted email]", ssn: "[redacted identifier]", phone: "[redacted phone]", encrypted_content: "[withheld provider state]" }, "no incomplete or unsafe argument delta may escape");
    };
    checkInputs(inputSnapshots);
    assert.throws(() => checkInputs([]));
    assert.throws(() => checkInputs([{ input: '{"authorization":"Bearer sk-partial' }]));
    assert.throws(() => checkInputs([{ input: JSON.stringify({ ...JSON.parse(inputSnapshots[0].input), authorization: "synthetic unredacted fixture" }) }]));
    report.inputSnapshotNegativeControls = { missingRejected: true, partialRejected: true, unsafeRejected: true };
    report.completeSafeInputSnapshots = inputSnapshots.length;
  }
  const terminalTool = events.findLast(event => event.kind === "tool_use" && event.id === scenario.expected.toolId && event.status === "ok");
  assert.ok(terminalTool?.activity?.runId, "live tool observation identity must exist");
  if (parallelCalls) {
    for (const expected of reordered.expected.tools) {
      const latest = events.findLast(event => event.kind === "tool_use" && event.id === expected.id);
      assert.equal(latest?.status, expected.status, "late progress must not reopen a settled call");
      assert.equal(latest.output, expected.output + ":3", "first terminal result must win under its call ID");
      assert.equal(latest.name, expected.name);
      assert.equal(latest.activity.authority.effect, "unavailable");
    }
  }
  report.transportRunId = runId;
  report.observationRunId = terminalTool.activity.runId;
  report.negativeReadCredentials = [];
  const refuseReadCredentials = async label => {
    for (const [surface, url] of [
      ["reconnect", "/api/chat/stream?runId=" + runId + "&cursor=0"],
      ["history", "/api/chat/conversation/" + done.sessionId],
      ["tool-output", "/api/chat/conversation/" + done.sessionId + "/tool-output?toolId=" + encodeURIComponent(scenario.expected.toolId)],
    ]) {
      for (const credential of ["", "invalid-fixture-credential"]) {
        const response = await request(url, { headers: { "x-coven-cave-token": credential, origin: cave.origin, "x-forwarded-for": "203.0.113.9" } });
        assert.ok([401, 403].includes(response.status), label + " " + surface + " must refuse missing/invalid forwarded credentials");
        const body = await response.text();
        assertPublic(body);
        for (const text of ["Run the controlled isolated counter tool once.", "Inspecting 🧙 café.", scenario.expected.toolName, ...scenario.expected.summaries]) assert.ok(!body.includes(text), "refused read leaked fixture content");
        report.negativeReadCredentials.push({ label, surface, credential: credential ? "invalid" : "missing", status: response.status });
      }
    }
  };
  await refuseReadCredentials("finished-ring-retained");
  let savedAssistant, savedUser;
  const assertHistory = value => {
    assertPublic(value);
    report.stage = 'history: assert.equal(value.conversation?.sessionId';
    assert.equal(value.conversation?.sessionId, done.sessionId);
    report.stage = 'history: assert.equal(value.conversation.harness';
    assert.equal(value.conversation.harness, scenario.expected.harness);
    if (persistenceFailure) {
      assert.equal(value.conversation.familiarId, "effectfixture");
      const user = value.conversation.turns.find(turn => turn.role === "user");
      assert.ok(user, "first user-turn stub must remain available");
      assert.equal(user.text, "Run the controlled isolated counter tool once.");
      assert.equal(value.conversation.turns.filter(turn => turn.role === "assistant").length, 0, "failed save cannot appear as a durable assistant response");
      if (savedUser) assert.deepEqual(user, savedUser, "recovered first user turn changed");
      else savedUser = structuredClone(user);
      return;
    }
    const assistant = value.conversation.turns.find(turn => turn.id === done.persistedTurnId);
    report.stage = 'history: assert.ok(assistant';
    assert.ok(assistant, "the exact persisted assistant turn must survive recovery");
    report.stage = 'history: assert.equal(assistant.role';
    assert.equal(assistant.role, "assistant");
    report.stage = 'history: assert.equal(assistant.text';
    assert.equal(assistant.text, scenario.expected.answer.replaceAll("{{COUNTER}}", String(scenario.expected.counter)));
    report.stage = 'history: assert.equal(assistant.isError';
    assert.equal(assistant.isError, false);
    const identity = assistant.responseMetadata?.runtimeIdentity;
    report.stage = 'history: assert.equal(identity?.harness';
    assert.equal(identity?.harness, scenario.expected.harness);
    report.stage = 'history: assert.equal(identity?.model';
    assert.equal(identity?.model, scenario.expected.model);
    report.stage = 'history: assert.equal(identity?.activity?.path';
    assert.equal(identity?.activity?.path, "api");
    report.stage = 'history: assert.deepEqual(assistant.reasoningBlocks?.map(block => block.text)';
    assert.deepEqual(assistant.reasoningBlocks?.map(block => block.text), scenario.expected.summaries);
    const tool = assistant.tools?.find(tool => tool.id === scenario.expected.toolId);
    report.stage = 'history: assert.ok(tool);';
    assert.ok(tool);
    report.stage = 'history: assert.equal(tool.name';
    assert.equal(tool.name, scenario.expected.toolName);
    report.stage = 'history: assert.equal(tool.status';
    assert.equal(tool.status, "ok");
    report.stage = 'history: assert.equal(tool.output';
    if (splitSecrets) {
      assert.deepEqual(JSON.parse(tool.output), { count: "1", authorization: "[redacted]", url: "[redacted signed URL]", email: "[redacted email]", ssn: "[redacted identifier]", phone: "[redacted phone]", signature: "[withheld provider state]" });
      assert.deepEqual(JSON.parse(tool.input), { path: "effect-invocations.jsonl", authorization: "[redacted]", url: "[redacted signed URL]", email: "[redacted email]", ssn: "[redacted identifier]", phone: "[redacted phone]", encrypted_content: "[withheld provider state]" });
    } else if (!parallelCalls) assert.equal(tool.output, String(scenario.expected.counter));
    if (parallelCalls) {
      assert.equal(assistant.tools.length, 3, "duplicate calls must not create extra cards");
      assert.deepEqual(new Set(assistant.tools.map(tool => tool.id)), new Set(reordered.expected.tools.map(tool => tool.id)));
      for (const expected of reordered.expected.tools) {
        const tool = assistant.tools.find(tool => tool.id === expected.id);
        const latest = events.findLast(event => event.kind === "tool_use" && event.id === expected.id);
        assert.equal(tool.name, expected.name);
        assert.equal(tool.status, expected.status);
        assert.equal(tool.output, expected.output + ":3");
        assert.deepEqual(tool.activity, latest.activity);
        assert.equal(tool.activity.authority.effect, "unavailable");
      }
      report.parallelCallChecks = { separateCards: 3, lateResultBeforeStartRetained: true, duplicateChangedResultIgnored: true, latestLiveTerminalPreserved: true, sharedFixture: reordered.id };
    }
    report.stage = 'history: assert.equal(tool.activity?.runId';
    assert.deepEqual(tool.activity, terminalTool.activity, "saved activity must match the live observation");
    assert.ok(assistant.reasoningBlocks.every(block => block.observation.runId === terminalTool.activity.runId));
    report.stage = 'history: assert.equal(tool.activity?.authority?.effect';
    assert.equal(tool.activity?.authority?.effect, "unavailable", "a synthetic report must not become protected-effect authority");
    if (savedAssistant) assert.deepEqual(assistant, savedAssistant, "recovered activity changed");
    else savedAssistant = structuredClone(assistant);
  };
  await expectedCount("transport drop after effect and final replay");
  for (let i = 0; i < 3; i++) {
    const replay = await request("/api/chat/stream?runId=" + runId + "&cursor=0");
    assert.equal(replay.status, 200);
    assert.deepEqual(parse(await replay.text()), events);
    const history2 = await request("/api/chat/conversation/" + done.sessionId);
    assert.equal(history2.status, 200);
    const value = await history2.json();
    assertHistory(value);
    if (i === 0 && !persistenceFailure) {
      assert.throws(() => assertHistory({ conversation: null }), "missing history must fail");
      const corrupted = structuredClone(value);
      corrupted.conversation.turns.find(turn => turn.id === done.persistedTurnId).text = "wrong answer";
      assert.throws(() => assertHistory(corrupted), "misprojected history must fail");
      report.historyNegativeControls = { missingConversationRejected: true, wrongAnswerRejected: true };
    }
    await expectedCount("repeat replay/history " + i);
  }
  if (includeExpiry) {
    report.stage = "finished-buffer-expiry";
    console.log(JSON.stringify({ phase: report.stage, waitMs: 13e4 }));
    await delay(130_000, undefined, { signal: deadline.signal });
    const expired = await request("/api/chat/stream?runId=" + runId + "&cursor=0");
    assert.equal(expired.status, 404);
    const history2 = await request("/api/chat/conversation/" + done.sessionId);
    assert.equal(history2.status, 200);
    assertHistory(await history2.json());
    await expectedCount("finished ring expired: authorized history readable");
    report.finishedBufferExpiryVerified = true;
  } else {
    report.finishedBufferExpiryVerified = false;
    report.omissions.push("Finished buffer expiration not run; use --include-expiry.");
  }
  const oldPid = cave.child.pid;
  await stopCave(cave, cave.port);
  cave = await startCave(caveInput);
  captureLogs(cave);
  assert.notEqual(cave.child.pid, oldPid);
  const unavailable = await request("/api/chat/stream?runId=" + runId + "&cursor=0");
  assert.equal(unavailable.status, 404);
  const history = await request("/api/chat/conversation/" + done.sessionId);
  assert.equal(history.status, 200);
  assertHistory(await history.json());
  await refuseReadCredentials("after-server-restart");
  await expectedCount("server restart: ring absent, authorized history readable");
  assert.equal(report.providerFailure, void 0);
  if (splitSecrets) {
    const lazy = await request("/api/chat/conversation/" + done.sessionId + "/tool-output?toolId=" + scenario.expected.toolId);
    assert.equal(lazy.status, 200);
    const lazyValue = await lazy.json(); assertPublic(lazyValue);
    assert.equal(lazyValue.output, savedAssistant.tools.find(tool => tool.id === scenario.expected.toolId).output);
    const stored = await readFile(path.join(caveHome, "conversations", done.sessionId + ".json"), "utf8");
    assertPublic(stored);
    assert.equal(serverLogOverflow, false, "fixture logs exceeded bound");
    assertPublic(serverLogs);
    let daemonLogBytes = 0;
    for (const name of ["daemon.log", "daemon.stderr.log", "daemon.stdout.log"]) {
      try { const bytes = await readFile(path.join(covenHome, name), "utf8"); assert.ok(Buffer.byteLength(bytes) <= 1024 * 1024); assertPublic(bytes); daemonLogBytes += Buffer.byteLength(bytes); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    report.disclosureSurfaces = { providerWriteChunkBytes: 7, providerUtf8SplitBoundaries: report.providerUtf8SplitBoundaries, argumentDeltaCharacters: 1, liveReplayAndHistoryChecked: true, lazyOutputChecked: true, rawPersistedConversationChecked: true, serverLogBytesChecked: Buffer.byteLength(serverLogs), knownDaemonLogBytesChecked: daemonLogBytes, rawPayloadRetained: false };
    assert.ok(report.providerUtf8SplitBoundaries > 0, "provider writes must split a Unicode code point");
  }
  const invocationLedger = await readFile(ledger, "utf8");
  const invocationIds = invocationLedger.trim().split("\n").map(line => JSON.parse(line).invocationId);
  assert.equal(new Set(invocationIds).size, parallelCalls ? 3 : 1, "each durable effect must have a distinct invocation ID");
  report.uniqueDurableInvocationIds = new Set(invocationIds).size;
  await writeFile(path.join(evidence, "durable-invocations.jsonl"), invocationLedger);
  const negative = "negative-control-invocations.jsonl";
  await writeFile(path.join(projectRoot, negative), "", { flag: "wx", mode: 0o600 });
  assert.equal(execFileSync(process.execPath, [toolFile, "--execute", projectRoot, negative], { encoding: "utf8" }), "1");
  const repeated = execFileSync(process.execPath, [toolFile, "--execute", projectRoot, negative], { encoding: "utf8" });
  assert.equal(repeated, "2");
  assert.throws(() => assert.equal(Number(repeated), 1));
  report.negativeControl = { secondRealInvocationDetected: true, counter: 2 };
  await expectedCount("final qualification counter after independent negative control");
  assert.deepEqual(await sourceHashes(), report.sourceHashes, "qualification sources changed while running");
  report.privateSentinelsAbsentFromRecoveryAndHistory = true;
  report.exactPersistedAssistantAndActivityRecovered = !persistenceFailure;
  if (persistenceFailure) report.originalAssistantNotDurablySaved = true;
  report.passed = true;
} catch (error) {
  report.failure = { stage: report.stage ?? "setup-or-http", name: error.name, code: error.code ?? null };
  process.exitCode = 1;
} finally {
  if (blockedDirectory) {
    try {
      await chmod(blockedDirectory, 0o700);
      report.fixturePermissionsRestored = true;
    } catch {
      report.fixturePermissionsRestored = false;
      report.passed = false;
      process.exitCode = 1;
    }
  } else if (persistenceFailure && report.visiblePersistenceFailureVerified) {
    report.fixturePermissionsRestored = true;
  }
  clearTimeout(deadlineTimer);
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onInterrupt);
  deadline.abort(new Error("qualification cleanup"));
  releaseTool();
  releaseFinal();
  if (cave) {
    try {
      await stopCave(cave, cave.port);
      report.serverStopped = true;
    } catch {
      report.serverStopped = false;
      process.exitCode = 1;
    }
  }
  if (provider) {
    provider.closeAllConnections();
    await new Promise((r) => provider.close(r));
  }
  if (daemon) {
    try {
      native(["daemon", "stop"]);
      report.daemonStopped = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          process.kill(report.daemonPid, 0);
        } catch (e) {
          if (e.code !== "ESRCH") throw e;
          report.daemonStopped = true;
          break;
        }
        await delay(100);
      }
    } catch {
      report.daemonStopped = false;
    }
  }
  if (report.serverStopped && report.daemonStopped) {
    await rm(root, { recursive: true, force: true });
    report.fixtureRootRemoved = true;
  } else {
    report.preservedRoot = root;
    report.passed = false;
    process.exitCode = 1;
  }
  report.finishedAt = (new Date()).toISOString();
  await writeFile(path.join(evidence, "result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
