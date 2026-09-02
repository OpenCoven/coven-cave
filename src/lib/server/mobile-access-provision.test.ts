// Tests for mobile-access-provision (cave-os73): Settings · Phone self-
// provisions the pairing secret in dev instead of dead-ending on
// "run `pnpm mobile:tailscale`".
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  probeWindowsAcl,
  resetClientV1PathOwnershipCache,
  type ClientV1PathOwnershipOptions,
  type ClientV1WindowsAclReport,
} from "./client-v1/path-ownership.ts";
import {
  armMobileAccessSecret,
  loadPersistedMobileAccessSecret,
  mobileAccessSecretFile,
  provisionMobileAccessSecret,
  rearmPersistedMobileAccessSecret,
  retireMobileAccessSecret,
} from "./mobile-access-provision.ts";

function devEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    COVEN_CAVE_MOBILE_STATE_ROOT: mkdtempSync(path.join(tmpdir(), "cave-mobile-")),
    PORT: "3000",
    ...overrides,
  };
}

/** Symlink creation is a privilege on some platforms; skip rather than fail. */
function isUnsupportedSymlinkError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOSYS"
    || code === "ENOTSUP"
    || code === "EOPNOTSUPP"
    || (process.platform === "win32" && (code === "EPERM" || code === "EACCES"));
}

// ── Windows seams (cave-fawvh) ───────────────────────────────────────────────
// This file holds the RAW pairing secret, and `writeFileSync(…, { mode: 0o600 })`
// plus `chmodSync(0o600)` set nothing on win32 — #4852's measured table has
// `mode & 0o777 === 0o666` afterwards, not even the read-only bit. The fix is
// the DACL guard that module already owns, and, exactly as there, every Windows
// assertion below is injected so the Linux runners exercise the same branch.
const WINDOWS_SELF = "S-1-5-21-77-88-99-1001";
const WINDOWS_USERS = "S-1-5-32-545";
const WAIVER_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
const WAIVER_REASON_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
const WAIVER_TOKEN = "i-accept-unverified-path-ownership";

function exclusiveReport(): ClientV1WindowsAclReport {
  return {
    self: WINDOWS_SELF,
    owner: WINDOWS_SELF,
    protected: true,
    repaired: false,
    removed: [],
    aces: [{ sid: WINDOWS_SELF, type: "Allow" }],
  };
}

/** A Windows host as the guard sees one, with a recorder for the probed paths. */
function windowsOwnership(
  probed: string[],
  probe: (target: string) => Promise<ClientV1WindowsAclReport> = async () => exclusiveReport(),
): ClientV1PathOwnershipOptions {
  return {
    platform: "win32",
    getuid: null,
    warn: () => {},
    env: {},
    probeWindowsAcl: async (target) => {
      probed.push(target);
      return probe(target);
    },
  };
}

/**
 * Assert an owner-only POSIX mode where the platform actually enforces one.
 *
 * These two assertions have failed on win32 since this file was written, and
 * that standing red is the signal nobody acted on (cave-fawvh). They are not
 * deleted and not loosened: on POSIX they still assert 0o600/0o700 exactly. On
 * win32 they were measuring the platform rather than the code — `stat` reports
 * 0o666/0o777 there whatever mode was passed — so the real Windows contract is
 * asserted instead, by reading the DACL. Same treatment discovery.test.ts
 * already gives its mode assertions.
 */
function assertRestricted(
  t: TestContext,
  target: string,
  expectedMode: number,
  what: string,
): Promise<void> | void {
  if (process.platform !== "win32") {
    assert.equal(statSync(target).mode & 0o777, expectedMode, what);
    return;
  }
  t.diagnostic(`${what}: POSIX mode bits are inert on win32; asserting the DACL instead`);
  return probeWindowsAcl(target).then((report) => {
    // `repaired` is what makes this non-vacuous. The probe REPAIRS as it reads,
    // so asserting only the state it returns would pass whether or not the code
    // under test had ever restricted anything — the probe would simply have
    // done it here. `repaired: false` says the path was ALREADY exclusive when
    // this assertion arrived, which is the only claim worth making.
    assert.equal(
      report.repaired,
      false,
      `${what} was still inheriting when the test looked; the provisioner did not restrict it`,
    );
    assert.equal(report.owner, report.self, `${what} must be owned by this process`);
    assert.equal(report.protected, true, `${what} DACL must not inherit`);
    for (const ace of report.aces) {
      assert.equal(ace.type, "Allow", `${what} must carry no Deny entry`);
      assert.ok(
        [report.self, "S-1-5-18", "S-1-5-32-544"].includes(ace.sid),
        `${what} grants ${ace.sid}, which is neither this user, SYSTEM, nor Administrators`,
      );
    }
  });
}

