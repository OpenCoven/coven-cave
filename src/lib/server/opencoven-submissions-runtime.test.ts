// @ts-nocheck
// The implementation behind the host (#6400), against an isolated home.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const home = await mkdtemp(path.join(os.tmpdir(), "submissions-runtime-"));
process.env.COVEN_HOME = home;
const { handleSubmissionsRequest, submissionsContractVersion } = await import("./opencoven-submissions-runtime.ts");
const { submissionsStorePath } = await import("./opencoven-submissions-retained.ts");

test.after(() => rm(home, { recursive: true, force: true }));

const runtimePackage = (version = "1.2.0") => ({
  manifest: {
    name: "Local Coven Runtime",
    version,
    description: "Runs OpenCoven workloads on the local machine.",
    type: "runtime",
    capabilities: ["shell.exec", "filesystem.read", "events.stream"],
    requiredServices: ["coven-daemon"],
    permissions: { env: ["OPENAI_API_KEY"], config: ["cwd"], filesystem: ["read", "write"] },
    entrypoints: { invoke: "bin/coven-runtime", health: "bin/coven-runtime health" },
    runtime: {
      id: "local-coven",
      invocation: "stdio",
      protocols: ["opencoven.runtime.v1"],
      capabilities: ["shell.exec", "filesystem.read", "events.stream"],
      config: { env: ["OPENAI_API_KEY"] },
      healthCheck: { command: "bin/coven-runtime health" },
      sandbox: { network: "restricted", filesystem: "workspace" },
    },
    artifacts: ["bin/coven-runtime"],
    examples: [{ name: "smoke", path: "examples/smoke.json" }],
    docs: ["docs/runtime.md"],
  },
  artifacts: ["manifest.json", "bin/coven-runtime", "examples/smoke.json"],
  files: {
    "bin/coven-runtime": { size: 128, sha256: "a".repeat(64) },
    "examples/smoke.json": JSON.stringify({ prompt: "hello" }),
  },
});

const post = (route, body) => handleSubmissionsRequest(route, new Request(`http://cave.test/api/opencoven/${route}`, {
  method: "POST",
  body: typeof body === "string" ? body : JSON.stringify(body),
}));
const saved = async () => JSON.parse(await readFile(submissionsStorePath(), "utf8")).submissions;

test("the implementation states the contract the host supports", () => {
  assert.equal(submissionsContractVersion, 1);
});

test("malformed requests are refused without writing", async () => {
  assert.equal((await post("submissions", "{not json")).status, 400);
  assert.equal((await post("submissions", {})).status, 400);
  assert.equal((await post("executions", "{not json")).status, 400);
  assert.equal((await post("executions", {})).status, 400);
  await assert.rejects(readFile(submissionsStorePath(), "utf8"), { code: "ENOENT" });
});

test("other methods are refused", async () => {
  const response = await handleSubmissionsRequest("submissions", new Request("http://cave.test/x", { method: "PUT" }));
  assert.equal(response.status, 405);
});

test("a validate-only request writes nothing", async () => {
  const response = await post("submissions", { package: runtimePackage(), publish: false });
  assert.equal((await response.json()).published, false);
  await assert.rejects(readFile(submissionsStorePath(), "utf8"), { code: "ENOENT" });
});

test("replaying a publish after a lost response leaves one entry", async () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await post("submissions", { package: runtimePackage(), publish: true });
    assert.equal((await response.json()).published, true);
  }
  assert.equal((await saved()).length, 1);
});

test("concurrent publishes don't lose one another's entry", async () => {
  const versions = ["2.0.0", "2.0.1", "2.0.2", "2.0.3", "2.0.4", "2.0.5"];
  await Promise.all(versions.map((version) => post("submissions", { package: runtimePackage(version), publish: true })));
  const stored = (await saved()).map((item) => item.version);
  for (const version of versions) assert.ok(stored.includes(version), `${version} survived`);
});


test("an execution request only returns a plan", async () => {
  const before = await readFile(submissionsStorePath(), "utf8");
  const response = await post("executions", { harnessId: "unknown" });
  const body = await response.json();
  assert.equal(body.executionService, null);
  assert.ok(body.plan);
  assert.equal(await readFile(submissionsStorePath(), "utf8"), before);
});
