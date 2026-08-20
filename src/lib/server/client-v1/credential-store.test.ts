import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CLIENT_V1_CREDENTIAL_STORE_FILE,
  createCredentialStore,
} from "./credential-store.ts";

const credentialInput = {
  appName: "OpenCoven Mobile",
  installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
  scopes: ["chat:read" as const],
};

async function withCredentialRoot(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "cave-client-v1-credentials-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("issued bearers are high-entropy URL-safe values and never persist raw", async () => {
  await withCredentialRoot(async (root) => {
    const store = createCredentialStore({ root, now: () => 1_000 });
    const issued = await store.issue(credentialInput);

    assert.match(issued.bearer, /^[A-Za-z0-9_-]{43}$/);
    const raw = await store.readPersistedFile();
    assert.equal(raw.includes(issued.bearer), false);

    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, 1);
    assert.match(parsed.credentials[0].bearerHash, /^[a-f0-9]{64}$/);
    assert.notEqual(parsed.credentials[0].bearerHash, issued.bearer);

    const file = join(root, CLIENT_V1_CREDENTIAL_STORE_FILE);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(root), [CLIENT_V1_CREDENTIAL_STORE_FILE]);
  });
});

test("credentials and revocation state survive reload and revoked credentials fail verification", async () => {
  await withCredentialRoot(async (root) => {
    let now = 2_000;
    const issuingStore = createCredentialStore({ root, now: () => now });
    const issued = await issuingStore.issue(credentialInput);

    const reloadedStore = createCredentialStore({ root, now: () => now });
    const reloaded = await reloadedStore.reload();
    assert.equal(reloaded.get(issued.credential.id)?.installationId, credentialInput.installationId);
    assert.equal(await reloadedStore.verify(issued.credential.id, issued.bearer), true);

    now = 3_000;
    await reloadedStore.revoke(issued.credential.id, "user_requested");

    const restartedStore = createCredentialStore({ root, now: () => now });
    const revoked = await restartedStore.reload();
    assert.equal(revoked.get(issued.credential.id)?.revocationReason, "user_requested");
    assert.equal(revoked.get(issued.credential.id)?.revokedAt, 3_000);
    assert.equal(await restartedStore.verify(issued.credential.id, issued.bearer), false);
    assert.equal(await restartedStore.findByBearer(issued.bearer), null);
  });
});

test("revocation remains authoritative across stale store instances", async () => {
  await withCredentialRoot(async (root) => {
    let staleNow = 1_000;
    const staleStore = createCredentialStore({ root, now: () => staleNow });
    const issued = await staleStore.issue(credentialInput);

    const authorityStore = createCredentialStore({ root, now: () => 2_000 });
    await authorityStore.reload();
    await authorityStore.revoke(issued.credential.id, "user_requested");

    staleNow = 61_000;
    assert.equal(await staleStore.verify(issued.credential.id, issued.bearer), false);
    assert.equal(await staleStore.findByBearer(issued.bearer), null);

    const persisted = await authorityStore.reload();
    assert.equal(persisted.get(issued.credential.id)?.revokedAt, 2_000);
    assert.equal(
      persisted.get(issued.credential.id)?.revocationReason,
      "user_requested",
    );
  });
});

test("findByBearer performs bearer-only active lookup without accepting hash-prefix near misses", async () => {
  await withCredentialRoot(async (root) => {
    let now = 4_000;
    const store = createCredentialStore({ root, now: () => now });
    const first = await store.issue(credentialInput);
    const second = await store.issue({
      ...credentialInput,
      installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c",
    });

    assert.equal((await store.findByBearer(first.bearer))?.id, first.credential.id);
    assert.equal((await store.findByBearer(second.bearer))?.id, second.credential.id);
    const nearMiss = `${first.bearer.slice(0, -1)}${first.bearer.endsWith("A") ? "B" : "A"}`;
    assert.equal(await store.findByBearer(nearMiss), null);

    now = 5_000;
    await store.revoke(first.credential.id, "rotated");
    assert.equal(await store.findByBearer(first.bearer), null);
  });
});

