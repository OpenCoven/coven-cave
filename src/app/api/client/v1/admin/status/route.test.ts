import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

import { CLIENT_V1_DISCOVERY_FILE } from "@/lib/server/client-v1/discovery.ts";
import { TOKEN_HEADER } from "@/proxy-helpers.ts";

import { createAdminStatusGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-admin-status-");
const adminSecret = "sidecar-admin-secret";
const WAIVER_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
const WAIVER_REASON_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
const WAIVER_TOKEN = "i-accept-unverified-path-ownership";

const ENV_KEYS = [
  "COVEN_CAVE_AUTH_TOKEN",
  "COVEN_CAVE_HOME",
  WAIVER_ENV,
  WAIVER_REASON_ENV,
] as const;
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

function request(options: { headers?: HeadersInit } = {}): Request {
  return new Request("http://127.0.0.1:3020/api/client/v1/admin/status", {
    headers: options.headers,
  });
}

after(() => restoreEnv());

test("refuses without the per-launch admin credential", async () => {
  setEnv({ COVEN_CAVE_AUTH_TOKEN: adminSecret });
  const response = await createAdminStatusGetHandler()(request());
  assert.equal(response.status, 401);
  const payload = await response.json() as { error?: { code?: string } };
  assert.equal(payload.error?.code, "unauthorized");
});

test("reports the discovery and waiver state to the administrator", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    setEnv({
      COVEN_CAVE_AUTH_TOKEN: adminSecret,
      COVEN_CAVE_HOME: root,
      [WAIVER_ENV]: WAIVER_TOKEN,
      [WAIVER_REASON_ENV]: "Kiosk operator accepted an unreadable DACL.",
    });
    await writeFile(
      join(root, CLIENT_V1_DISCOVERY_FILE),
      JSON.stringify({
        version: 1,
        endpoint: "http://127.0.0.1:3020",
        pid: process.pid,
        nonce: "admin-status-test-nonce",
        startedAt: "2026-08-22T10:00:00.000Z",
      }),
      "utf8",
    );

    const response = await createAdminStatusGetHandler()(
      request({ headers: { [TOKEN_HEADER]: adminSecret } }),
    );
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      apiVersion: string;
      data: { status: unknown };
    };
    assert.equal(typeof payload.apiVersion, "string");
    assert.deepEqual(payload.data.status, {
      discovery: { available: true },
      ownershipWaiver: {
        granted: true,
        reason: "Kiosk operator accepted an unreadable DACL.",
      },
    });
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
    restoreEnv();
  }
});

test("reports the degraded states when the record is missing", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    setEnv({
      COVEN_CAVE_AUTH_TOKEN: adminSecret,
      COVEN_CAVE_HOME: root,
    });

    const response = await createAdminStatusGetHandler()(
      request({ headers: { [TOKEN_HEADER]: adminSecret } }),
    );
    assert.equal(response.status, 200);
    const payload = await response.json() as { data: { status: unknown } };
    const status = payload.data.status as {
      discovery: { available: boolean; reason?: string };
      ownershipWaiver: { granted: boolean };
    };
    assert.equal(status.discovery.available, false);
    assert.match(status.discovery.reason ?? "", /discovery record was NOT published/u);
    assert.deepEqual(status.ownershipWaiver, { granted: false });
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
    restoreEnv();
  }
});