test("state file mirrors scripts/mobile-tailscale.sh layout (root/port scoped)", () => {
  // Built with path.join rather than a POSIX literal: the contract is the
  // root/port layout the shell script uses, not the separator, and a literal
  // made this assertion fail on win32 for a reason unrelated to what it tests.
  const file = mobileAccessSecretFile({
    COVEN_CAVE_MOBILE_STATE_ROOT: path.join(path.sep, "tmp", "state-root"),
    PORT: "3007",
  });
  assert.equal(file, path.join(path.sep, "tmp", "state-root", "mobile-tailscale-3007", "access-token"));

  const explicitDir = mobileAccessSecretFile({
    COVEN_CAVE_MOBILE_STATE_DIR: path.join(path.sep, "tmp", "custom-dir"),
  });
  assert.equal(explicitDir, path.join(path.sep, "tmp", "custom-dir", "access-token"));

  const xdg = mobileAccessSecretFile({ XDG_STATE_HOME: path.join(path.sep, "tmp", "xdg-state") });
  assert.equal(
    xdg,
    path.join(path.sep, "tmp", "xdg-state", "coven-cave", "mobile-tailscale-3000", "access-token"),
  );
});

test("provision mints, persists (0600), and is idempotent", async (t: TestContext) => {
  const env = devEnv();
  const first = await provisionMobileAccessSecret(env);
  assert.ok(first && first.length >= 32, "mints a strong secret");

  const file = mobileAccessSecretFile(env);
  assert.equal(readFileSync(file, "utf8").trim(), first);
  await assertRestricted(t, file, 0o600, "secret file");
  await assertRestricted(t, path.dirname(file), 0o700, "state dir");

  assert.equal(await provisionMobileAccessSecret(env), first, "reuses the persisted secret");
  assert.equal(loadPersistedMobileAccessSecret(env), first);
});

test("provision reuses a secret the mobile:tailscale script already persisted", async () => {
  const env = devEnv();
  const file = mobileAccessSecretFile(env);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "script-minted-secret\n", "utf8");
  assert.equal(await provisionMobileAccessSecret(env), "script-minted-secret");
});

test("provision refuses the packaged bundle and e2e runs", async () => {
  assert.equal(await provisionMobileAccessSecret(devEnv({ COVEN_CAVE_BUNDLE: "1" })), null);
  assert.equal(await provisionMobileAccessSecret(devEnv({ COVEN_CAVE_E2E: "1" })), null);
});

test("restricts the state directory and the token file on Windows, where chmod does nothing", async () => {
  const env = devEnv();
  const probed: string[] = [];
  const secret = await provisionMobileAccessSecret(env, {
    ownership: windowsOwnership(probed),
  });
  assert.ok(secret, "an exclusive Windows path still provisions");

  const file = mobileAccessSecretFile(env);
  // The guard probes the realpath'd target (cave-8p0hn): on macOS the mkdtemp
  // path under /var resolves to /private/var, so the pinned paths resolve too.
  assert.deepEqual(
    probed,
    [realpathSync(path.dirname(file)), realpathSync(file)],
    "the directory is restricted BEFORE the secret is written into it, then the file is verified",
  );

  // And the reuse path re-verifies rather than trusting a file because it is
  // already there — that is the upgrade path for every install that ran the
  // version whose chmod did nothing. Reset the per-process verification cache
  // first, since the upgrade this covers happens in a NEW process.
  resetClientV1PathOwnershipCache();
  const again: string[] = [];
  assert.equal(
    await provisionMobileAccessSecret(env, { ownership: windowsOwnership(again) }),
    secret,
  );
  assert.deepEqual(again, [realpathSync(path.dirname(file)), realpathSync(file)]);
});

