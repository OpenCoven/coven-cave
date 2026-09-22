import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { CLIENT_V1_DISCOVERY_FILE } from "./discovery.ts";
import {
  CLIENT_V1_DISCOVERY_UNAVAILABLE_DETAIL,
  type ClientV1DiscoveryPublication,
  resolveClientV1DiscoveryStatus,
  resolveClientV1OwnershipWaiverStatus,
  resolveClientV1Status,
} from "./status.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-status-");
const WAIVER_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
const WAIVER_REASON_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
const WAIVER_TOKEN = "i-accept-unverified-path-ownership";

const ENV_KEYS = [WAIVER_ENV, WAIVER_REASON_ENV] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function withScratchRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(scratchPrefix);
  try {
    await run(root);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
}

function v1Record(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    endpoint: "http://127.0.0.1:3020",
    pid: process.pid,
    nonce: "status-test-nonce",
    startedAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

test("reports discovery available for a valid record published by a live process", async () => {
  await withScratchRoot(async (root) => {
    await writeFile(
      join(root, CLIENT_V1_DISCOVERY_FILE),
      JSON.stringify(v1Record()),
      "utf8",
    );
    assert.deepEqual(await resolveClientV1DiscoveryStatus(root), { available: true });
  });
});

test("reports discovery unavailable with the no-attempt detail when no record exists and nothing was recorded", async () => {
  await withScratchRoot(async (root) => {
    assert.deepEqual(await resolveClientV1DiscoveryStatus(root, undefined), {
      available: false,
      reason: CLIENT_V1_DISCOVERY_UNAVAILABLE_DETAIL,
    });
  });
});

function publication(overrides: Partial<ClientV1DiscoveryPublication> = {}): ClientV1DiscoveryPublication {
  return {
    path: "/home/operator/.coven/cave/client-v1-discovery.json",
    endpoint: "http://127.0.0.1:3000",
    nonce: "status-test-nonce",
    published: true,
    ...overrides,
  };
}

test("reports available when the record on disk is this process's own publication", async () => {
  await withScratchRoot(async (root) => {
    await writeFile(join(root, CLIENT_V1_DISCOVERY_FILE), JSON.stringify(v1Record()), "utf8");
    assert.deepEqual(await resolveClientV1DiscoveryStatus(root, publication()), { available: true });
  });
});

test("names the other live instance when its record occupies the slot (#5517)", async () => {
  await withScratchRoot(async (root) => {
    await writeFile(
      join(root, CLIENT_V1_DISCOVERY_FILE),
      JSON.stringify(v1Record({ nonce: "someone-elses-nonce", endpoint: "http://127.0.0.1:3020" })),
      "utf8",
    );
    const status = await resolveClientV1DiscoveryStatus(root, publication());
    assert.equal(status.available, false);
    const reason = (status as { reason: string }).reason;
    assert.match(reason, new RegExp(`Another Cave process \\(pid ${process.pid}\\)`, "u"));
    assert.match(reason, /http:\/\/127\.0\.0\.1:3020/u);
    assert.match(reason, /this server \(http:\/\/127\.0\.0\.1:3000\) is not discoverable/u);
    assert.match(reason, /COVEN_CAVE_HOME/u);
  });
});

test("explains a startup refusal with its category and message", async () => {
  await withScratchRoot(async (root) => {
    const status = await resolveClientV1DiscoveryStatus(root, publication({
      published: false,
      failure: {
        category: "root-owner-shared",
        message: "Client v1 discovery root must be owned by the current user.",
      },
    }));
    assert.deepEqual(status, {
      available: false,
      reason: "Publication was refused when this server started (root-owner-shared): "
        + "Client v1 discovery root must be owned by the current user. Repair the cause and restart.",
    });
  });
});

test("republishes when this process's record was removed by another instance", async () => {
  await withScratchRoot(async (root) => {
    let republished = 0;
    const status = await resolveClientV1DiscoveryStatus(root, publication({
      republish: () => {
        republished += 1;
        return true;
      },
    }));
    assert.equal(republished, 1);
    assert.deepEqual(status, { available: true });
  });
});

test("reports published-then-removed when republication is unavailable or fails", async () => {
  await withScratchRoot(async (root) => {
    const withoutHook = await resolveClientV1DiscoveryStatus(root, publication());
    assert.equal(withoutHook.available, false);
    assert.match((withoutHook as { reason: string }).reason, /has since been removed/u);
    assert.match((withoutHook as { reason: string }).reason, /client-v1-discovery\.json exited and cleaned it up/u);

    const failing = await resolveClientV1DiscoveryStatus(root, publication({ republish: () => false }));
    assert.equal(failing.available, false);
    assert.match((failing as { reason: string }).reason, /Restart this server to publish it again/u);
  });
});

test("reports discovery unavailable when the record is not valid JSON", async () => {
  await withScratchRoot(async (root) => {
    await writeFile(join(root, CLIENT_V1_DISCOVERY_FILE), "not json", "utf8");
    const status = await resolveClientV1DiscoveryStatus(root);
    assert.equal(status.available, false);
    assert.match((status as { reason: string }).reason, /not valid JSON/u);
  });
});

test("reports discovery unavailable when the record does not validate", async () => {
  await withScratchRoot(async (root) => {
    // A stale record from a crashed run: the pid names no live process, which
    // is exactly the state a paired client's reader would refuse.
    await writeFile(
      join(root, CLIENT_V1_DISCOVERY_FILE),
      JSON.stringify(v1Record({ pid: 999_999_999 })),
      "utf8",
    );
    const status = await resolveClientV1DiscoveryStatus(root);
    assert.equal(status.available, false);
    assert.match((status as { reason: string }).reason, /live process/u);
  });
});

test("resolves the ownership waiver strictly from the environment", () => {
  setEnv({});
  assert.deepEqual(resolveClientV1OwnershipWaiverStatus(), { granted: false });

  setEnv({ [WAIVER_ENV]: "1" });
  assert.deepEqual(resolveClientV1OwnershipWaiverStatus(), { granted: false });

  setEnv({ [WAIVER_ENV]: WAIVER_TOKEN });
  assert.deepEqual(resolveClientV1OwnershipWaiverStatus(), { granted: false });

  const reason = "Operator accepted an unreadable DACL on this kiosk.";
  setEnv({ [WAIVER_ENV]: WAIVER_TOKEN, [WAIVER_REASON_ENV]: reason });
  assert.deepEqual(resolveClientV1OwnershipWaiverStatus(), {
    granted: true,
    reason,
  });
});

test("resolveClientV1Status combines the discovery and waiver states", async () => {
  setEnv({
    [WAIVER_ENV]: WAIVER_TOKEN,
    [WAIVER_REASON_ENV]: "Kiosk operator accepted unreadable DACL.",
  });
  try {
    await withScratchRoot(async (root) => {
      await writeFile(
        join(root, CLIENT_V1_DISCOVERY_FILE),
        JSON.stringify(v1Record()),
        "utf8",
      );
      const status = await resolveClientV1Status(root);
      assert.deepEqual(status.discovery, { available: true });
      assert.equal(status.ownershipWaiver.granted, true);
    });

    await withScratchRoot(async (root) => {
      const status = await resolveClientV1Status(root);
      assert.equal(status.discovery.available, false);
      assert.equal(status.ownershipWaiver.granted, true);
    });
  } finally {
    restoreEnv();
  }
});
