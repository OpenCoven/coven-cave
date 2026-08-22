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

  // The cleanup runs first inside the signal handler, so an ownership refusal
  // there would escape it and kill the process before PTY children are
  // terminated and the listener is closed — leaving behind the record this is
  // supposed to remove. The guard could not throw on win32 until it learned to
  // read a DACL; the cleanup must absorb it.
  const cleanup =
    /function cleanupStandaloneClientV1Discovery\(\): void \{[\s\S]*?\n\}/.exec(source);
  assert.ok(cleanup, "server.ts must define cleanupStandaloneClientV1Discovery");
  assert.match(
    cleanup![0],
    /try \{\s*removeStandaloneClientV1DiscoveryRecord\(CLIENT_V1_DISCOVERY_NONCE\);\s*\} catch/,
    "an ownership refusal must skip the unlink, never abort shutdown",
  );
  const shutdown = /function shutdownHttpServer\(\): void \{[\s\S]*?\n\}/.exec(source);
  assert.ok(shutdown, "server.ts must define shutdownHttpServer");
  assert.ok(
    shutdown![0].indexOf("cleanupStandaloneClientV1Discovery()")
      < shutdown![0].indexOf("terminatePtySessions()"),
    "cleanup runs before PTY teardown, which is why it must not be able to throw",
  );
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

  const moduleSource = await readFile(
    resolve(process.cwd(), "src/lib/server/client-v1/path-ownership.ts"),
    "utf8",
  );

  // Compare every part of the copy that can drift, not just the PowerShell.
  // The script text alone leaves three holes, each of which silently disarms
  // the standalone server while this test stays green: the trusted-SID
  // constants (the script names them by IDENTIFIER, so changing a value in one
  // file only is invisible to a text compare), the JS-side verification that
  // turns the report into a refusal, and the ACE filter inside it.
  const region = (text: string, what: string, pattern: RegExp): string => {
    const match = pattern.exec(text);
    assert.ok(match, `${what} must define ${pattern.source.slice(0, 40)}…`);
    return (match![1] ?? match![0])!;
  };
  const parts: [string, RegExp][] = [
    ["the inlined ACL script", /const WINDOWS_ACL_SCRIPT = `([\s\S]*?)`;/],
    ["the trusted SYSTEM SID", /const WINDOWS_SYSTEM_SID = "([^"]+)";/],
    ["the trusted Administrators SID", /const WINDOWS_ADMINISTRATORS_SID = "([^"]+)";/],
    ["the trusted-principal set", /const trusted = new Set\(\[[^\]]*\]\);/],
    [
      "the exclusivity findings",
      /if \(report\.owner !== report\.self\) \{[\s\S]*?if \(foreign\.length > 0\) \{[\s\S]*?\n {2}\}/,
    ],
    // The waiver (cave-37fxr) is the one thing in here that can ADMIT a path,
    // so a copy that drifts is a copy that opts out on terms the module never
    // agreed to — a laxer token, a shorter reason, a note that forgets to say
    // a read-and-shared DACL is not covered.
    ["the waiver variable", /const UNVERIFIED_OWNERSHIP_ENV = "([^"]+)";/],
    ["the waiver reason variable", /const UNVERIFIED_OWNERSHIP_REASON_ENV = "([^"]+)";/],
    ["the waiver token", /const UNVERIFIED_OWNERSHIP_TOKEN = "([^"]+)";/],
    ["the minimum reason length", /const UNVERIFIED_OWNERSHIP_MIN_REASON = (\d+);/],
    ["the waiver resolver", /function resolveUnverifiedOwnershipWaiver\([\s\S]*?\n\}/],
    ["the unreadable-DACL refusal", /function unverifiableOwnershipRefusal\([\s\S]*?\n\}/],
    ["the waived-path disclosure", /function unverifiedOwnershipDisclosure\([\s\S]*?\n\}/],
    ["the shared-DACL refusal", /function sharedOwnershipRefusal\([\s\S]*?\n\}/],
  ];
  for (const [what, pattern] of parts) {
    assert.equal(
      region(source, "server.ts", pattern),
      region(moduleSource, "path-ownership.ts", pattern),
      `${what} must stay identical to the module server.mjs cannot import`,
    );
  }
  assert.match(
    source,
    /if \(findings\.length > 0\) \{\s*throw new Error\(/,
    "the standalone server must refuse on any finding, not merely collect them",
  );
});

test("a client-v1 discovery failure degrades that surface instead of killing the server", async () => {
  // cave-37fxr. The guard learning to read a DACL made it able to throw on
  // win32 for the first time, and `server.listen`'s handler answered that with
  // `server.close(() => process.exit(1))` — so a host where the DACL cannot be
  // read at all could not start Cave, with no remedy reachable from inside the
  // app. Measured on Windows 11: PowerShell in Constrained Language Mode exits
  // 1 with `MethodInvocationNotSupportedInConstrainedLanguage`, and a
  // `powershell.exe` absent from %SystemRoot% exits with ENOENT.
  //
  // Refusing to PUBLISH is still right; refusing to BOOT never was. Client v1
  // is the only surface the record serves, and the request-side guard refuses
  // every client v1 call on such a host anyway, so withholding the record
  // costs exactly the surface that cannot be secured and nothing else.
  const source = await readFile(resolve(process.cwd(), "server.ts"), "utf8");

  const listenBlock = /server\.listen\(port, hostname, \(\) => \{[\s\S]*?\n\}\);/.exec(source);
  assert.ok(listenBlock, "server.ts must define the listener-readiness callback");
  const handler = listenBlock![0];
  assert.doesNotMatch(
    handler,
    /process\.exit/,
    "a discovery failure must not exit the process: the whole app is not client v1",
  );
  assert.match(
    handler,
    /catch \(error\) \{\s*reportClientV1DiscoveryUnavailable\(error\)/,
    "the failure must go to the loud reporter",
  );
  assert.match(
    handler,
    /Ready on/,
    "the server still announces readiness — everything but client v1 is running",
  );

  const reporter =
    /function reportClientV1DiscoveryUnavailable\([\s\S]*?\n\}/.exec(source);
  assert.ok(reporter, "server.ts must define reportClientV1DiscoveryUnavailable");
  assert.match(
    reporter![0],
    /clientV1DiscoveryPublished = false/,
    "an unpublished record must never be treated as published, or shutdown unlinks a file it does not own",
  );
  assert.match(
    reporter![0],
    /console\.error/,
    "the degraded state has to be loud: it is the only thing standing in for the crash",
  );
  assert.match(
    reporter![0],
    /CLIENT V1 DISABLED/,
    "the banner must name what is off, not merely that something failed",
  );
  assert.match(
    reporter![0],
    /UNVERIFIED_OWNERSHIP_ENV/,
    "the banner must name the waiver, which is the only remedy on a host that cannot read a DACL",
  );
});
