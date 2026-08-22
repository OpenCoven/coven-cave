import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";

import {
  CLIENT_V1_DISCOVERY_FILE,
  clientV1DiscoveryPath,
  publishClientV1DiscoveryRecord,
  removeClientV1DiscoveryRecord,
  validateClientV1DiscoveryRecord,
} from "./discovery.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-discovery-");

async function withOwnedRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(scratchPrefix);
  try {
    await run(root);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    endpoint: "http://127.0.0.1:3020",
    pid: process.pid,
    nonce: "discovery-nonce-1",
    startedAt: "2026-08-20T20:20:12.617Z",
    ...overrides,
  };
}

/**
 * Assert an owner-only POSIX mode where the platform actually enforces one.
 *
 * Windows does not implement POSIX permission bits: `stat` reports 0o666 for
 * every regular file and 0o777 for every directory whatever mode `mkdir`/`open`
 * was given, so asserting 0o600/0o700 there measures the platform rather than
 * the publisher. Same treatment as the symlink guards below — skip only the
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

function unsupportedSymlink(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOSYS"
    || code === "ENOTSUP"
    || code === "EOPNOTSUPP"
    || (process.platform === "win32" && (code === "EPERM" || code === "EACCES"));
}

test("validates live version-1 discovery records at path-free loopback endpoints", () => {
  for (const endpoint of [
    "http://127.0.0.1:3020",
    "http://localhost:3000",
    "http://[::1]:4100",
  ]) {
    assert.deepEqual(
      validateClientV1DiscoveryRecord(record({ endpoint }), {
        isProcessAlive: (pid) => pid === process.pid,
      }),
      record({ endpoint }),
    );
  }

  for (const endpoint of [
    "https://127.0.0.1:3020",
    "http://0.0.0.0:3020",
    "http://192.168.1.4:3020",
    "http://user@127.0.0.1:3020",
    "http://127.0.0.1:3020/client",
    "http://127.0.0.1:3020?secret=value",
    "http://127.0.0.1:3020#fragment",
    "http://127.0.0.1:3020/%2fclient",
    "http://127.0.0.1:3020/%5Cclient",
    "http://127.0.0.1",
  ]) {
    assert.throws(
      () => validateClientV1DiscoveryRecord(record({ endpoint })),
      /discovery endpoint/i,
      endpoint,
    );
  }

  for (const invalid of [
    record({ version: 2 }),
    record({ pid: 0 }),
    record({ nonce: "" }),
    record({ startedAt: "0" }),
    record({ startedAt: "not-a-timestamp" }),
  ]) {
    assert.throws(
      () => validateClientV1DiscoveryRecord(invalid),
      /client v1 discovery/i,
    );
  }
  assert.throws(
    () => validateClientV1DiscoveryRecord(record({ pid: 999_999 }), {
      isProcessAlive: () => false,
    }),
    /live process/i,
  );
});

test("publishes atomically with owner-only modes and no leftover temporary files", async (t) => {
  await withOwnedRoot(async (root) => {
    const published = await publishClientV1DiscoveryRecord(record(), { root });
    const path = clientV1DiscoveryPath(root);

    assert.equal(path, join(root, CLIENT_V1_DISCOVERY_FILE));
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), published);
    assertOwnerOnlyMode(t, (await stat(root)).mode, 0o700, "discovery root");
    assertOwnerOnlyMode(t, (await stat(path)).mode, 0o600, "discovery record");
    assert.deepEqual(await readdir(root), [CLIENT_V1_DISCOVERY_FILE]);
  });
});

test("rejects symlink and non-regular discovery targets", async (t) => {
  await withOwnedRoot(async (root) => {
    const path = clientV1DiscoveryPath(root);
    const target = join(root, "target.json");
    await writeFile(target, JSON.stringify(record()), { mode: 0o600 });
    try {
      await symlink(target, path, "file");
    } catch (error) {
      if (unsupportedSymlink(error)) {
        t.skip(`file symlinks are unsupported (${(error as NodeJS.ErrnoException).code})`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      publishClientV1DiscoveryRecord(record(), { root }),
      /regular file, not a symlink/i,
    );
    assert.equal((await lstat(path)).isSymbolicLink(), true);
  });

  await withOwnedRoot(async (root) => {
    const path = clientV1DiscoveryPath(root);
    await writeFile(join(root, "keep"), "keep");
    await rm(path, { force: true });
    await import("node:fs/promises").then(({ mkdir }) => mkdir(path));
    await assert.rejects(
      publishClientV1DiscoveryRecord(record(), { root }),
      /regular file/i,
    );
  });
});

test("rejects a configured discovery root that is itself a symlink", async (t) => {
  await withOwnedRoot(async (parent) => {
    const realRoot = join(parent, "real-root");
    const aliasRoot = join(parent, "alias-root");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(realRoot));
    try {
      await symlink(realRoot, aliasRoot, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (unsupportedSymlink(error)) {
        t.skip(`directory symlinks are unsupported (${(error as NodeJS.ErrnoException).code})`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      publishClientV1DiscoveryRecord(record(), { root: aliasRoot }),
      /root must not be a symlink/i,
    );
  });
});

test("removes only a matching current nonce and preserves replaced records", async () => {
  await withOwnedRoot(async (root) => {
    await publishClientV1DiscoveryRecord(record(), { root });
    assert.equal(
      await removeClientV1DiscoveryRecord({ nonce: "wrong-nonce", root }),
      false,
    );

    const replacement = record({ nonce: "replacement-nonce" });
    await publishClientV1DiscoveryRecord(replacement, { root });
    assert.equal(
      await removeClientV1DiscoveryRecord({ nonce: "discovery-nonce-1", root }),
      false,
    );
    assert.deepEqual(
      JSON.parse(await readFile(clientV1DiscoveryPath(root), "utf8")),
      replacement,
    );

    assert.equal(
      await removeClientV1DiscoveryRecord({ nonce: "replacement-nonce", root }),
      true,
    );
    await assert.rejects(readFile(clientV1DiscoveryPath(root)), { code: "ENOENT" });
    assert.equal(
      await removeClientV1DiscoveryRecord({ nonce: "replacement-nonce", root }),
      false,
    );
  });
});

test("refuses to publish or remove a discovery record a foreign Windows principal can write", async () => {
  // `process.getuid` is undefined on win32 and `lstat` reports uid 0 there, so
  // the ownership guard used to pass unconditionally on the platform this
  // repository develops on. Injecting the platform keeps that branch under test
  // on the POSIX runners, where it is otherwise unreachable.
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
  const shared = [{ sid: "S-1-5-21-11-22-33-1001", type: "Allow" }, {
    sid: "S-1-5-32-545",
    type: "Allow",
  }];

  await withOwnedRoot(async (root) => {
    await assert.rejects(
      publishClientV1DiscoveryRecord(record(), { root, ownership: windows(shared) }),
      /Client v1 discovery root is not exclusive to the current user/,
    );
    await assert.rejects(readFile(clientV1DiscoveryPath(root)), { code: "ENOENT" });
  });

  await withOwnedRoot(async (root) => {
    await publishClientV1DiscoveryRecord(record(), {
      root,
      ownership: windows(exclusive.aces),
    });
    assert.deepEqual(
      JSON.parse(await readFile(clientV1DiscoveryPath(root), "utf8")),
      record(),
      "an exclusive Windows path must still publish",
    );

    // The root is already a verified path by now, so removal trips on the
    // target instead — the module caches only successes, and only per path.
    await assert.rejects(
      removeClientV1DiscoveryRecord({
        nonce: "discovery-nonce-1",
        root,
        ownership: windows(shared),
      }),
      /Client v1 discovery target is not exclusive to the current user/,
    );
    assert.deepEqual(
      JSON.parse(await readFile(clientV1DiscoveryPath(root), "utf8")),
      record(),
      "a refused removal must leave the record in place",
    );
  });
});

test("server lifecycle publishes only from listener readiness and performs nonce-safe shutdown cleanup", async () => {
  const source = await readFile(resolve(process.cwd(), "server.ts"), "utf8");
  const listen = source.indexOf("server.listen(port, hostname");
  const publish = source.indexOf("publishStandaloneClientV1DiscoveryRecord", listen);

  assert.notEqual(listen, -1);
  assert.ok(publish > listen, "discovery publication must occur inside/after listener readiness");
  assert.match(
    source.slice(listen, publish + 240),
    /server\.listen\(port,\s*hostname,\s*\(\)\s*=>\s*\{[\s\S]*publishStandaloneClientV1DiscoveryRecord/,
  );
  assert.match(
    source.slice(listen, publish + 240),
    /publishStandaloneClientV1DiscoveryRecord\(loopbackHttpEndpoint\(hostname,\s*port\)\)/,
    "listener readiness must publish a valid URL for IPv4, localhost, and IPv6 loopback binds",
  );
  assert.match(
    source,
    /removeStandaloneClientV1DiscoveryRecord\(\s*CLIENT_V1_DISCOVERY_NONCE\s*\)/,
  );
  assert.match(source, /process\.once\("SIGINT"/);
  assert.match(source, /process\.once\("SIGTERM"/);
});

test("the standalone server enforces ownership on Windows with this module's script", async () => {
  const source = await readFile(resolve(process.cwd(), "server.ts"), "utf8");

  // `--bundle=false` keeps server.mjs from importing path-ownership.ts, so the
  // guard is inlined; these assertions are what stops the copy rotting back
  // into the version that passed unconditionally on win32.
  assert.doesNotMatch(
    source,
    /typeof process\.getuid === "function" && metadata\.uid !== process\.getuid\(\)/,
    "the standalone owner guard must not short-circuit on a platform without getuid",
  );
  assert.match(
    source,
    /if \(process\.platform !== "win32"\) \{[\s\S]{0,240}?ownership cannot be verified on/,
    "a platform with neither a uid nor a Windows ACL must be refused, not admitted",
  );
  assert.match(source, /assertStandaloneWindowsExclusive\(path, label\)/);

  const script = (text: string, what: string): string => {
    const match = /const WINDOWS_ACL_SCRIPT = `([\s\S]*?)`;/.exec(text);
    assert.ok(match, `${what} must define WINDOWS_ACL_SCRIPT`);
    return match![1]!;
  };
  assert.equal(
    script(source, "server.ts"),
    script(
      await readFile(
        resolve(process.cwd(), "src/lib/server/client-v1/path-ownership.ts"),
        "utf8",
      ),
      "path-ownership.ts",
    ),
    "the inlined ACL script must stay identical to the module it copies",
  );
});
