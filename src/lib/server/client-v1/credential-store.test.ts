import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

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

/**
 * Assert an owner-only POSIX mode where the platform actually enforces one.
 *
 * Windows does not implement POSIX permission bits: `stat` reports 0o666 for
 * every regular file and 0o777 for every directory whatever mode `mkdir`/`open`
 * was given, so asserting 0o600/0o700 there measures the platform rather than
 * the store. Same treatment as the symlink guards below — skip only the
 * assertion the platform cannot answer, keeping every other assertion in the
 * test live everywhere and the mode contract unweakened on POSIX.
 */
function assertOwnerOnlyMode(
  t: TestContext,
  mode: number,
  expected: number,
  what: string,
): void {
  if (process.platform === "win32") {
    t.diagnostic(`skipped ${what} mode assertion: POSIX permission bits are not enforced on win32`);
    return;
  }
  assert.equal(mode & 0o777, expected, what);
}

function isUnsupportedSymlinkError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOSYS"
    || code === "ENOTSUP"
    || code === "EOPNOTSUPP"
    || (process.platform === "win32" && (code === "EPERM" || code === "EACCES"));
}

test("first operation creates a private configured root", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "cave-client-v1-root-parent-"));
  const root = join(parent, "credentials");
  try {
    await createCredentialStore({ root }).reload();
    const metadata = await stat(root);
    assert.equal(metadata.isDirectory(), true);
    assertOwnerOnlyMode(t, metadata.mode, 0o700, "credential store root");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("credential file symlinks are rejected instead of followed", async (t) => {
  await withCredentialRoot(async (root) => {
    const target = join(root, "credential-target.json");
    const storePath = join(root, CLIENT_V1_CREDENTIAL_STORE_FILE);
    await writeFile(target, JSON.stringify({ version: 1, credentials: [] }), {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await symlink(target, storePath, "file");
    } catch (error) {
      if (isUnsupportedSymlinkError(error)) {
        t.skip(`file symlinks are unsupported on this platform (${(error as NodeJS.ErrnoException).code})`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      createCredentialStore({ root }).reload(),
      /credential store file must be a regular file, not a symlink/i,
    );
  });
});

test("issued bearers are high-entropy URL-safe values and never persist raw", async (t) => {
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
    assertOwnerOnlyMode(t, (await stat(file)).mode, 0o600, "credential store file");
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

test("concurrent real-root and symlink-alias operations preserve revocation authority", async (t) => {
  await withCredentialRoot(async (root) => {
    const alias = `${root}-alias`;
    let aliasCreated = false;
    try {
      try {
        await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
        aliasCreated = true;
      } catch (error) {
        if (isUnsupportedSymlinkError(error)) {
          t.skip(`symlink aliases are unsupported on this platform (${(error as NodeJS.ErrnoException).code})`);
          return;
        }
        throw error;
      }

      const issuingStore = createCredentialStore({ root, now: () => 1_000 });
      const issued = await issuingStore.issue(credentialInput);

      let announceAliasSnapshot!: () => void;
      const aliasSnapshotLoaded = new Promise<void>((resolve) => {
        announceAliasSnapshot = resolve;
      });
      let releaseAliasRead!: () => void;
      const aliasReadRelease = new Promise<void>((resolve) => {
        releaseAliasRead = resolve;
      });
      const aliasStore = createCredentialStore({
        root: alias,
        now: () => 61_000,
        readFile: async (path, encoding) => {
          const snapshot = await readFile(path, encoding);
          announceAliasSnapshot();
          await aliasReadRelease;
          return snapshot;
        },
      });

      const verification = aliasStore.verify(issued.credential.id, issued.bearer);
      await aliasSnapshotLoaded;

      let authorityReadStarted = false;
      const authorityStore = createCredentialStore({
        root,
        now: () => 2_000,
        readFile: async (path, encoding) => {
          authorityReadStarted = true;
          return readFile(path, encoding);
        },
      });
      const revocation = authorityStore.revoke(
        issued.credential.id,
        "user_requested",
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      if (authorityReadStarted) await revocation;
      releaseAliasRead();
      assert.equal(await verification, true);
      await revocation;

      const persisted = await createCredentialStore({ root }).reload();
      assert.equal(persisted.get(issued.credential.id)?.revokedAt, 61_000);
      assert.equal(
        persisted.get(issued.credential.id)?.revocationReason,
        "user_requested",
      );
    } finally {
      if (aliasCreated) {
        await rm(alias, { force: true });
      }
    }
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

test("a colliding temporary file remains unchanged when exclusive creation fails", async () => {
  await withCredentialRoot(async (root) => {
    const temporaryBytes = Buffer.from("a1b2c3d4e5f6", "hex");
    const storePath = join(root, CLIENT_V1_CREDENTIAL_STORE_FILE);
    const temporaryPath = `${storePath}.${process.pid}.${temporaryBytes.toString("hex")}.tmp`;
    const existing = "pre-existing temporary file";
    await writeFile(temporaryPath, existing, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });

    const store = createCredentialStore({
      root,
      now: () => 7_500,
      temporaryRandomBytes: (size) => {
        assert.equal(size, temporaryBytes.byteLength);
        return Buffer.from(temporaryBytes);
      },
    });

    await assert.rejects(
      store.issue(credentialInput),
      (error: unknown) => {
        assert.equal((error as NodeJS.ErrnoException).code, "EEXIST");
        return true;
      },
    );
    assert.equal(await readFile(temporaryPath, "utf8"), existing);
  });
});

test("a failing post-commit chmod neither rejects issue nor yields a second credential", async (t) => {
  await withCredentialRoot(async (root) => {
    const physicalRoot = await realpath(root);
    const attempted: Array<[string, number]> = [];
    const store = createCredentialStore({
      root,
      now: () => 11_000,
      chmodCommittedFile: async (path, mode) => {
        attempted.push([path, mode]);
        throw Object.assign(new Error("chmod refused"), { code: "EPERM" });
      },
    });

    // The rename is the commit point, so nothing after it may surface as a
    // rejection. The exchange route reads a rejected issue() as "issuing
    // failed", restores the consumed pairing, and the client's retry then
    // appends a SECOND live bearer for one administrator approval — two live
    // credentials that one revocation does not clear.
    const issued = await store.issue(credentialInput);
    const path = join(physicalRoot, CLIENT_V1_CREDENTIAL_STORE_FILE);
    assert.deepEqual(attempted, [[path, 0o600]], "the post-commit repair ran and threw");

    const persisted = JSON.parse(await readFile(path, "utf8"));
    assert.equal(persisted.credentials.length, 1);
    assert.equal(persisted.credentials[0].id, issued.credential.id);

    // Swallowing that failure must not weaken the mode contract: the temporary
    // file already carried 0o600 through the rename, which is exactly why the
    // repair is redundant enough to swallow.
    assertOwnerOnlyMode(t, (await stat(path)).mode, 0o600, "credential store file");

    const restarted = createCredentialStore({ root, now: () => 11_000 });
    const records = await restarted.reload();
    assert.equal(records.size, 1, "one approval issued exactly one credential");
    assert.equal(await restarted.verify(issued.credential.id, issued.bearer), true);
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

test("revokedAt requires a non-empty revocationReason and issue never overwrites invalid records", async (t) => {
  for (const revocationReason of [null, ""] as const) {
    await t.test(
      revocationReason === null ? "null reason" : "empty reason",
      async () => {
        await withCredentialRoot(async (root) => {
          const store = createCredentialStore({ root, now: () => 10_000 });
          await store.issue(credentialInput);
          const path = join(root, CLIENT_V1_CREDENTIAL_STORE_FILE);
          const parsed = JSON.parse(await readFile(path, "utf8"));
          parsed.credentials[0].revokedAt = 11_000;
          parsed.credentials[0].revocationReason = revocationReason;
          const invalid = JSON.stringify(parsed, null, 2);
          await writeFile(path, invalid, { encoding: "utf8", mode: 0o600 });

          await assert.rejects(
            store.issue({
              ...credentialInput,
              installationId: "5e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5c",
            }),
            /invalid credential record at index 0/i,
          );
          assert.equal(await readFile(path, "utf8"), invalid);
        });
      },
    );
  }
});

test("revocationReason without revokedAt is rejected before mutation can overwrite it", async () => {
  await withCredentialRoot(async (root) => {
    const store = createCredentialStore({ root, now: () => 12_000 });
    const issued = await store.issue(credentialInput);
    const path = join(root, CLIENT_V1_CREDENTIAL_STORE_FILE);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    parsed.credentials[0].revokedAt = null;
    parsed.credentials[0].revocationReason = "user_requested";
    const invalid = JSON.stringify(parsed, null, 2);
    await writeFile(path, invalid, { encoding: "utf8", mode: 0o600 });

    await assert.rejects(
      store.revoke(issued.credential.id, "rotated"),
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

test("refuses a credential store a foreign Windows principal can write", async () => {
  // The severe half of the defect: an attacker who can write this file injects
  // a record with a bearerHash of their choosing and any scopes, which mints
  // full authority with no pairing and no admin approval. On win32 nothing
  // stopped that — `process.getuid` is undefined, `lstat` reports uid 0, and
  // `chmod(0o600)` only toggles the read-only bit. Injecting the platform keeps
  // the branch under test on the POSIX runners, where it is otherwise dead.
  const exclusive = {
    self: "S-1-5-21-11-22-33-1001",
    owner: "S-1-5-21-11-22-33-1001",
    protected: true,
    repaired: false,
    removed: [],
    aces: [{ sid: "S-1-5-21-11-22-33-1001", type: "Allow" }],
  };
  const windows = (aces: { sid: string; type: string }[]) => ({
    platform: "win32" as const,
    getuid: null,
    warn: () => {},
    probeWindowsAcl: async () => ({ ...exclusive, aces }),
  });
  const shared = [
    { sid: "S-1-5-21-11-22-33-1001", type: "Allow" },
    { sid: "S-1-5-32-545", type: "Allow" },
  ];

  await withCredentialRoot(async (root) => {
    const store = createCredentialStore({ root, ownership: windows(shared) });
    await assert.rejects(
      store.issue(credentialInput),
      /Client v1 credential store root is not exclusive to the current user/,
    );
    await assert.rejects(store.reload(), /is not exclusive to the current user/);
    await assert.rejects(
      readFile(join(root, CLIENT_V1_CREDENTIAL_STORE_FILE), "utf8"),
      { code: "ENOENT" },
      "a refused store must not have been written",
    );
  });

  await withCredentialRoot(async (root) => {
    const store = createCredentialStore({ root, ownership: windows(exclusive.aces) });
    const issued = await store.issue(credentialInput);
    assert.equal(
      await store.verify(issued.credential.id, issued.bearer),
      true,
      "an exclusive Windows path must still issue and verify",
    );
  });
});

test("refuses a planted credential file a foreign Windows principal can write", async () => {
  // The root can be exclusive while the file is not — a record planted before
  // the directory was ever restricted keeps its own inherited DACL. This is the
  // attack in its most direct form: a valid-looking record whose bearerHash the
  // attacker chose, sitting where the store will read it.
  const exclusive = {
    self: "S-1-5-21-11-22-33-1001",
    owner: "S-1-5-21-11-22-33-1001",
    protected: true,
    repaired: false,
    removed: [],
    aces: [{ sid: "S-1-5-21-11-22-33-1001", type: "Allow" }],
  };

  await withCredentialRoot(async (root) => {
    const path = join(await realpath(root), CLIENT_V1_CREDENTIAL_STORE_FILE);
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        credentials: [{
          id: "planted",
          appName: "Attacker",
          installationId: "planted-installation",
          scopes: ["chat:read"],
          bearerHash: "a".repeat(64),
          createdAt: 1,
          lastUsedAt: null,
          revokedAt: null,
          revocationReason: null,
        }],
      }),
    );

    const store = createCredentialStore({
      root,
      ownership: {
        platform: "win32" as const,
        getuid: null,
        warn: () => {},
        // Only the file is shared; the root passes, so nothing but the file
        // check can produce this refusal.
        probeWindowsAcl: async (probed: string) => ({
          ...exclusive,
          aces: probed === path
            ? [...exclusive.aces, { sid: "S-1-5-32-545", type: "Allow" }]
            : exclusive.aces,
        }),
      },
    });

    await assert.rejects(
      store.reload(),
      /Client v1 credential store file is not exclusive to the current user/,
    );
    await assert.rejects(
      store.findByBearer("anything"),
      /Client v1 credential store file is not exclusive to the current user/,
    );
  });
});
