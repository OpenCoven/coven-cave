import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { CLIENT_V1_LIMITS, parseClientV1Health } from "./contract.ts";
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

test("honours an explicit instance id override up to the contract bound", () => {
  withCaveHome(() => {
    process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID = "fixed-instance-id";
    assert.equal(clientV1InstanceId(), "fixed-instance-id");
  });
  withCaveHome(() => {
    const longest = "i".repeat(CLIENT_V1_LIMITS.instanceIdCharacters);
    process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID = longest;
    assert.equal(clientV1InstanceId(), longest);
  });
});

test("ignores an override that exceeds the contract bound", () => {
  withCaveHome(() => {
    process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID = "i".repeat(CLIENT_V1_LIMITS.instanceIdCharacters + 1);
    // Serving it would answer 200 with a body parseClientV1Health rejects, so
    // the client reads no compatibility answer at all. Fall back to the
    // persisted id rather than publishing an unreadable one.
    const instanceId = clientV1InstanceId();
    assert.match(instanceId, /^[0-9a-f-]{36}$/i);
    assert.doesNotThrow(() =>
      parseClientV1Health({ instanceId, pairingRequired: true, releaseVersion: "0.0.0" }),
    );
  });
});

test("says so, once, when it ignores an oversized override", () => {
  const warnings: string[] = [];
  const previousWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    withCaveHome(() => {
      // Silently substituting a different id is the failure this guards: the
      // operator's fleet tooling keys on the id it pinned, and nothing in a 200
      // response tells it the pin was dropped.
      // A value no earlier case used: the warning is deduplicated per value, so
      // reusing one already reported would prove nothing.
      process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID = "j".repeat(CLIENT_V1_LIMITS.instanceIdCharacters + 2);
      clientV1InstanceId();
      clientV1InstanceId();
    });
  } finally {
    console.warn = previousWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /COVEN_CAVE_CLIENT_V1_INSTANCE_ID/);
  assert.match(warnings[0], new RegExp(String(CLIENT_V1_LIMITS.instanceIdCharacters)));
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

test("serves a remembered id instead of re-reading the store on every call", () => {
  withCaveHome(() => {
    const first = clientV1InstanceId();
    // Removing the store proves the second call never reached disk. The health
    // route is unauthenticated and force-dynamic, so an unremembered id put one
    // synchronous readFileSync on the event loop for every request an anonymous
    // caller cared to send.
    rmSync(clientV1InstanceIdFile(), { force: true });
    assert.equal(clientV1InstanceId(), first);
  });
});

test("still answers, with one id per process, when it cannot be persisted", () => {
  withCaveHome(() => {
    // A directory standing where the store belongs fails both the read and the
    // write on every platform, unlike a chmod Windows ignores.
    mkdirSync(clientV1InstanceIdFile(), { recursive: true });
    // Health is a diagnostic surface: a full or read-only disk must degrade to
    // a per-process id, never to a failed endpoint and never to an id that
    // churns per request — a churning id makes every client re-pair on every
    // call, which is the one thing instanceId exists to prevent.
    const first = clientV1InstanceId();
    assert.match(first, /^[0-9a-f-]{36}$/i);
    assert.equal(clientV1InstanceId(), first);
  });
});

test("still answers when the Cave home itself is read-only", (t) => {
  if (process.platform === "win32") {
    // chmod is not honoured on Windows, so the unwritable directory this test
    // depends on cannot be constructed there.
    t.skip("POSIX permissions required");
    return;
  }
  withCaveHome((home) => {
    // The store lives directly in the Cave home, so the home is the directory
    // whose permissions decide whether the write succeeds. Chmodding a "cave"
    // subdirectory instead left the write path fully writable and the assertion
    // below passing for the wrong reason.
    const storeDirectory = path.dirname(clientV1InstanceIdFile());
    assert.equal(storeDirectory, home);
    chmodSync(storeDirectory, 0o500);
    try {
      assert.match(clientV1InstanceId(), /^[0-9a-f-]{36}$/i);
    } finally {
      chmodSync(storeDirectory, 0o700);
    }
  });
});
