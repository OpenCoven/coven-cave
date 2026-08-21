import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { clientV1InstanceId, clientV1InstanceIdFile } from "./instance-id.ts";

function withCaveHome(run: (home: string) => void) {
  const previousHome = process.env.COVEN_CAVE_HOME;
  const previousOverride = process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;
  const home = mkdtempSync(path.join(tmpdir(), "cave-client-v1-instance-"));
  process.env.COVEN_CAVE_HOME = home;
  delete process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;
  try {
    run(home);
  } finally {
    if (previousHome === undefined) delete process.env.COVEN_CAVE_HOME;
    else process.env.COVEN_CAVE_HOME = previousHome;
    if (previousOverride === undefined) delete process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;
    else process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID = previousOverride;
    rmSync(home, { recursive: true, force: true });
  }
}

test("mints an instance id once and reuses it", () => {
  withCaveHome(() => {
    const first = clientV1InstanceId();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    // Persistence is the whole point: a client's cached pairing must survive
    // a Cave restart.
    assert.equal(clientV1InstanceId(), first);
    assert.equal(JSON.parse(readFileSync(clientV1InstanceIdFile(), "utf8")).instanceId, first);
  });
});

test("gives different installations different ids", () => {
  let first = "";
  let second = "";
  withCaveHome(() => {
    first = clientV1InstanceId();
  });
  withCaveHome(() => {
    second = clientV1InstanceId();
  });
  assert.notEqual(first, second);
});

test("honours an explicit instance id override", () => {
  withCaveHome(() => {
    process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID = "fixed-instance-id";
    assert.equal(clientV1InstanceId(), "fixed-instance-id");
  });
});

test("ignores a corrupt or empty persisted record and re-mints", () => {
  for (const corrupt of ["not json", "[]", "null", '{"instanceId": 42}', '{"instanceId": "  "}', "{}"]) {
    withCaveHome(() => {
      const file = clientV1InstanceIdFile();
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, corrupt, "utf8");
      const instanceId = clientV1InstanceId();
      assert.match(instanceId, /^[0-9a-f-]{36}$/i);
      assert.equal(JSON.parse(readFileSync(file, "utf8")).instanceId, instanceId);
    });
  }
});

test("still answers when the id cannot be persisted", (t) => {
  if (process.platform === "win32") {
    // chmod is not honoured on Windows, so the unwritable directory this test
    // depends on cannot be constructed there.
    t.skip("POSIX permissions required");
    return;
  }
  withCaveHome((home) => {
    const readOnly = path.join(home, "cave");
    mkdirSync(readOnly, { recursive: true });
    chmodSync(readOnly, 0o500);
    try {
      // Health is a diagnostic surface: a full or read-only disk must degrade
      // to a per-process id, never to a failed endpoint.
      assert.match(clientV1InstanceId(), /^[0-9a-f-]{36}$/i);
    } finally {
      chmodSync(readOnly, 0o700);
    }
  });
});
