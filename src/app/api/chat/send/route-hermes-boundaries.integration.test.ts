// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";

// #5763 criterion 7 for Hermes, through the real send route: the Responses API
// and direct CLI paths keep their authorization and endpoint boundaries, and
// the SSH relay never borrows the local API configuration. The sibling
// harness-routing-tool-events.test.ts only regex-matches route.ts for these
// (redirect: "error", read-only 501, endpoint never in progress text).
// Every upstream here is a local fixture; no provider turn is made.
const root = path.join(process.cwd(), ".flow-validation-tmp", `hermes-boundaries-${process.pid}`);
const bin = path.join(root, "Library", "pnpm");
const workspace = path.join(root, "workspace");
const executablePath = (name: string) => path.join(bin, process.platform === "win32" ? `${name}.cmd` : name);
await mkdir(bin, { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(path.join(root, "package.json"), '{"type":"commonjs"}');
const previousEnv = { ...process.env };
const ordinaryLogs: string[] = [];
const consoleMethods = ["log", "warn", "error", "info", "debug"] as const;
const originalConsole = Object.fromEntries(consoleMethods.map((method) => [method, console[method]]));
for (const method of consoleMethods) console[method] = (...values) => {
  ordinaryLogs.push(values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" "));
};
process.env.COVEN_HOME = root;
process.env.COVEN_CAVE_HOME = path.join(root, "cave");
process.env.HOME = root;
if (process.platform === "win32") {
  process.env.USERPROFILE = root;
  delete process.env.Path;
}
process.env.SHELL = path.join(root, "missing-shell");
process.env.PATH = `${bin}${path.delimiter}${path.dirname(process.execPath)}`;
process.env.COVEN_BIN = executablePath("coven");
process.env.HERMES_BIN = executablePath("hermes");
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;
delete process.env.COVEN_SOCKET;
const callsPath = path.join(root, "calls.jsonl");
for (const name of ["coven", "hermes", "ssh"]) {
  const fixture = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
const name = ${JSON.stringify(name)};
if (args.includes("--version")) { console.log("1.0.0"); process.exit(0); }
if (args.includes("--help")) { console.log("--model --add-dir --permission"); process.exit(0); }
if (name === "coven" && args[0] !== "run") { console.log("[]"); process.exit(0); }
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ name, args }) + "\\n");
if (name === "hermes") {
  console.error("session_id: fixture-native-session");
  console.log("CLI fixture answer");
} else {
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "fixture-native-session" }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Relay fixture answer" }] }, session_id: "fixture-native-session" }));
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "fixture-native-session" }));
}
`;
  if (process.platform === "win32") {
    await writeFile(path.join(bin, `${name}.cjs`), fixture);
    await writeFile(executablePath(name), `"node" "%~dp0\\${name}.cjs" %*\r\n`);
  } else {
    await writeFile(executablePath(name), fixture, { mode: 0o755 });
  }
}

// Two local servers: a "redirector" that answers every request with a 302 to
// the "target", and a target that would happily stream a success. A correct
// route never reaches the target and never reveals either address.
const apiKey = "local-fixture-key-PRIVATE_BEARER_SENTINEL";
let targetRequests = 0;
let redirectRequests = 0;
const target = createServer((req, res) => {
  targetRequests += 1;
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end('event: response.output_text.delta\ndata: {"delta":"REDIRECTED_TARGET_ANSWER"}\n\n' +
    'event: response.completed\ndata: {"response":{"id":"resp-redirected"}}\n\n');
});
await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
const targetPort = (target.address() as { port: number }).port;
const redirector = createServer((req, res) => {
  redirectRequests += 1;
  res.writeHead(302, { location: `http://127.0.0.1:${targetPort}${req.url}` });
  res.end();
});
await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve));
const redirectPort = (redirector.address() as { port: number }).port;

const { refreshCovenBin, refreshCovenSpawnEnv } = await import("@/lib/coven-bin");
refreshCovenBin();
refreshCovenSpawnEnv();
const { POST } = await import("./route.ts");
const { saveConfig } = await import("@/lib/cave-config");
const { createProject } = await import("@/lib/cave-projects");
const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
const { loadConversation } = await import("@/lib/cave-conversations");

const familiars = {
  herm: { harness: "hermes", model: "" },
  remoteHerm: { harness: "hermes", model: "", runtime: { kind: "ssh", host: "fixture-host", cwd: "/remote/project", command: "coven" } },
};
await saveConfig({ familiars });
const project = await createProject({ name: "Hermes boundaries", root: workspace });
for (const familiarId of Object.keys(familiars)) {
  await grantProjectToFamiliar({ familiarId, projectId: project.id, source: "human", access: "write" });
}
const calls = async () => {
  try {
    return (await readFile(callsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) as Array<{ name: string; args: string[] }>;
  } catch {
    return [];
  }
};
const send = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/chat/send", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ projectRoot: workspace, prompt: "Describe the fixture", ...body }),
}));
const sse = (text: string) => text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
const useApi = (url: string | null) => {
  if (url) {
    process.env.HERMES_API_URL = url;
    process.env.HERMES_API_KEY = apiKey;
  } else {
    delete process.env.HERMES_API_URL;
    delete process.env.HERMES_API_KEY;
  }
  refreshCovenSpawnEnv();
};
const secretPattern = new RegExp(`PRIVATE_BEARER_SENTINEL|127\\.0\\.0\\.1:${redirectPort}|127\\.0\\.0\\.1:${targetPort}|REDIRECTED_TARGET_ANSWER`);