test("credential persistence stays atomic and leaves no temporary files", async () => {
  await withCredentialRoot(async (root) => {
    let now = 6_000;
    const store = createCredentialStore({ root, now: () => now });
    const issued = await store.issue(credentialInput);
    now = 7_000;
    await store.revoke(issued.credential.id, "rotated");

    const entries = await readdir(root);
    assert.deepEqual(entries, [CLIENT_V1_CREDENTIAL_STORE_FILE]);
    const raw = await store.readPersistedFile();
    assert.doesNotThrow(() => JSON.parse(raw));
  });
});

test("malformed persisted JSON is rejected and never overwritten by issue", async () => {
  await withCredentialRoot(async (root) => {
    const path = join(root, CLIENT_V1_CREDENTIAL_STORE_FILE);
    const malformed = "{\"version\":1,\"credentials\":[";
    await writeFile(path, malformed, { encoding: "utf8", mode: 0o600 });

    const store = createCredentialStore({ root, now: () => 8_000 });
    await assert.rejects(
      store.issue(credentialInput),
      /credential store contains malformed JSON/i,
    );
    assert.equal(await readFile(path, "utf8"), malformed);
  });
});

test("invalid persisted record schema is rejected before a cached mutation can overwrite it", async () => {
  await withCredentialRoot(async (root) => {
    const store = createCredentialStore({ root, now: () => 9_000 });
    const issued = await store.issue(credentialInput);
    const path = join(root, CLIENT_V1_CREDENTIAL_STORE_FILE);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    parsed.credentials[0].bearerHash = "not-a-full-sha256-hash";
    const invalid = JSON.stringify(parsed, null, 2);
    await writeFile(path, invalid, { encoding: "utf8", mode: 0o600 });

    await assert.rejects(
      store.revoke(issued.credential.id, "user_requested"),
      /invalid credential record at index 0/i,
    );
    assert.equal(await readFile(path, "utf8"), invalid);
  });
});

test("persisted read failures are explicit and never overwritten by mutation", async () => {
  await withCredentialRoot(async (root) => {
    const healthyStore = createCredentialStore({ root, now: () => 10_000 });
    await healthyStore.issue(credentialInput);
    const path = join(root, CLIENT_V1_CREDENTIAL_STORE_FILE);
    const original = await readFile(path, "utf8");
    const readFailure = Object.assign(
      new Error("deterministic injected read failure"),
      { code: "EIO" },
    );
    const failingStore = createCredentialStore({
      root,
      now: () => 11_000,
      readFile: async () => {
        throw readFailure;
      },
    });

    await assert.rejects(
      failingStore.issue({
        ...credentialInput,
        installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /failed to read client v1 credential store/i);
        assert.equal(error.cause, readFailure);
        return true;
      },
    );
    assert.equal(await readFile(path, "utf8"), original);
  });
});

test("lastUsedAt persistence is coalesced to at most once per minute per credential", async () => {
  await withCredentialRoot(async (root) => {
    let now = 10_000;
    const store = createCredentialStore({ root, now: () => now });
    const issued = await store.issue(credentialInput);

    now = 11_000;
    assert.equal(await store.verify(issued.credential.id, issued.bearer), true);
    const firstUseFile = await store.readPersistedFile();
    assert.equal((await store.reload()).get(issued.credential.id)?.lastUsedAt, 11_000);

    now = 70_999;
    assert.equal(await store.verify(issued.credential.id, issued.bearer), true);
    assert.equal(await store.readPersistedFile(), firstUseFile);

    now = 71_000;
    assert.equal(await store.verify(issued.credential.id, issued.bearer), true);
    assert.equal((await store.reload()).get(issued.credential.id)?.lastUsedAt, 71_000);
  });
});