test("a token file that cannot be restricted is never left on disk", async () => {
  // A shared directory is refused before anything is written.
  const shared = devEnv();
  const sharedProbes: string[] = [];
  assert.equal(
    await provisionMobileAccessSecret(shared, {
      warn: () => {},
      ownership: windowsOwnership(sharedProbes, async () => ({
        ...exclusiveReport(),
        aces: [
          { sid: WINDOWS_SELF, type: "Allow" },
          { sid: WINDOWS_USERS, type: "Allow" },
        ],
      })),
    }),
    null,
    "a state directory another principal can write must not receive a plaintext secret",
  );
  assert.deepEqual(sharedProbes, [realpathSync(path.dirname(mobileAccessSecretFile(shared)))]);
  assert.equal(existsSync(mobileAccessSecretFile(shared)), false);

  // And when only the file itself fails the check, the secret written a moment
  // earlier is removed rather than left readable.
  const late = devEnv();
  const lateFile = mobileAccessSecretFile(late);
  assert.equal(
    await provisionMobileAccessSecret(late, {
      warn: () => {},
      ownership: windowsOwnership([], async (target) => {
        // The directory probe passes; only the token file's probe fails, so
        // the secret written a moment earlier must be removed. The probed
        // paths are the realpath'd ones (cave-8p0hn), and the file does not
        // exist until the mint writes it, so the comparison resolves the dir.
        if (target === realpathSync(path.dirname(lateFile))) return exclusiveReport();
        throw new Error("spawn powershell.exe ENOENT");
      }),
    }),
    null,
  );
  assert.equal(
    existsSync(lateFile),
    false,
    "a plaintext secret must not survive on a path whose ACL could not be verified",
  );
});

