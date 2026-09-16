import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  COVEN_MAINTENANCE_MINIMUM_VERSION,
  COVEN_OWNER_LEASE_MS,
  createCovenMaintenanceClient,
  createRepositoryMaintenanceCoordinator,
  MAX_FENCED_MUTATION_TIMEOUT_MS,
  repositoryMaintenanceCapabilities,
  supportsCovenMaintenanceVersion,
} from "./maintenance-gate.mjs";

assert.ok(
  MAX_FENCED_MUTATION_TIMEOUT_MS < COVEN_OWNER_LEASE_MS,
  "blocking fenced mutations must time out before Coven can admit another writer",
);

const repoDir = "/checked-out/project";

function status(owner, writers = []) {
  return JSON.stringify({ owner, writers });
}

function covenFixture({
  writers = [],
  malformed = false,
  unavailable = false,
  releaseFails = false,
  version = COVEN_MAINTENANCE_MINIMUM_VERSION,
  // What `defaultRunCoven` reports as the argv it actually executed.
  binary = "/fixture/bin/coven",
} = {}) {
  const calls = [];
  let owner = null;
  let generation = 0;
  const run = ({ args, cwd }) => {
    calls.push({ args, cwd });
    if (unavailable) return { ok: false, stdout: "", stderr: "", status: null };
    if (args[0] === "--version") {
      return { ok: true, stdout: `coven ${version}\n`, stderr: "", status: 0, binary };
    }
    const command = args[1];
    if (command === "acquire") {
      generation += 1;
      owner = {
        owner_id: args[2],
        generation: `generation-${generation}`,
        expires_at: Math.floor(Date.now() / 1_000) + 120,
        phase: writers.length === 0 ? "held" : "draining",
      };
      return {
        ok: true,
        stdout: malformed ? "{not-json" : status(owner, writers),
        stderr: "",
        status: 0,
      };
    }
    if (command === "heartbeat") {
      if (!owner || owner.owner_id !== args[2] || owner.generation !== args[3]) {
        return { ok: false, stdout: "", stderr: "not owner", status: 1 };
      }
      owner = { ...owner, expires_at: Math.floor(Date.now() / 1_000) + 120 };
      return { ok: true, stdout: status(owner, writers), stderr: "", status: 0 };
    }
    if (command === "release") {
      if (releaseFails) return { ok: false, stdout: "", stderr: "release failed", status: 1 };
      if (!owner || owner.owner_id !== args[2] || owner.generation !== args[3]) {
        return { ok: false, stdout: "", stderr: "not owner", status: 1 };
      }
      owner = null;
      return { ok: true, stdout: "released\n", stderr: "", status: 0 };
    }
    if (command === "status") {
      return { ok: true, stdout: status(owner, writers), stderr: "", status: 0 };
    }
    assert.fail(`unexpected Coven command: ${args.join(" ")}`);
  };
  return {
    calls,
    run,
    owner: () => owner,
  };
}

test("Coven client holds, heartbeats, verifies, and releases its exact fence", () => {
  const fixture = covenFixture();
  const client = createCovenMaintenanceClient({ run: fixture.run });
  const acquired = client.acquire({ ownerId: "cave-maintenance", repoDir, waitMs: 0 });
  assert.equal(acquired.ok, true);
  assert.deepEqual(client.verify(acquired.handle), { ok: true });
  assert.deepEqual(client.heartbeat(acquired.handle), { ok: true });
  assert.deepEqual(client.release(acquired.handle), { ok: true });
  assert.equal(fixture.owner(), null);
  assert.deepEqual(
    fixture.calls.map((call) => call.args.slice(0, 2)),
    [
      ["--version"],
      ["maintenance", "acquire"],
      ["--version"],
      ["maintenance", "status"],
      ["--version"],
      ["maintenance", "heartbeat"],
      ["maintenance", "release"],
    ],
  );
});

test("Coven client drains rather than proceeding, then releases its own incomplete fence", () => {
  const fixture = covenFixture({
    writers: [{ id: "daemon-session", kind: "session", generation: "writer", expires_at: 9_999_999_999 }],
  });
  const client = createCovenMaintenanceClient({ run: fixture.run });
  const acquired = client.acquire({ ownerId: "cave-maintenance", repoDir, waitMs: 0 });
  assert.deepEqual(acquired, { ok: false, reason: "coven-still-draining" });
  assert.equal(fixture.owner(), null, "a non-held drain must not strand the Coven owner");
  assert.equal(
    fixture.calls.filter((call) => call.args[1] === "release").length,
    1,
    "the incomplete acquisition releases the exact generation it created",
  );
});

