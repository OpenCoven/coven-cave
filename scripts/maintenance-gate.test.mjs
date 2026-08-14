import assert from "node:assert/strict";
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
} = {}) {
  const calls = [];
  let owner = null;
  let generation = 0;
  const run = ({ args, cwd }) => {
    calls.push({ args, cwd });
    if (unavailable) return { ok: false, stdout: "", stderr: "", status: null };
    if (args[0] === "--version") {
      return { ok: true, stdout: `coven ${version}\n`, stderr: "", status: 0 };
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

test("Coven client rejects maintenance protocols below the reviewed release", () => {
  assert.equal(supportsCovenMaintenanceVersion("coven 0.2.5"), true);
  assert.equal(supportsCovenMaintenanceVersion("coven v0.3.0"), true);
  assert.equal(supportsCovenMaintenanceVersion("coven 0.2.5-beta.1"), false);
  assert.equal(supportsCovenMaintenanceVersion("coven 0.2.4-recovery.1"), false);
  assert.equal(supportsCovenMaintenanceVersion("unknown"), false);

  const client = createCovenMaintenanceClient({
    run: covenFixture({ version: "0.2.4-recovery.1" }).run,
  });
  assert.deepEqual(
    client.acquire({ ownerId: "cave-maintenance", repoDir, waitMs: 0 }),
    {
      ok: false,
      reason: "coven-version-unsupported",
      version: "0.2.4-recovery.1",
    },
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