test("a symlinked state directory is refused before anything is written into it", async (t: TestContext) => {
  // mkdirSync(recursive) and writeFileSync FOLLOW a reparse point, so a
  // symlinked state dir would land the plaintext secret in a directory whose
  // DACL was never the one verified — and lstat of the link itself reports
  // the current user, so the ownership guard would pass it (cave-8p0hn).
  const env = devEnv();
  const stateDir = path.dirname(mobileAccessSecretFile(env));
  const target = mkdtempSync(path.join(tmpdir(), "cave-mobile-dir-target-"));
  let linked = false;
  try {
    symlinkSync(target, stateDir, process.platform === "win32" ? "junction" : "dir");
    linked = true;
  } catch (error) {
    if (isUnsupportedSymlinkError(error)) {
      t.skip(`directory symlinks are unsupported on this platform (${(error as NodeJS.ErrnoException).code})`);
      return;
    }
    throw error;
  }
  try {
    assert.equal(
      await provisionMobileAccessSecret(env, { warn: () => {} }),
      null,
      "a symlinked state directory must not receive a plaintext secret",
    );
    assert.deepEqual(readdirSync(target), [], "nothing was written through the link");
  } finally {
    if (linked) rmSync(stateDir, { force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

test("a symlinked token file is refused instead of followed", async (t: TestContext) => {
  // The minted secret would be written THROUGH the link to its target, so the
  // file guard must refuse the reparse point rather than verify the link's own
  // (trivially current-user) metadata and hand the secret back (cave-8p0hn).
  const env = devEnv();
  const file = mobileAccessSecretFile(env);
  mkdirSync(path.dirname(file), { recursive: true });
  const targetDir = mkdtempSync(path.join(tmpdir(), "cave-mobile-file-target-"));
  const target = path.join(targetDir, "access-token");
  writeFileSync(target, "decoy\n", "utf8");
  let linked = false;
  try {
    symlinkSync(target, file, "file");
    linked = true;
  } catch (error) {
    if (isUnsupportedSymlinkError(error)) {
      t.skip(`file symlinks are unsupported on this platform (${(error as NodeJS.ErrnoException).code})`);
      return;
    }
    throw error;
  }
  try {
    assert.equal(
      await provisionMobileAccessSecret(env, { warn: () => {} }),
      null,
      "a symlinked token file must not be trusted",
    );
  } finally {
    if (linked) rmSync(file, { force: true });
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test("a refusal to restrict the token path is announced, not swallowed", async () => {
  // The route answers a null with a terse "couldn't set up pairing", so without
  // this the operator sees a broken Settings pane and no reason for it.
  const env = devEnv();
  const warnings: string[] = [];
  assert.equal(
    await provisionMobileAccessSecret(env, {
      warn: (message) => warnings.push(message),
      ownership: windowsOwnership([], async () => {
        throw new Error("Method invocation is supported only on core types in this language mode.");
      }),
    }),
    null,
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /mobile access token/i);
  assert.match(warnings[0]!, /core types in this language mode/);
});

test("the unverified-ownership waiver reaches the mobile token too", async () => {
  // Same hatch, same terms, same disclosure as client v1 (cave-37fxr): a host
  // that cannot read a DACL at all should not lose phone pairing silently, and
  // the operator who accepts that has to say so and be named.
  const env = devEnv();
  const warnings: string[] = [];
  const secret = await provisionMobileAccessSecret(env, {
    ownership: {
      platform: "win32",
      getuid: null,
      warn: (message) => warnings.push(message),
      env: {
        [WAIVER_ENV]: WAIVER_TOKEN,
        [WAIVER_REASON_ENV]: "opsdesk@example.com: WDAC host, PowerShell blocked",
      },
      probeWindowsAcl: async () => {
        throw new Error("spawn powershell.exe ENOENT");
      },
    },
  });
  assert.ok(secret, "the waiver provisions rather than dead-ending pairing");
  assert.equal(readFileSync(mobileAccessSecretFile(env), "utf8").trim(), secret);
  assert.ok(
    warnings.some((message) => /SECURITY WAIVER/.test(message) && /opsdesk@example\.com/.test(message)),
    "the waiver must disclose itself and name the operator",
  );

  // A waiver never covers a DACL that WAS read and found shared, here either.
  const readAndShared = devEnv();
  assert.equal(
    await provisionMobileAccessSecret(readAndShared, {
      warn: () => {},
      ownership: {
        platform: "win32",
        getuid: null,
        warn: () => {},
        env: {
          [WAIVER_ENV]: WAIVER_TOKEN,
          [WAIVER_REASON_ENV]: "opsdesk@example.com: WDAC host, PowerShell blocked",
        },
        probeWindowsAcl: async () => ({
          ...exclusiveReport(),
          aces: [
            { sid: WINDOWS_SELF, type: "Allow" },
            { sid: WINDOWS_USERS, type: "Allow" },
          ],
        }),
      },
    }),
    null,
  );
  assert.equal(existsSync(mobileAccessSecretFile(readAndShared)), false);
});

test("arm sets the request-time gate env", () => {
  const env = devEnv();
  armMobileAccessSecret("s3cret", env);
  assert.equal(env.COVEN_CAVE_ACCESS_TOKEN, "s3cret");
});

test("rearm arms from disk only when tokenless outside the bundle", async () => {
  const env = devEnv();
  const secret = await provisionMobileAccessSecret(env);
  assert.ok(secret);

  assert.equal(rearmPersistedMobileAccessSecret(env), secret, "boot re-arm loads the persisted secret");
  assert.equal(env.COVEN_CAVE_ACCESS_TOKEN, secret);

  const alreadyArmed = devEnv({ COVEN_CAVE_ACCESS_TOKEN: "existing" });
  assert.equal(rearmPersistedMobileAccessSecret(alreadyArmed), null, "existing token wins");
  assert.equal(alreadyArmed.COVEN_CAVE_ACCESS_TOKEN, "existing");

  assert.equal(rearmPersistedMobileAccessSecret(devEnv()), null, "nothing persisted → stays tokenless");

  const bundle = devEnv({ COVEN_CAVE_BUNDLE: "1" });
  assert.equal(rearmPersistedMobileAccessSecret(bundle), null, "bundle never re-arms from dev state");
});

test("retire disarms and removes the persisted secret", async () => {
  const env = devEnv();
  const secret = await provisionMobileAccessSecret(env);
  assert.ok(secret);
  armMobileAccessSecret(secret, env);

  assert.deepEqual(retireMobileAccessSecret(env), { kind: "retired" });
  assert.equal(env.COVEN_CAVE_ACCESS_TOKEN, undefined);
  assert.equal(existsSync(mobileAccessSecretFile(env)), false);
  assert.equal(rearmPersistedMobileAccessSecret(env), null, "next boot stays tokenless");
});

test("retire preserves the armed and persisted credential when removal fails", async () => {
  const env = devEnv();
  const secret = await provisionMobileAccessSecret(env);
  assert.ok(secret);
  armMobileAccessSecret(secret, env);

  const result = retireMobileAccessSecret(env, {
    removeFile: () => {
      throw new Error("read-only filesystem");
    },
  });

  assert.deepEqual(result, {
    kind: "retained",
    error: "read-only filesystem",
  });
  assert.equal(env.COVEN_CAVE_ACCESS_TOKEN, secret);
  assert.equal(loadPersistedMobileAccessSecret(env), secret);
});

test("retiring one dev port preserves competing and packaged credentials", async () => {
  const shared = devEnv();
  const stateRoot = shared.COVEN_CAVE_MOBILE_STATE_ROOT;
  const dev3007 = devEnv({ COVEN_CAVE_MOBILE_STATE_ROOT: stateRoot, PORT: "3007" });
  const dev3008 = devEnv({ COVEN_CAVE_MOBILE_STATE_ROOT: stateRoot, PORT: "3008" });
  const packaged3020 = devEnv({
    COVEN_CAVE_MOBILE_STATE_ROOT: stateRoot,
    COVEN_CAVE_BUNDLE: "1",
    COVEN_CAVE_ACCESS_TOKEN: "packaged-credential",
    PORT: "3020",
  });
  const secret3007 = await provisionMobileAccessSecret(dev3007);
  const secret3008 = await provisionMobileAccessSecret(dev3008);
  assert.ok(secret3007);
  assert.ok(secret3008);
  armMobileAccessSecret(secret3007, dev3007);
  armMobileAccessSecret(secret3008, dev3008);

  retireMobileAccessSecret(dev3007);
  retireMobileAccessSecret(packaged3020);

  assert.equal(existsSync(mobileAccessSecretFile(dev3007)), false);
  assert.equal(loadPersistedMobileAccessSecret(dev3008), secret3008);
  assert.equal(dev3008.COVEN_CAVE_ACCESS_TOKEN, secret3008);
  assert.equal(
    packaged3020.COVEN_CAVE_ACCESS_TOKEN,
    "packaged-credential",
    "app-stop never retires the packaged sidecar credential",
  );
});

// ── Wiring pins ──────────────────────────────────────────────────────────────
// Behavioral seams live above; these pin the route and server wiring so the
// self-provisioning path can't silently detach (repo convention).

test("mobile-handoff route provisions, arms, cookies the session, and retires on stop", () => {
  const route = readFileSync(
    path.join(process.cwd(), "src/app/api/mobile-handoff/route.ts"),
    "utf8",
  );
  assert.match(route, /provisionMobileAccessSecret\(\)/, "route provisions when tokenless");
  assert.match(route, /armMobileAccessSecret\(provisioned\)/, "route arms the gate before the serve route goes live");
  assert.match(route, /withBrowserAccessCookie\(res, req, access\.secret\)/, "provisioning responses carry the signed browser cookie");
  assert.match(route, /ACCESS_TOKEN_COOKIE/, "cookie uses the canonical access-cookie name");
  assert.match(
    route,
    /resetOwnedServeRoute\(\s*nativeAppBackendUrl\(\),\s*retireMobileAccessSecret,\s*\)/,
    "Mobile mode Off passes retirement as the verified-removal callback instead of retiring on reset failure",
  );
});

test("custom server re-arms at boot and reads the token lazily", () => {
  const server = readFileSync(path.join(process.cwd(), "server.ts"), "utf8");
  assert.match(server, /persistedMobileAccessSecretFile/, "boot re-arm reads the persisted state file");
  assert.match(
    server,
    /COVEN_CAVE_BUNDLE !== "1"[\s\S]{0,200}COVEN_CAVE_E2E !== "1"/,
    "re-arm is guarded off in the packaged bundle and e2e",
  );
  assert.match(server, /function accessToken\(\)/, "PTY gate reads the access token lazily");
  assert.doesNotMatch(
    server,
    /const ACCESS_TOKEN = process\.env\.COVEN_CAVE_ACCESS_TOKEN/,
    "no boot-time snapshot — mid-session arming must reach the PTY gate",
  );
});