test("Coven client fails closed for malformed or unavailable CLI responses", () => {
  const malformed = createCovenMaintenanceClient({ run: covenFixture({ malformed: true }).run });
  assert.deepEqual(
    malformed.acquire({ ownerId: "cave-maintenance", repoDir }),
    { ok: false, reason: "coven-acquire-output-malformed" },
  );

  const unavailable = createCovenMaintenanceClient({ run: covenFixture({ unavailable: true }).run });
  assert.deepEqual(
    unavailable.acquire({ ownerId: "cave-maintenance", repoDir }),
    { ok: false, reason: "coven-version-unavailable" },
  );
});

test("a command that never ran is reported as such, not as an unavailable version", () => {
  // cave-a8uza. A spawn that timed out used to arrive at commandFailure with no
  // stderr and be reported as a bare `coven-version-unavailable` — a message
  // about the CLI's VERSION for a failure that was a timeout, and one that
  // reads exactly like the deterministic "too old" refusal. A session spent
  // ~40 minutes auditing three coven installs because of it. These two cases
  // must stay distinguishable.
  const timedOut = createCovenMaintenanceClient({
    run: () => ({
      ok: false,
      stdout: "",
      stderr: "",
      status: null,
      binary: "/usr/local/bin/coven",
      spawnFailure: {
        kind: "timeout",
        code: "ETIMEDOUT",
        timeoutMs: 35_000,
        elapsedMs: 35_004,
        binary: "/usr/local/bin/coven",
      },
    }),
  });
  const result = timedOut.acquire({ ownerId: "cave-maintenance", repoDir });
  assert.equal(result.ok, false);
  assert.match(
    result.reason,
    /^coven-version-did-not-run: /,
    "a spawn that never produced output must not be reported as a version verdict",
  );
  assert.match(result.reason, /timed out after 35000ms/, "says what actually happened");
  assert.match(result.reason, /transient — retry/, "says the remedy, unlike the version refusal");
  assert.match(result.reason, /\/usr\/local\/bin\/coven/, "names the binary it tried");
  assert.doesNotMatch(
    result.reason,
    /unavailable/,
    "must not reuse the vocabulary of a genuine version failure",
  );
});

test("a command that RAN and failed still reports the version vocabulary", () => {
  // The other side of the same contract: a real non-zero exit with stderr is a
  // version verdict and must keep saying so, or the fix above would just move
  // the ambiguity rather than remove it.
  const ranAndFailed = createCovenMaintenanceClient({
    run: () => ({
      ok: false,
      stdout: "",
      stderr: "coven: unknown subcommand 'owner'\n",
      status: 2,
      binary: "/usr/local/bin/coven",
    }),
  });
  const result = ranAndFailed.acquire({ ownerId: "cave-maintenance", repoDir });
  assert.equal(result.ok, false);
  assert.match(result.reason, /^coven-version-unavailable: /);
  assert.match(result.reason, /unknown subcommand/, "keeps the client's own first stderr line");
  assert.doesNotMatch(result.reason, /did-not-run/);
});

