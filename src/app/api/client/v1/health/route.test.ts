import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CLIENT_V1_API_VERSION,
  CLIENT_V1_CAPABILITIES,
  CLIENT_V1_MIN_CLIENT_VERSION,
  parseClientV1Health,
} from "@/lib/server/client-v1/contract";
import { APP_VERSION } from "@/lib/app-version";

import { GET } from "./route.ts";

/**
 * The route reads its instance id out of the Cave home, so every test points
 * COVEN_CAVE_HOME at a throwaway directory. Without that the suite would mint
 * and persist an id into the developer's real `~/.coven/cave/`.
 */
function withTemporaryCaveHome<T>(run: () => Promise<T>): Promise<T> {
  const previousHome = process.env.COVEN_CAVE_HOME;
  const previousOverride = process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;
  const home = mkdtempSync(path.join(tmpdir(), "cave-client-v1-health-"));
  process.env.COVEN_CAVE_HOME = home;
  delete process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;
  const restore = () => {
    if (previousHome === undefined) delete process.env.COVEN_CAVE_HOME;
    else process.env.COVEN_CAVE_HOME = previousHome;
    if (previousOverride === undefined) delete process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;
    else process.env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID = previousOverride;
    rmSync(home, { recursive: true, force: true });
  };
  return run().then(
    (value) => {
      restore();
      return value;
    },
    (error) => {
      restore();
      throw error;
    },
  );
}

test("serves the six compatibility fields a client needs before pairing", async () => {
  await withTemporaryCaveHome(async () => {
    const response = await GET();
    assert.equal(response.status, 200);

    const envelope = await response.json();
    assert.equal(envelope.apiVersion, CLIENT_V1_API_VERSION);
    assert.equal(envelope.minimumClientVersion, CLIENT_V1_MIN_CLIENT_VERSION);
    assert.deepEqual(envelope.capabilities, [...CLIENT_V1_CAPABILITIES]);
    assert.equal(envelope.error, undefined);

    const health = parseClientV1Health(envelope.data);
    assert.equal(health.pairingRequired, true);
    assert.equal(health.releaseVersion, APP_VERSION);
    assert.match(health.instanceId, /^[0-9a-f-]{36}$/i);
  });
});

test("keeps the instance id stable across requests", async () => {
  await withTemporaryCaveHome(async () => {
    const first = await (await GET()).json();
    const second = await (await GET()).json();
    // A client caches its pairing against this id. If it changed per request
    // every client would re-pair on every call.
    assert.equal(first.data.instanceId, second.data.instanceId);
  });
});

test("reports the running release rather than the fixture placeholder", async () => {
  await withTemporaryCaveHome(async () => {
    const envelope = await (await GET()).json();
    assert.notEqual(envelope.data.releaseVersion, "0.0.0");
    assert.equal(envelope.data.releaseVersion, APP_VERSION);
  });
});

test("answers without leaking paths, configuration, or user data", async () => {
  await withTemporaryCaveHome(async () => {
    const envelope = await (await GET()).json();
    // Health is unauthenticated, so its whole body is public. Assert the shape
    // is exactly the agreed keys rather than trusting nothing crept in.
    assert.deepEqual(Object.keys(envelope.data).sort(), [
      "instanceId",
      "pairingRequired",
      "releaseVersion",
    ]);
    const serialized = JSON.stringify(envelope);
    assert.equal(serialized.includes(process.cwd()), false);
    assert.equal(/[A-Za-z]:\\\\|\/Users\/|\/home\//.test(serialized), false);
    // Health is the one Client v1 route reachable without a credential, so it
    // must never carry a pairing secret or bearer back out.
    assert.equal(/secret|bearer/i.test(serialized), false);
  });
});

test("advertises the pairing and credential capabilities a client pairs against", async () => {
  await withTemporaryCaveHome(async () => {
    const envelope = await (await GET()).json();
    // A client reads these before it opens a pairing request; losing either
    // would make the pairing authority undiscoverable.
    assert.equal(envelope.capabilities.includes("pairing"), true);
    assert.equal(envelope.capabilities.includes("credentials"), true);
  });
});
