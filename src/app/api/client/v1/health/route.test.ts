import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CLIENT_V1_API_VERSION,
  CLIENT_V1_CAPABILITIES,
  CLIENT_V1_MIN_CLIENT_VERSION,
  CLIENT_V1_OPERATIONS,
  parseClientV1Health,
} from "@/lib/server/client-v1/contract";
import { clientV1Operation } from "@/lib/server/client-v1/operations";
import { APP_VERSION } from "@/lib/app-version";
import {
  CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED,
  CLIENT_V1_COMPATIBILITY_PRESET_ENV,
} from "@/lib/server/client-v1/conformance-compatibility";

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

test("serves the seven compatibility fields a client needs before pairing", async () => {
  await withTemporaryCaveHome(async () => {
    const response = await GET();
    assert.equal(response.status, 200);

    const envelope = await response.json();
    assert.equal(envelope.apiVersion, CLIENT_V1_API_VERSION);
    assert.equal(envelope.minimumClientVersion, CLIENT_V1_MIN_CLIENT_VERSION);
    assert.deepEqual(envelope.capabilities, [...CLIENT_V1_CAPABILITIES]);
    assert.deepEqual(envelope.operations, [...CLIENT_V1_OPERATIONS]);
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

test(
  "keeps production metadata unchanged when only the runtime selector is present",
  { skip: CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED },
  async () => {
    await withTemporaryCaveHome(async () => {
      const previousPreset = process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV];
      process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV] = "api-major";
      try {
        const envelope = await (await GET()).json();
        assert.equal(envelope.apiVersion, CLIENT_V1_API_VERSION);
        assert.equal(envelope.minimumClientVersion, CLIENT_V1_MIN_CLIENT_VERSION);
      } finally {
        if (previousPreset === undefined) {
          delete process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV];
        } else {
          process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV] = previousPreset;
        }
      }
    });
  },
);

test(
  "the enabled conformance build emits the API-major preset through the real route",
  { skip: !CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED },
  async () => {
    await withTemporaryCaveHome(async () => {
      const previousPreset = process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV];
      process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV] = "api-major";
      try {
        const envelope = await (await GET()).json();
        assert.equal(envelope.apiVersion, "2.0");
        assert.equal(envelope.minimumClientVersion, CLIENT_V1_MIN_CLIENT_VERSION);
      } finally {
        if (previousPreset === undefined) {
          delete process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV];
        } else {
          process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV] = previousPreset;
        }
      }
    });
  },
);

test(
  "the enabled conformance build emits the minimum-client preset independently",
  { skip: !CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED },
  async () => {
    await withTemporaryCaveHome(async () => {
      const previousPreset = process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV];
      process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV] = "minimum-client";
      try {
        const envelope = await (await GET()).json();
        assert.equal(envelope.apiVersion, CLIENT_V1_API_VERSION);
        assert.equal(envelope.minimumClientVersion, "999.0.0");
      } finally {
        if (previousPreset === undefined) {
          delete process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV];
        } else {
          process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV] = previousPreset;
        }
      }
    });
  },
);

test(
  "the enabled conformance build rejects an invalid preset",
  { skip: !CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED },
  async () => {
    await withTemporaryCaveHome(async () => {
      const previousPreset = process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV];
      process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV] = "not-a-preset";
      try {
        const response = await GET();
        const envelope = await response.json();
        assert.equal(response.status, 500);
        assert.equal(envelope.error.code, "internal_error");
      } finally {
        if (previousPreset === undefined) {
          delete process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV];
        } else {
          process.env[CLIENT_V1_COMPATIBILITY_PRESET_ENV] = previousPreset;
        }
      }
    });
  },
);

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

test("declares only what this build can actually be asked to perform", async () => {
  await withTemporaryCaveHome(async () => {
    const envelope = await (await GET()).json();
    // #4869: the envelope used to advertise `streaming` and `revisions` on
    // every response, and no route served either — so an SDK helper spelled
    // `client.supports("streaming")` returned a false operational claim. Health
    // is where a client reads the declaration before it has any credential, so
    // this is the response where the claim has to be true.
    for (const retired of ["streaming", "revisions"]) {
      assert.equal(envelope.capabilities.includes(retired), false, retired);
      assert.equal(
        envelope.operations.some((id: string) => id.startsWith(`${retired}.`)),
        false,
        retired,
      );
    }
    // Every advertised operation resolves to a reviewed record naming the
    // method and path that serve it — that record is what api-contracts.test.ts
    // binds to a route.ts on disk, so an id here can be resolved to a request
    // without probing arbitrary paths.
    for (const id of envelope.operations as string[]) {
      const operation = clientV1Operation(id);
      assert.ok(operation, `advertised operation ${id} has no reviewed record`);
      assert.ok(operation.path.startsWith("/api/client/v1/"), operation.path);
    }
    // Health advertises its own operation. It is the only one a client can
    // invoke before pairing, so omitting it would leave the entry point out of
    // the inventory a client reads at exactly that moment.
    assert.equal(envelope.operations.includes("health.read"), true);
    // The `.admin.` infix is the wire-visible authority marker: those
    // operations need the Cave's own sidecar token and a paired bearer will
    // never satisfy them, whatever scopes it holds.
    assert.deepEqual(
      (envelope.operations as string[]).filter((id) => id.includes(".admin.")),
      [
        "pairing.admin.list",
        "pairing.admin.decide",
        "credentials.admin.list",
        "credentials.admin.revoke",
        "status.admin.read",
      ],
    );
  });
});