test("Coven client rejects maintenance protocols below the reviewed release", () => {
  assert.equal(supportsCovenMaintenanceVersion("coven 0.2.5"), true);
  assert.equal(supportsCovenMaintenanceVersion("coven v0.3.0"), true);
  assert.equal(supportsCovenMaintenanceVersion("coven 0.2.5-beta.1"), false);
  assert.equal(supportsCovenMaintenanceVersion("coven 0.2.4-recovery.1"), false);
  assert.equal(supportsCovenMaintenanceVersion("unknown"), false);

  const client = createCovenMaintenanceClient({
    run: covenFixture({ version: "0.2.4-recovery.1", binary: "/opt/stale/coven" }).run,
  });
  assert.deepEqual(
    client.acquire({ ownerId: "cave-maintenance", repoDir, waitMs: 0 }),
    {
      ok: false,
      reason: "coven-version-unsupported",
      version: "0.2.4-recovery.1",
      // A version refusal is usually the WRONG binary, not a missing one, so
      // the refusal has to say which install it judged, what that install
      // reported (raw, not only parsed — the bead that opened this could not
      // say what stdout held), and the floor it failed (cave-6bb4m).
      covenVersion: "0.2.4-recovery.1",
      covenBinary: "/opt/stale/coven",
      covenVersionOutput: "coven 0.2.4-recovery.1",
      covenMinimumVersion: COVEN_MAINTENANCE_MINIMUM_VERSION,
    },
  );

  // Unparseable output is the sibling failure and had no detail at all.
  const malformedVersion = createCovenMaintenanceClient({
    run: () => ({ ok: true, stdout: "not a version\n", stderr: "", status: 0, binary: "/opt/odd/coven" }),
  }).version(repoDir);
  assert.equal(malformedVersion.reason, "coven-version-malformed");
  assert.equal(malformedVersion.covenBinary, "/opt/odd/coven");
  assert.equal(malformedVersion.covenVersionOutput, "not a version");
  assert.equal(malformedVersion.covenMinimumVersion, COVEN_MAINTENANCE_MINIMUM_VERSION);

  // The whole banner is kept, not just its first line. A notice printed AHEAD
  // of the version is one of the candidate explanations the opening bead named
  // for a surprising parse, so reporting only line one would hide the banner in
  // precisely the case the field exists to diagnose.
  const noisy = createCovenMaintenanceClient({
    run: () => ({
      ok: true,
      stdout: "npm notice update available\n\ncoven 0.1.0 (engine 0.7.0)\n",
      stderr: "",
      status: 0,
    }),
  }).version(repoDir);
  assert.equal(
    noisy.covenVersionOutput,
    "npm notice update available coven 0.1.0 (engine 0.7.0)",
    "every line of stdout survives, folded onto one line",
  );

  // A client that fails loudly must not push a backtrace through the refusal.
  const chatty = createCovenMaintenanceClient({
    run: () => ({ ok: true, stdout: `coven 0.1.0\n${"x".repeat(5_000)}`, stderr: "", status: 0 }),
  }).version(repoDir);
  assert.equal(chatty.covenVersionOutput.length, 200);

  // Nothing at all on stdout cannot parse either, and must not add an empty key.
  const silent = createCovenMaintenanceClient({
    run: () => ({ ok: true, stdout: "   \n", stderr: "", status: 0 }),
  }).version(repoDir);
  assert.equal(silent.reason, "coven-version-malformed");
  assert.equal("covenVersionOutput" in silent, false);

  // A caller that supplies no binary (any injected `run`) must degrade to
  // fewer facts rather than to a key holding `undefined`.
  const noBinary = createCovenMaintenanceClient({
    run: () => ({ ok: true, stdout: "coven 0.1.0\n", stderr: "", status: 0 }),
  }).version(repoDir);
  assert.equal(noBinary.reason, "coven-version-unsupported");
  assert.equal("covenBinary" in noBinary, false);
  assert.equal(noBinary.covenMinimumVersion, COVEN_MAINTENANCE_MINIMUM_VERSION);
});

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

