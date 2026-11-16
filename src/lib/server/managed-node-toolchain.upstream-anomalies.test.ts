// The managed Node toolchain download under every upstream anomaly (#6359).
//
// `installManagedNodeToolchain` is driven end to end with hermetic stubs for
// everything after the download — the digest, the archive extraction and
// the readiness probe follow the module's own test next door — so the only
// live phase is the fetch from nodejs.org through the harness. The matrix
// proves every anomaly lands as `download_failed` with the staging and
// install directories clean, and that a retry once nodejs.org heals installs.
//
// One honesty note: the installer also checks the response's final URL
// against the official source. A harness-made Response has no URL, so a 200
// anomaly (a torn, empty or drifted body) fails that guard first; the
// explicit test at the end serves the same bodies with the URL set and shows
// them reaching the integrity check instead.
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MANAGED_NODE_VERSION, nodeArchiveFor } from "../onboarding-prerequisites.ts";
import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../testing/upstream-anomaly-matrix.ts";
import { installManagedNodeToolchain, managedNodePaths, type ManagedNodeInstallResult } from "./managed-node-toolchain.ts";

const TEST_ENV = { NODE_ENV: "test" } satisfies NodeJS.ProcessEnv;
const ARCHIVE_BODY = "managed-node-test-archive";
const maybeArtifact = nodeArchiveFor("linux", "x64");
if (!maybeArtifact) throw new Error("no linux/x64 node archive in the prerequisites registry");
const artifact = maybeArtifact;
assert.ok(artifact);

const harness = installUpstreamAnomalyFetch({ install: false });
let home = await mkdtemp(path.join(tmpdir(), "managed-node-anomalies-"));
test.after(async () => {
  harness.restore();
  await rm(home, { recursive: true, force: true });
});

function officialResponse(body: string): Response {
  const response = new Response(body, { status: 200, headers: { "content-length": String(Buffer.byteLength(body)) } });
  Object.defineProperty(response, "url", { value: artifact.url });
  return response;
}

harness.healthy("nodejs-dist", (request) => {
  assert.equal(request.url, artifact.url, "only the reviewed artifact URL is ever requested");
  return officialResponse(ARCHIVE_BODY);
});

async function freshHome(): Promise<void> {
  await rm(home, { recursive: true, force: true });
  home = await mkdtemp(path.join(tmpdir(), "managed-node-anomalies-"));
}

type Outcome = { result: ManagedNodeInstallResult; installed: boolean; staging: string[]; temporaries: string[] };

async function install(): Promise<Outcome> {
  const paths = managedNodePaths("linux", "x64", TEST_ENV, home);
  assert.ok(paths);
  let probes = 0;
  const result = await installManagedNodeToolchain({
    platform: "linux",
    architecture: "x64",
    env: TEST_ENV,
    home,
    fetch: harness.fetch,
    dependencies: {
      digest: () => artifact.sha256,
      extractArchive: async (_format, archive, destination) => {
        assert.equal(archive.toString("utf8"), ARCHIVE_BODY, "the extracted bytes are the downloaded bytes");
        const runtime = path.join(destination, `node-v${MANAGED_NODE_VERSION}-linux-x64`);
        await mkdir(runtime, { recursive: true });
        await writeFile(path.join(runtime, "reviewed-runtime"), "ready");
      },
      probe: async () => {
        probes += 1;
        return probes === 1 ? { status: "missing", paths } : { status: "ready", version: MANAGED_NODE_VERSION, paths };
      },
    },
  });
  const installed = await readFile(path.join(paths.installDir, "reviewed-runtime"), "utf8").then((text) => text === "ready", () => false);
  const staging = await readdir(paths.stagingRoot).catch(() => [] as string[]);
  const temporaries = (await readdir(path.dirname(paths.installDir)).catch(() => [] as string[])).filter((name) => name.includes(".tmp-"));
  return { result, installed, staging, temporaries };
}

const installs = (outcome: MatrixOutcome) => {
  const { result, installed, staging, temporaries } = outcome.value as Outcome;
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) assert.equal(result.outcome, "installed");
  assert.equal(installed, true);
  assert.deepEqual(staging, [], "the staging directory is removed after a publish");
  assert.deepEqual(temporaries, []);
};

const downloadFailedCleanly = (outcome: MatrixOutcome) => {
  const { result, installed, staging, temporaries } = outcome.value as Outcome;
  assert.equal(result.ok, false, "a download anomaly never reports an install");
  if (!result.ok) {
    assert.equal(result.failure, "download_failed");
    assert.equal(typeof result.detail, "string");
  }
  assert.equal(installed, false, "no partial toolchain is left behind");
  assert.deepEqual(staging, [], "the staging directory is removed on failure");
  assert.deepEqual(temporaries, [], "no .tmp- runtime is left beside the install directory");
};

test("installManagedNodeToolchain (download phase) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "nodejs-dist",
    beforeEach: freshHome,
    invoke: install,
    healthy: installs,
    degraded: {
      default: downloadFailedCleanly,
      network: (outcome) => {
        downloadFailedCleanly(outcome);
        const { result } = outcome.value as Outcome;
        if (!result.ok) assert.match(result.detail, /fetch failed/);
      },
      "http-500": (outcome) => {
        downloadFailedCleanly(outcome);
        const { result } = outcome.value as Outcome;
        if (!result.ok) assert.match(result.detail, /approved official source/, "a non-2xx fails the official-source guard");
      },
    },
  });
});

test("a 200 that is not the archive, served from the official URL, fails the integrity check and leaves nothing", async () => {
  for (const body of ['{"data":[{"id":1,"name":"trunc', "", JSON.stringify({ unexpected: true })]) {
    await freshHome();
    harness.healthy("nodejs-dist", () => officialResponse(body));
    harness.reset();
    const paths = managedNodePaths("linux", "x64", TEST_ENV, home);
    assert.ok(paths);
    // The real digest this time: a wrong body must not match the reviewed manifest.
    const result = await installManagedNodeToolchain({
      platform: "linux",
      architecture: "x64",
      env: TEST_ENV,
      home,
      fetch: harness.fetch,
      dependencies: { probe: async () => ({ status: "missing", paths }) },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure, "integrity_check_failed");
    await assert.rejects(access(paths.installDir));
    assert.deepEqual(await readdir(paths.stagingRoot).catch(() => []), []);
    assert.equal(harness.calls("nodejs-dist").length, 1);
  }
  harness.healthy("nodejs-dist", () => officialResponse(ARCHIVE_BODY));
});

test("a retry after nodejs.org heals installs from a clean slate", async () => {
  await freshHome();
  harness.inject("nodejs-dist", { kind: "timeout" });
  downloadFailedCleanly(await outcomeOf(install()));
  harness.heal("nodejs-dist");
  harness.reset();
  installs(await outcomeOf(install()));
  assert.equal(harness.calls("nodejs-dist").length, 1, "the retry reached nodejs.org");
});

test("the download carries the installer's own deadline", () => {
  for (const call of harness.calls("nodejs-dist")) assert.equal(call.hasDeadline, true);
});

async function outcomeOf(pending: Promise<Outcome>): Promise<MatrixOutcome> {
  const value = await pending;
  return { value, response: null, status: null, text: JSON.stringify(value), body: value, threw: undefined };
}