test.after(async () => {
  for (const method of consoleMethods) console[method] = originalConsole[method];
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  await new Promise<void>((resolve) => redirector.close(() => resolve()));
  await new Promise<void>((resolve) => target.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

test("read-only with a configured Responses endpoint is refused with 501 before any request", async () => {
  useApi(`http://127.0.0.1:${redirectPort}`);
  const before = redirectRequests;
  const response = await send({ familiarId: "herm", permissionMode: "read" });
  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /Hermes does not support Cave's Read-only mode yet/);
  assert.equal(redirectRequests, before, "no provider request leaves Cave for a refused turn");
  assert.equal(targetRequests, 0);
});

test("read-only on the direct CLI is refused with 501 before the hermes process starts", async () => {
  useApi(null);
  const before = (await calls()).length;
  const response = await send({ familiarId: "herm", permissionMode: "read" });
  assert.equal(response.status, 501);
  assert.match((await response.json()).error, /Hermes does not support Cave's Read-only mode yet/);
  assert.equal((await calls()).length, before);
});

test("a redirecting Responses endpoint fails the turn without following the redirect or disclosing the endpoint", async () => {
  useApi(`http://127.0.0.1:${redirectPort}`);
  ordinaryLogs.length = 0;
  const redirectsBefore = redirectRequests;
  const response = await send({ familiarId: "herm" });
  assert.equal(response.status, 200, await response.clone().text());
  const text = await response.text();
  const events = sse(text);
  const done = events.findLast((event) => event.kind === "done");
  assert.ok(done);
  assert.equal(done.isError, true, "a redirect is a failed attempt, not a completed response");
  assert.equal(redirectRequests, redirectsBefore + 1, "exactly one request reaches the configured endpoint");
  assert.equal(targetRequests, 0, "the redirect target is never contacted");
  const chunks = events.filter((event) => event.kind === "assistant_chunk").map((event) => event.text);
  assert.ok(chunks.length >= 1 && chunks.every((chunk) => /errored in \d+ms and returned no text/.test(chunk) && /withheld/.test(chunk)),
    "the only assistant text is the existing withheld-diagnostic notice; no answer is fabricated");
  const starts = events.filter((event) => event.kind === "progress" && event.id === "harness-start");
  assert.ok(starts.some((event) => event.status === "error"), "the failed attempt is reported as an error, not left running");
  assert.doesNotMatch(text, secretPattern, "neither the bearer key nor either endpoint reaches the stream");
  assert.doesNotMatch(ordinaryLogs.join("\n"), secretPattern, "ordinary logs do not disclose the endpoint or key");
  assert.deepEqual(done.responseMetadata?.runtimeIdentity?.activity, { schemaVersion: 1, path: "api", tools: "supported", reasoning: "supported" },
    "the selected adapter is still the API adapter; the failure does not rewrite the capability claim");
  if (done.sessionId) {
    const saved = await loadConversation(done.sessionId);
    assert.doesNotMatch(JSON.stringify(saved ?? {}), secretPattern, "persisted history does not disclose the endpoint or key");
  }
});

test("Hermes over SSH ignores the local Responses configuration and reports every detail unverified", { skip: process.platform === "win32" }, async () => {
  useApi(`http://127.0.0.1:${redirectPort}`);
  const redirectsBefore = redirectRequests;
  const before = (await calls()).length;
  const response = await send({ familiarId: "remoteHerm" });
  assert.equal(response.status, 200, await response.clone().text());
  const text = await response.text();
  const events = sse(text);
  const done = events.findLast((event) => event.kind === "done");
  assert.ok(done);
  assert.notEqual(done.isError, true, text);
  assert.deepEqual(done.responseMetadata?.runtimeIdentity?.activity, { schemaVersion: 1, path: "ssh", tools: "unknown", reasoning: "unknown" });
  assert.equal(done.responseMetadata?.runtime, "ssh:fixture-host:/remote/project");
  assert.equal(redirectRequests, redirectsBefore, "the local API endpoint is not used for a remote familiar");
  const launched = (await calls()).slice(before);
  assert.deepEqual(launched.map((call) => call.name), ["ssh"], "only the ssh transport runs; no local hermes process");
  assert.ok(launched[0].args.some((arg) => typeof arg === "string" && arg.includes("coven")), "the remote command is Coven's relay");
  assert.doesNotMatch(JSON.stringify(launched), /PRIVATE_BEARER_SENTINEL/, "the local bearer key is not forwarded in the ssh argv");
  assert.doesNotMatch(text, secretPattern);
});