function runIsolatedDiscovery(source, env = {}) {
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--import", "./scripts/lifecycle-fixture-env.mjs",
    "--input-type=module",
    "--eval", source,
  ], {
    cwd: sourceRoot,
    env: { ...process.env, COVEN_BIN: process.execPath, ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

test("the real runner reports the argv it executed", () => {
  const stdout = runIsolatedDiscovery(`
    import assert from "node:assert/strict";
    import { realpathSync } from "node:fs";
    import { defaultRunCoven } from "./scripts/maintenance-gate.mjs";
    const result = defaultRunCoven({ args: ["--version"], cwd: process.cwd() });
    assert.equal(result.ok, true);
    assert.equal(result.binary, realpathSync(process.execPath));
    assert.equal(result.stdout.trim(), process.version);
    console.log(process.env.HOME);
  `);
  assert.equal(existsSync(stdout.trim()), false, "the fixture home is removed on exit");
});

test("lifecycle fixtures replace host discovery inputs before importing production modules", {
  skip: process.platform === "win32",
}, () => {
  for (const suite of ["create", "patrol", "retirement"]) {
    assert.match(
      readFileSync(path.join(sourceRoot, "scripts", `worktree-lifecycle-${suite}.test.mjs`), "utf8"),
      /^import "\.\/lifecycle-fixture-env\.mjs";/,
      `${suite} must isolate HOME before coven-bin captures it`,
    );
  }
  const hostileHome = mkdtempSync(path.join(tmpdir(), "cave-host-profile-"));
  const hostileVault = path.join(hostileHome, "vault.yaml");
  writeFileSync(hostileVault, "HOST_FIXTURE_SENTINEL:\n  ref: op://fixture/host/secret\n");
  try {
    runIsolatedDiscovery(`
      import assert from "node:assert/strict";
      import cp from "node:child_process";
      import { mkdirSync, writeFileSync } from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      import { homedir } from "node:os";
      import path from "node:path";
      const hostile = ${JSON.stringify(hostileHome)};
      const originalExec = cp.execFileSync;
      const calls = [];
      cp.execFileSync = (command, args, options) => {
        calls.push({ command, args });
        assert.equal(command.startsWith(hostile), false, "host helper must never execute");
        return originalExec(command, args, options);
      };
      syncBuiltinESMExports();
      assert.notEqual(homedir(), hostile);
      for (const key of ["COVEN_HOME", "COVEN_VAULT_FILE", "XDG_DATA_HOME", "LOCALAPPDATA", "APPDATA", "SHELL"]) {
        assert.equal(process.env[key].startsWith(homedir() + path.sep), true, key);
      }
      assert.equal(process.env.USERPROFILE, homedir());
      assert.deepEqual(process.env.PATH.split(path.delimiter), [
        path.join(homedir(), "bin"), "/usr/bin", "/bin",
      ]);
      // If coven-bin captured the host home before isolation, this candidate
      // would be probed even though HOME now names the fixture.
      const nvm = path.join(hostile, ".nvm", "versions", "node", "v99.0.0", "bin");
      mkdirSync(nvm, { recursive: true });
      for (const name of ["node", "npm"]) writeFileSync(path.join(nvm, name), "");
      const { covenBin, covenSpawnEnv } = await import("./src/lib/coven-bin.ts");
      const { loadVaultMap } = await import("./src/lib/vault.ts");
      assert.deepEqual(loadVaultMap(true), {}, "inherited vault configuration is not loaded");
      assert.equal(covenBin(), process.execPath, "idle resolver cannot select a host Coven");
      const env = covenSpawnEnv();
      assert.ok(env.PATH);
      assert.equal(env.PATH.includes(hostile), false);
      assert.deepEqual(calls, [{ command: process.env.SHELL, args: ["-ilc", "echo $PATH"] }]);
    `, {
      ...Object.fromEntries([
        "HOME", "USERPROFILE", "COVEN_HOME", "XDG_DATA_HOME", "LOCALAPPDATA", "APPDATA", "SHELL",
      ].map((key) => [key, hostileHome])),
      COVEN_VAULT_FILE: hostileVault,
      COVEN_BIN: path.join(hostileHome, "coven"),
      PATH: [hostileHome, process.env.PATH].join(path.delimiter),
    });
  } finally {
    rmSync(hostileHome, { recursive: true, force: true });
  }
});

test("production discovery retains success, failure, cache recovery, and deadline controls", {
  skip: process.platform === "win32",
}, () => {
  runIsolatedDiscovery(`
    import assert from "node:assert/strict";
    import cp from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const calls = [];
    let failure;
    cp.execFileSync = (command, args, options) => {
      assert.equal(command, process.env.SHELL);
      assert.deepEqual(args, ["-ilc", "echo $PATH"]);
      calls.push(options.timeout);
      if (failure) throw Object.assign(new Error("fixture discovery failure"), { code: failure });
      return "/fixture/discovered";
    };
    syncBuiltinESMExports();
    const { covenSpawnEnv, refreshCovenSpawnEnv, refreshCovenBin } =
      await import("./src/lib/coven-bin.ts");
    let clock = 1000;
    const options = { discoveryDeadline: 1250, now: () => clock };
    assert.ok(covenSpawnEnv(options).PATH.includes("/fixture/discovered"));
    assert.deepEqual(calls, [250], "shell receives only the remaining discovery budget");
    covenSpawnEnv(options);
    assert.equal(calls.length, 1, "healthy discovery is cached");
    clock = 1250;
    refreshCovenSpawnEnv(options);
    assert.equal(calls.length, 1, "expired discovery starts no subprocess");
    clock = 1000;
    covenSpawnEnv(options);
    assert.equal(calls.length, 2, "expired discovery did not poison the cache");
    for (failure of ["EACCES", "ETIMEDOUT"]) {
      assert.equal(refreshCovenSpawnEnv(options).PATH.includes("/fixture/discovered"), false);
    }
    failure = undefined;
    assert.ok(refreshCovenSpawnEnv(options).PATH.includes("/fixture/discovered"));

    const { defaultRunCoven } = await import("./scripts/maintenance-gate.mjs");
    const spawns = [];
    cp.spawnSync = (command, args, options) => {
      spawns.push({ command, args, options });
      return { status: null, error: Object.assign(new Error("fixture spawn failure"), { code: failure }) };
    };
    syncBuiltinESMExports();
    // 4500ms of the runner's 5000ms env budget has elapsed before discovery.
    Date.now = () => 5500;
    for (failure of ["ETIMEDOUT", "EACCES"]) {
      refreshCovenBin();
      const result = defaultRunCoven({ args: ["--version"], cwd: process.cwd(), now: () => 1000 });
      assert.equal(calls.at(-1), 500, "runner still imposes its absolute env deadline");
      assert.equal(result.ok, false);
      assert.equal(result.spawnFailure.kind, failure === "ETIMEDOUT" ? "timeout" : "spawn-error");
      assert.equal(result.spawnFailure.code, failure);
      assert.equal(result.spawnFailure.timeoutMs, 35000);
      assert.equal(result.binary, spawns.at(-1).command);
      assert.deepEqual(spawns.at(-1).args, ["--version"]);
      assert.equal(spawns.at(-1).options.timeout, 35000);
      assert.equal(spawns.at(-1).options.shell, false);
    }
  `);
});

// The composite coordinator prefixes the Coven reason and used to interpolate
// nothing else, so every fact `version()` gathers was discarded one frame above
// the only place a human reads it.
test("a Coven version refusal reaches the caller with the binary, version, and floor intact", () => {
  const localHandle = { generation: 1, token: "local", root: repoDir };
  const released = [];
  const coordinator = createRepositoryMaintenanceCoordinator({
    localFence: {
      acquire: () => ({ ok: true, handle: localHandle }),
      heartbeat: () => ({ ok: true }),
      verify: () => ({ ok: true }),
      release: (handle) => (released.push(handle), { ok: true }),
    },
    covenClient: createCovenMaintenanceClient({
      run: covenFixture({ version: "0.2.0-23-g976d3b5", binary: "C:\\Users\\dev\\.cargo\\bin\\coven.exe" }).run,
    }),
  });
  const refusal = coordinator.acquire({ ownerId: "cave-maintenance", purpose: "test", repoDir });
  assert.equal(refusal.ok, false);
  assert.equal(refusal.reason, "coven-acquire-failed: coven-version-unsupported");
  assert.equal(refusal.covenBinary, "C:\\Users\\dev\\.cargo\\bin\\coven.exe");
  assert.equal(refusal.covenVersion, "0.2.0-23-g976d3b5");
  assert.equal(refusal.covenMinimumVersion, COVEN_MAINTENANCE_MINIMUM_VERSION);
  assert.deepEqual(released, [localHandle], "the local fence is still compensated");

  // The plane report the patrol prints is the other surface a reader meets
  // this on, and it renders `source` verbatim.
  const capabilities = repositoryMaintenanceCapabilities({
    repoDir,
    covenClient: createCovenMaintenanceClient({
      run: covenFixture({ version: "0.2.0", binary: "/opt/stale/coven" }).run,
    }),
  });
  assert.equal(capabilities.coven.enforced, false);
  assert.ok(capabilities.coven.source.includes("/opt/stale/coven"), capabilities.coven.source);
  assert.ok(capabilities.coven.source.includes("0.2.0"), capabilities.coven.source);
  assert.ok(
    capabilities.coven.source.includes(COVEN_MAINTENANCE_MINIMUM_VERSION),
    capabilities.coven.source,
  );
});

test("composite acquisition rolls back the local fence and preserves exact recovery ownership", () => {
  const localCalls = [];
  const localHandle = { generation: 7, token: "local-token", root: repoDir };
  const localFence = {
    acquire: () => ({ ok: true, handle: localHandle }),
    heartbeat: () => ({ ok: true }),
    verify: () => ({ ok: true }),
    release: (handle) => {
      localCalls.push(handle);
      return { ok: true };
    },
  };
  const covenClient = {
    acquire: () => ({ ok: false, reason: "coven-still-draining" }),
    heartbeat: () => ({ ok: true }),
    verify: () => ({ ok: true }),
    release: () => ({ ok: true }),
  };
  const coordinator = createRepositoryMaintenanceCoordinator({ localFence, covenClient });
  assert.deepEqual(
    coordinator.acquire({ ownerId: "cave-maintenance", purpose: "test", repoDir }),
    { ok: false, reason: "coven-acquire-failed: coven-still-draining" },
  );
  assert.deepEqual(localCalls, [localHandle], "Coven failure compensates the matching local owner");

  const stuck = createRepositoryMaintenanceCoordinator({
    localFence,
    covenClient: {
      ...covenClient,
      acquire: () => ({
        ok: false,
        reason: "coven-acquire-cleanup-failed",
        recoveryHandle: { ownerId: "cave-maintenance", generation: "coven-generation", repoDir },
      }),
    },
  }).acquire({ ownerId: "cave-maintenance", purpose: "test", repoDir });
  assert.equal(stuck.ok, false);
  assert.equal(stuck.reason, "coven-acquire-cleanup-failed");
  assert.deepEqual(stuck.recoveryHandle.local, localHandle);
  assert.equal(localCalls.length, 1, "do not split the fence while Coven recovery remains held");
});

test("composite release is ordered and reports either release failure", () => {
  const calls = [];
  const coordinator = createRepositoryMaintenanceCoordinator({
    localFence: {
      acquire: () => assert.fail("not used"),
      heartbeat: () => ({ ok: true }),
      verify: () => ({ ok: true }),
      release: () => {
        calls.push("local");
        return { ok: true };
      },
    },
    covenClient: {
      acquire: () => assert.fail("not used"),
      heartbeat: () => ({ ok: true }),
      verify: () => ({ ok: true }),
      release: () => {
        calls.push("coven");
        return { ok: false, reason: "coven-release-unavailable" };
      },
    },
  });
  const handle = {
    local: { generation: 1 },
    coven: { ownerId: "cave-maintenance", generation: "coven-generation", repoDir },
  };
  const released = coordinator.release(handle);
  assert.equal(released.ok, false);
  assert.equal(released.reason, "coven-release-failed: coven-release-unavailable");
  assert.deepEqual(calls, ["coven"], "local state stays fenced if Coven release fails");
  assert.deepEqual(released.recoveryHandle, handle);
});

// cave-nom3z. A failed Coven release used to leave the local fence held for its
// full 600s TTL, refusing every acquisition in the repository — and then
// refusing them as `gate-stale`. The commonest cause was a lease that had
// already expired, i.e. a Coven fence that was not standing at all.
function releaseCoordinator({ verify, onLocalRelease = () => ({ ok: true }) }) {
  const calls = [];
  const coordinator = createRepositoryMaintenanceCoordinator({
    localFence: {
      acquire: () => assert.fail("not used"),
      heartbeat: () => ({ ok: true }),
      verify: () => ({ ok: true }),
      release: () => {
        calls.push("local");
        return onLocalRelease();
      },
    },
    covenClient: {
      acquire: () => assert.fail("not used"),
      heartbeat: () => ({ ok: true }),
      verify,
      release: () => {
        calls.push("coven");
        return { ok: false, reason: "coven-release-unavailable" };
      },
    },
  });
  return { coordinator, calls };
}

const releaseHandle = {
  local: { generation: 1 },
  coven: { ownerId: "cave-maintenance", generation: "coven-generation", repoDir },
};

for (const reason of ["coven-owner-missing", "coven-not-owner", "coven-expired"]) {
  test(`a failed Coven release still frees the local fence when verify proves ${reason}`, () => {
    const { coordinator, calls } = releaseCoordinator({
      verify: () => ({ ok: false, reason }),
    });
    const released = coordinator.release(releaseHandle);
    assert.equal(released.ok, false, "the caller asked for both fences down; Coven did not comply");
    assert.equal(released.reason, "coven-release-failed: coven-release-unavailable");
    assert.equal(released.covenFenceGone, reason);
    assert.equal(released.localReleased, true);
    assert.deepEqual(calls, ["coven", "local"], "order is unchanged: Coven first, then local");
    assert.equal(
      released.recoveryHandle,
      undefined,
      "nothing is left held, so there is nothing to recover",
    );
  });
}

for (const reason of ["coven-still-draining", "coven-writers-active", "coven-status-unavailable"]) {
  test(`a failed Coven release keeps the local fence when verify reports ${reason}`, () => {
    // These are the cases where the Coven fence may still be standing, or where
    // we simply cannot tell. Releasing local here would split the two writer
    // populations, which is the thing `acquire` deliberately refuses to do.
    const { coordinator, calls } = releaseCoordinator({
      verify: () => ({ ok: false, reason }),
    });
    const released = coordinator.release(releaseHandle);
    assert.equal(released.ok, false);
    assert.deepEqual(calls, ["coven"], "local stays fenced while the Coven state is unproven");
    assert.deepEqual(released.recoveryHandle, releaseHandle);
  });
}

test("a still-held Coven fence keeps the local fence even when verify succeeds", () => {
  // verify ok means we DO still own it, so the release genuinely failed.
  const { coordinator, calls } = releaseCoordinator({ verify: () => ({ ok: true }) });
  const released = coordinator.release(releaseHandle);
  assert.equal(released.ok, false);
  assert.deepEqual(calls, ["coven"]);
  assert.deepEqual(released.recoveryHandle, releaseHandle);
});

test("a local release that itself fails is reported with an exact recovery handle", () => {
  const { coordinator } = releaseCoordinator({
    verify: () => ({ ok: false, reason: "coven-expired" }),
    onLocalRelease: () => ({ ok: false, reason: "state-busy" }),
  });
  const released = coordinator.release(releaseHandle);
  assert.equal(released.localReleased, false);
  assert.equal(
    released.localReleaseFailed,
    "state-busy",
    "the recovery path must say WHY local is still held, not just that it is",
  );
  assert.deepEqual(
    released.recoveryHandle,
    { local: releaseHandle.local },
    "only the fence still held is offered for recovery",
  );
});

test("maintenance capabilities name the released Coven protocol without claiming completeness", () => {
  assert.deepEqual(repositoryMaintenanceCapabilities({
    repoDir,
    covenClient: {
      version: () => ({
        ok: true,
        version: COVEN_MAINTENANCE_MINIMUM_VERSION,
      }),
    },
  }), {
    local: {
      enforced: true,
      source: "scripts/local-maintenance-gate.mjs via composite coordinator",
    },
    coven: {
      enforced: true,
      source: `@opencoven/cli@${COVEN_MAINTENANCE_MINIMUM_VERSION} maintenance`,
    },
    beads: { enforced: false, source: "cave-wqa0b.3" },
    github: { enforced: false, source: "cave-wqa0b.4" },
    complete: false,
  });
});

test("a failed coven command carries the client's own stderr into the reason", () => {
  // Every non-zero exit used to collapse to `coven-<op>-unavailable`, which
  // reads as "the subcommand is missing or too old". The common failure is an
  // expired owner lease, and that message sent a session after a version
  // number that had nothing to do with it (cave-7w5cu). The suffix is kept so
  // existing matchers still work; the detail is appended.
  const coordinator = createRepositoryMaintenanceCoordinator({
    covenClient: createCovenMaintenanceClient({
      run: () => ({ ok: false, stdout: "", stderr: "error: owner lease expired\nbacktrace...", status: 1 }),
      now: () => 0,
    }),
  });
  const released = coordinator.release({
    local: { generation: 1 },
    coven: { ownerId: "cave-maintenance", generation: "g", repoDir },
  });
  assert.equal(released.ok, false);
  assert.match(released.reason, /coven-release-unavailable: error: owner lease expired/);
  assert.doesNotMatch(released.reason, /backtrace/, "only the first stderr line is carried");
});

test("a failed coven command with no stderr keeps the bare reason", () => {
  const coordinator = createRepositoryMaintenanceCoordinator({
    covenClient: createCovenMaintenanceClient({
      run: () => ({ ok: false, stdout: "", stderr: "   \n\n", status: 1 }),
      now: () => 0,
    }),
  });
  const released = coordinator.release({
    local: { generation: 1 },
    coven: { ownerId: "cave-maintenance", generation: "g", repoDir },
  });
  assert.equal(released.reason, "coven-release-failed: coven-release-unavailable");
});
