import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { CLIENT_V1_DISCOVERY_FILE } from "./discovery.ts";
import {
  CLIENT_V1_DISCOVERY_UNAVAILABLE_DETAIL,
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

test("reports discovery unavailable with the banner detail when no record exists", async () => {
  await withScratchRoot(async (root) => {
    assert.deepEqual(await resolveClientV1DiscoveryStatus(root), {
      available: false,
      reason: CLIENT_V1_DISCOVERY_UNAVAILABLE_DETAIL,
    });
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
