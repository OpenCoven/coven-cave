import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  assertClientV1PathOwnership,
  assertExclusivePathOwnershipSync,
  CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS,
  ClientV1PathOwnershipError,
  parseClientV1WindowsAclReport,
  probeWindowsAcl,
  resetClientV1PathOwnershipCache,
  type ClientV1PathOwnershipOptions,
  type ClientV1WindowsAclReport,
} from "./path-ownership.ts";

const SELF_SID = "S-1-5-21-11-22-33-1001";
const SYSTEM_SID = "S-1-5-18";
const ADMINISTRATORS_SID = "S-1-5-32-544";
/** BUILTIN\Users — the shape of ACE a machine-wide profile policy inherits. */
const USERS_SID = "S-1-5-32-545";

function report(
  overrides: Partial<ClientV1WindowsAclReport> = {},
): ClientV1WindowsAclReport {
  return {
    self: SELF_SID,
    owner: SELF_SID,
    protected: true,
    repaired: false,
    removed: [],
    aces: [
      { sid: SELF_SID, type: "Allow" },
      { sid: SYSTEM_SID, type: "Allow" },
      { sid: ADMINISTRATORS_SID, type: "Allow" },
    ],
    ...overrides,
  };
}

/**
 * A Windows host as the module sees one: no `getuid`, `platform` win32.
 *
 * Every Windows assertion below runs on the Linux CI runners too, because the
 * branch under test is unreachable on any machine CI owns — which is exactly
 * how it stayed inert long enough to become an issue. The one test that needs
 * a real DACL says so and skips with a diagnostic elsewhere.
 */
function windows(
  overrides: Partial<ClientV1PathOwnershipOptions> = {},
): ClientV1PathOwnershipOptions {
  return {
    platform: "win32",
    getuid: null,
    warn: () => {},
    // Hermetic by default: the waiver below is read from this env, never the
    // runner's, so one exported variable cannot quietly disarm the suite.
    env: {},
    probeWindowsAcl: async () => report(),
    ...overrides,
  };
}

/** A path unique to one test, so the module-level success cache cannot leak. */
let pathCounter = 0;
function uniquePath(): string {
  pathCounter += 1;
  return `C:\\Users\\test\\.coven\\cave\\probe-${pathCounter}.json`;
}

test("compares uid where the platform has one", async () => {
  await assertClientV1PathOwnership(uniquePath(), { uid: 1000 }, "credential store root", {
    getuid: () => 1000,
  });

  await assert.rejects(
    assertClientV1PathOwnership(uniquePath(), { uid: 1001 }, "credential store root", {
      getuid: () => 1000,
    }),
    /Client v1 credential store root must be owned by the current user\./,
  );
});

test("the sync guard answers POSIX ownership completely (cave-8pd39)", () => {
  assert.doesNotThrow(() =>
    assertExclusivePathOwnershipSync(uniquePath(), { uid: 1000, mode: 0o600 }, "sync subject", {
      getuid: () => 1000,
    }),
  );

  assert.throws(
    () => assertExclusivePathOwnershipSync(uniquePath(), { uid: 1001, mode: 0o600 }, "sync subject", {
      getuid: () => 1000,
    }),
    /sync subject must be owned by the current user\./,
  );

  assert.throws(
    () => assertExclusivePathOwnershipSync(uniquePath(), { uid: 1000, mode: 0o622 }, "sync subject", {
      getuid: () => 1000,
    }),
    /must not be writable by group or others \(mode 622\)/,
  );

  assert.throws(
    () => assertExclusivePathOwnershipSync(uniquePath(), {
      uid: 1000,
      mode: 0o600,
      isSymbolicLink: true,
    }, "sync subject", { getuid: () => 1000 }),
    /must not be a symbolic link/,
  );
});

test("the sync guard refuses a platform it cannot answer synchronously (cave-8pd39)", () => {
  assert.throws(
    () => assertExclusivePathOwnershipSync(uniquePath(), { uid: 0, mode: 0o666 }, "sync subject", {
      platform: "win32",
      getuid: null,
    }),
    /cannot be verified synchronously on win32/,
  );
});

test("refuses a Windows path a foreign principal can write", async () => {
  await assert.rejects(
    assertClientV1PathOwnership(
      uniquePath(),
      { uid: 0 },
      "credential store root",
      windows({
        probeWindowsAcl: async () =>
          report({
            aces: [
              { sid: SELF_SID, type: "Allow" },
              { sid: USERS_SID, type: "Allow" },
            ],
          }),
      }),
    ),
    (error: Error) => {
      assert.match(error.message, /is not exclusive to the current user/);
      assert.match(error.message, new RegExp(`Allow:${USERS_SID}`));
      assert.match(error.message, /inspect it with: icacls/);
      return true;
    },
  );
});

test("refuses a Windows path owned by another principal", async () => {
  await assert.rejects(
    assertClientV1PathOwnership(
      uniquePath(),
      { uid: 0 },
      "discovery target",
      windows({ probeWindowsAcl: async () => report({ owner: "S-1-5-21-11-22-33-1002" }) }),
    ),
    /Client v1 discovery target is not exclusive to the current user: owned by S-1-5-21-11-22-33-1002, not S-1-5-21-11-22-33-1001/,
  );
});

test("refuses a Windows path whose DACL still inherits", async () => {
  await assert.rejects(
    assertClientV1PathOwnership(
      uniquePath(),
      { uid: 0 },
      "discovery root",
      windows({ probeWindowsAcl: async () => report({ protected: false }) }),
    ),
    /its DACL still inherits from the parent/,
  );
});

test("refuses a Windows path carrying a Deny entry for an untrusted principal", async () => {
  await assert.rejects(
    assertClientV1PathOwnership(
      uniquePath(),
      { uid: 0 },
      "discovery root",
      windows({
        probeWindowsAcl: async () =>
          report({ aces: [{ sid: SELF_SID, type: "Allow" }, { sid: USERS_SID, type: "Deny" }] }),
      }),
    ),
    new RegExp(`Deny:${USERS_SID}`),
  );
});

test("refuses when the Windows probe cannot answer, naming the cause", async () => {
  const cause = new Error("spawn powershell.exe ENOENT");
  await assert.rejects(
    assertClientV1PathOwnership(
      uniquePath(),
      { uid: 0 },
      "credential store file",
      windows({
        probeWindowsAcl: async () => {
          throw cause;
        },
      }),
    ),
    (error: Error) => {
      assert.match(
        error.message,
        /Client v1 credential store file ownership could not be verified on Windows: spawn powershell\.exe ENOENT/,
      );
      assert.equal((error as { cause?: unknown }).cause, cause);
      return true;
    },
  );
});

test("refuses a platform that exposes neither a uid nor a Windows ACL", async () => {
  const path = uniquePath();
  await assert.rejects(
    assertClientV1PathOwnership(path, { uid: 0 }, "credential store root", {
      platform: "sunos",
      getuid: null,
    }),
    new RegExp(
      "Client v1 credential store root ownership cannot be verified on sunos: "
      + "this platform exposes neither a uid nor a Windows ACL",
    ),
  );
});

test("admits a repaired Windows path but says so, naming what it revoked", async () => {
  const warnings: string[] = [];
  await assertClientV1PathOwnership(
    uniquePath(),
    { uid: 0 },
    "credential store root",
    windows({
      warn: (message) => warnings.push(message),
      probeWindowsAcl: async () => report({ repaired: true, removed: [USERS_SID] }),
    }),
  );

  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /had no enforced access control on Windows/);
  assert.match(warnings[0]!, new RegExp(`revoked ${USERS_SID}\\.`));
});

test("probes a verified path once and a refused path once per negative TTL (cave-okfb2)", async () => {
  const verified = uniquePath();
  let verifiedProbes = 0;
  const options = windows({
    probeWindowsAcl: async () => {
      verifiedProbes += 1;
      return report();
    },
  });
  await assertClientV1PathOwnership(verified, { uid: 0 }, "discovery root", options);
  await assertClientV1PathOwnership(verified, { uid: 0 }, "discovery root", options);
  assert.equal(verifiedProbes, 1, "a verified path must not re-spawn the probe per request");

  // A refusal is cached for the negative TTL: within the window the cache
  // answers the same refusal without re-spawning the probe, and the
  // operator-facing message is logged once, not once per request (cave-okfb2
  // R6).
  const refused = uniquePath();
  let refusedProbes = 0;
  const refusalWarnings: string[] = [];
  let now = 1_000;
  const refusedOptions = windows({
    now: () => now,
    warn: (message) => refusalWarnings.push(message),
    probeWindowsAcl: async () => {
      refusedProbes += 1;
      return report({ protected: false });
    },
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      assertClientV1PathOwnership(refused, { uid: 0 }, "discovery root", refusedOptions),
      ClientV1PathOwnershipError,
    );
  }
  assert.equal(refusedProbes, 1, "a refused path must answer from the negative cache within the TTL");
  assert.equal(refusalWarnings.length, 1, "the refusal is logged once per TTL window, not per request");

  // After the TTL lapses the probe runs again — that is what lets an
  // out-of-band `icacls /reset` take effect without a restart.
  now += CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS;
  await assert.rejects(
    assertClientV1PathOwnership(refused, { uid: 0 }, "discovery root", refusedOptions),
  );
  assert.equal(refusedProbes, 2, "an expired refusal must re-drive the probe");
  assert.equal(refusalWarnings.length, 2, "the next window logs the refusal again");

  // A repair that lands after the TTL is picked up on the next probe.
  now += CLIENT_V1_OWNERSHIP_REFUSAL_TTL_MS;
  const repairedOptions = windows({
    now: () => now,
    warn: () => {},
    probeWindowsAcl: async () => {
      refusedProbes += 1;
      return report();
    },
  });
  await assertClientV1PathOwnership(refused, { uid: 0 }, "discovery root", repairedOptions);
  assert.equal(refusedProbes, 3, "a repaired path must be admitted on the first post-TTL probe");

  resetClientV1PathOwnershipCache();
  await assertClientV1PathOwnership(verified, { uid: 0 }, "discovery root", options);
  assert.equal(verifiedProbes, 2, "resetting the cache must re-drive the probe");
});

test("refusals carry the distinct ownership error class, and a cache hit re-throws the same object (cave-e7xwk)", async () => {
  const refused = uniquePath();
  let firstError: unknown;
  const options = windows({
    now: () => 1_000,
    probeWindowsAcl: async () => {
      throw new Error("spawn powershell.exe ENOENT");
    },
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      assertClientV1PathOwnership(refused, { uid: 0 }, "credential store root", options),
      (error: unknown) => {
        assert.ok(error instanceof ClientV1PathOwnershipError);
        if (attempt === 0) firstError = error;
        else assert.equal(error, firstError, "a cache hit must re-throw the exact refusal that populated it");
        return true;
      },
    );
  }

  // A DACL that WAS read and found shared is the same distinct class: the
  // auth boundary converts either flavor to the same envelope.
  const shared = uniquePath();
  await assert.rejects(
    assertClientV1PathOwnership(
      shared,
      { uid: 0 },
      "credential store root",
      windows({
        now: () => 1_000,
        probeWindowsAcl: async () =>
          report({ aces: [{ sid: SELF_SID, type: "Allow" }, { sid: USERS_SID, type: "Allow" }] }),
      }),
    ),
    ClientV1PathOwnershipError,
  );
});

test("the real probe restricts and verifies a real path on Windows", async (t: TestContext) => {
  if (process.platform !== "win32") {
    t.skip(
      "the ACL probe is win32-only; the injected-probe tests above cover the same "
      + "branch on every platform",
    );
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "cave-client-v1-acl-"));
  try {
    const planted = join(root, "planted.json");
    await writeFile(planted, "{}");

    const first = await probeWindowsAcl(root);
    assert.equal(first.self, first.owner, "the probe must run as the owner of a path it created");
    assert.equal(first.protected, true, "the directory DACL must end up protected");
    assert.deepEqual(
      [...new Set(first.aces.map((ace) => ace.type))],
      ["Allow"],
      "no Deny entry may survive the repair",
    );
    for (const ace of first.aces) {
      assert.ok(
        [first.self, "S-1-5-18", "S-1-5-32-544"].includes(ace.sid),
        `unexpected principal on the repaired DACL: ${ace.sid}`,
      );
    }

    execFileSync("icacls.exe", [planted, "/setowner", `*${ADMINISTRATORS_SID}`], {
      encoding: "utf8",
      windowsHide: true,
    });
    const ownerRepaired = await probeWindowsAcl(planted);
    assert.equal(ownerRepaired.repaired, true, "a foreign owner must trigger ACL repair");
    assert.equal(
      ownerRepaired.owner,
      ownerRepaired.self,
      "repair must take ownership instead of leaving an Administrators-owned path unusable",
    );

    // Whatever the machine's profile policy inherits, this is what the guard
    // exists to catch: hand an untrusted principal write access and the next
    // probe must both see it and take it away.
    execFileSync("icacls.exe", [planted, "/grant", `*${USERS_SID}:(M)`], {
      encoding: "utf8",
      windowsHide: true,
    });
    const repaired = await probeWindowsAcl(planted);
    assert.equal(repaired.repaired, true, "a foreign grant must be detected");
    assert.ok(
      repaired.removed.includes(USERS_SID),
      `the repair must revoke ${USERS_SID}, revoked: ${repaired.removed.join(", ") || "nothing"}`,
    );
    assert.equal(
      repaired.aces.some((ace) => ace.sid === USERS_SID),
      false,
      "the foreign grant must be gone from the DACL",
    );

    // And the whole assertion, end to end, through the exported guard.
    await assertClientV1PathOwnership(planted, { uid: 0 }, "credential store file", {
      warn: () => {},
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a malformed probe report is refused rather than read as an empty DACL", () => {
  const exclusive = {
    self: SELF_SID,
    owner: SELF_SID,
    protected: true,
    repaired: false,
    removed: [] as unknown[],
    aces: [{ sid: SELF_SID, type: "Allow" }] as unknown[],
  };
  assert.deepEqual(
    parseClientV1WindowsAclReport(JSON.stringify(exclusive)),
    { ...exclusive, removed: [], aces: [{ sid: SELF_SID, type: "Allow" }] },
  );

  // `aces` carries the whole access decision. Coercing an unreadable one to `[]`
  // reads as "no principal has access" and therefore ADMITS the path, so every
  // shape that is not a list has to be an error. The only test that drives the
  // real subprocess is win32-only, so this is where a POSIX runner sees it.
  for (
    const [what, raw] of [
      ["aces absent", JSON.stringify({ ...exclusive, aces: undefined })],
      ["aces a bare object", JSON.stringify({ ...exclusive, aces: { sid: USERS_SID, type: "Allow" } })],
      ["aces a string", JSON.stringify({ ...exclusive, aces: "Allow" })],
      ["removed absent", JSON.stringify({ ...exclusive, removed: undefined })],
      ["self absent", JSON.stringify({ ...exclusive, self: undefined })],
      ["self empty", JSON.stringify({ ...exclusive, self: "" })],
      ["owner absent", JSON.stringify({ ...exclusive, owner: undefined })],
      ["protected a string", JSON.stringify({ ...exclusive, protected: "true" })],
      ["repaired absent", JSON.stringify({ ...exclusive, repaired: undefined })],
      ["a bare array", "[]"],
      ["a bare string", "\"nope\""],
      ["null", "null"],
    ] as const
  ) {
    assert.throws(
      () => parseClientV1WindowsAclReport(raw),
      /malformed report/,
      `${what} must be refused, not defaulted`,
    );
  }

  assert.throws(() => parseClientV1WindowsAclReport("not json at all"), SyntaxError);

  // An entry the probe could not name is untrusted, never trusted-by-omission.
  const nameless = parseClientV1WindowsAclReport(
    JSON.stringify({ ...exclusive, aces: [{}, null, { sid: USERS_SID }] }),
  );
  assert.deepEqual(nameless.aces, [
    { sid: "", type: "" },
    { sid: "", type: "" },
    { sid: USERS_SID, type: "" },
  ]);
});

// ── The unverified-ownership waiver (cave-37fxr) ─────────────────────────────
// A DACL the host cannot read at all is a different condition from a DACL that
// was read and found shared, and only the first one has no remedy from inside
// the app. Measured on Windows 11: PowerShell in Constrained Language Mode
// answers the probe with `MethodInvocationNotSupportedInConstrainedLanguage`
// and exit 1, and a `powershell.exe` absent from %SystemRoot% answers with
// ENOENT — on either host the pre-waiver guard threw at boot and server.ts
// turned that into `process.exit(1)`.
//
// Every assertion below is injectable (`env`, `platform`, `getuid`,
// `probeWindowsAcl`), so the Linux runners exercise the same branch. A
// Windows-only assertion here would be vacuous in CI, which is how the bug
// this file exists for survived in the first place.
const WAIVER_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP";
const WAIVER_REASON_ENV = "COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON";
const WAIVER_TOKEN = "i-accept-unverified-path-ownership";
const WAIVER_REASON = "opsdesk@example.com: WDAC host, PowerShell is blocked";

/** The measured Constrained Language Mode failure, as execFile reports it. */
function constrainedLanguageProbe(): () => Promise<ClientV1WindowsAclReport> {
  return async () => {
    throw new Error(
      "Command failed: powershell.exe\nCannot invoke method. Method invocation is "
      + "supported only on core types in this language mode.\n"
      + "FullyQualifiedErrorId : MethodInvocationNotSupportedInConstrainedLanguage",
    );
  };
}

test("an unreadable DACL is refused by default, and the refusal names the waiver", async () => {
  await assert.rejects(
    assertClientV1PathOwnership(
      uniquePath(),
      { uid: 0 },
      "credential store root",
      windows({ env: {}, probeWindowsAcl: constrainedLanguageProbe() }),
    ),
    (error: Error) => {
      assert.match(error.message, /ownership could not be verified on Windows/);
      assert.match(error.message, /MethodInvocationNotSupportedInConstrainedLanguage/);
      assert.match(error.message, new RegExp(`${WAIVER_ENV}=${WAIVER_TOKEN}`));
      assert.match(error.message, new RegExp(WAIVER_REASON_ENV));
      return true;
    },
  );
});

test("the waiver admits an unreadable DACL, loudly and with the operator's reason", async () => {
  const warnings: string[] = [];
  const path = uniquePath();
  await assertClientV1PathOwnership(
    path,
    { uid: 0 },
    "credential store root",
    windows({
      env: { [WAIVER_ENV]: WAIVER_TOKEN, [WAIVER_REASON_ENV]: WAIVER_REASON },
      warn: (message) => warnings.push(message),
      probeWindowsAcl: constrainedLanguageProbe(),
    }),
  );

  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /UNVERIFIED/);
  assert.match(warnings[0]!, new RegExp(WAIVER_REASON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(warnings[0]!.includes(path), "the disclosure must name the path it waived");
  assert.match(warnings[0]!, new RegExp(WAIVER_ENV), "the disclosure must name how to undo it");
});

test("the waiver never covers a DACL that was read and found shared", async () => {
  // The whole point of #4842: a guard that reads as protection and provides
  // none. A shared DACL has a remedy the operator can run (`icacls /reset`),
  // so no amount of opting out may admit it.
  await assert.rejects(
    assertClientV1PathOwnership(
      uniquePath(),
      { uid: 0 },
      "credential store root",
      windows({
        env: { [WAIVER_ENV]: WAIVER_TOKEN, [WAIVER_REASON_ENV]: WAIVER_REASON },
        probeWindowsAcl: async () =>
          report({
            aces: [
              { sid: SELF_SID, type: "Allow" },
              { sid: USERS_SID, type: "Allow" },
            ],
          }),
      }),
    ),
    (error: Error) => {
      assert.match(error.message, /is not exclusive to the current user/);
      assert.match(error.message, new RegExp(`Allow:${USERS_SID}`));
      assert.match(
        error.message,
        /does not cover a DACL that was read/,
        "the refusal must say the waiver is set and still does not apply",
      );
      return true;
    },
  );

  // Nor does it cover a platform that has neither a uid nor a Windows ACL:
  // there the question was never asked of a Windows host at all.
  await assert.rejects(
    assertClientV1PathOwnership(uniquePath(), { uid: 0 }, "credential store root", {
      platform: "sunos",
      getuid: null,
      env: { [WAIVER_ENV]: WAIVER_TOKEN, [WAIVER_REASON_ENV]: WAIVER_REASON },
    }),
    /ownership cannot be verified on sunos/,
  );

  // Nor a uid mismatch on a POSIX host, where the waiver has no business.
  await assert.rejects(
    assertClientV1PathOwnership(uniquePath(), { uid: 1001 }, "credential store root", {
      getuid: () => 1000,
      env: { [WAIVER_ENV]: WAIVER_TOKEN, [WAIVER_REASON_ENV]: WAIVER_REASON },
    }),
    /must be owned by the current user\./,
  );
});

test("a boolean-shaped value never waives the check", async () => {
  // The failure mode this guards is muscle memory: every other switch in this
  // codebase is `=1`, so an operator who half-remembers the hatch reaches for
  // that. It has to do nothing, and say so.
  for (const value of ["1", "true", "TRUE", "yes", "on", WAIVER_TOKEN.toUpperCase()]) {
    await assert.rejects(
      assertClientV1PathOwnership(
        uniquePath(),
        { uid: 0 },
        "credential store root",
        windows({
          env: { [WAIVER_ENV]: value, [WAIVER_REASON_ENV]: WAIVER_REASON },
          probeWindowsAcl: constrainedLanguageProbe(),
        }),
      ),
      (error: Error) => {
        assert.match(
          error.message,
          new RegExp(`only accepted value is the exact string ${WAIVER_TOKEN}`),
          `${JSON.stringify(value)} must not waive the check`,
        );
        return true;
      },
    );
  }

  // A blank value is "not set", so it earns the how-to note rather than the
  // wrong-value one — but it must still refuse.
  await assert.rejects(
    assertClientV1PathOwnership(
      uniquePath(),
      { uid: 0 },
      "credential store root",
      windows({
        env: { [WAIVER_ENV]: "   ", [WAIVER_REASON_ENV]: WAIVER_REASON },
        probeWindowsAcl: constrainedLanguageProbe(),
      }),
    ),
    /ownership could not be verified on Windows/,
  );
});

test("the waiver stays closed without an attributable reason", async () => {
  for (const reason of [undefined, "", "   ", "because"]) {
    await assert.rejects(
      assertClientV1PathOwnership(
        uniquePath(),
        { uid: 0 },
        "credential store root",
        windows({
          env: { [WAIVER_ENV]: WAIVER_TOKEN, ...(reason === undefined ? {} : { [WAIVER_REASON_ENV]: reason }) },
          probeWindowsAcl: constrainedLanguageProbe(),
        }),
      ),
      (error: Error) => {
        assert.match(
          error.message,
          new RegExp(`${WAIVER_REASON_ENV} must carry`),
          `reason ${JSON.stringify(reason)} must not satisfy the attribution requirement`,
        );
        return true;
      },
    );
  }
});

test("a waived path is disclosed once and never re-probed per request", async () => {
  // The probe is ~290ms and runs per authenticated request. On a host where it
  // can never succeed, re-driving it every time would be strictly worse than
  // the crash it replaces (cave-okfb2 R6), and a disclosure repeated on every
  // request is one nobody reads.
  const path = uniquePath();
  const warnings: string[] = [];
  let probes = 0;
  const options = windows({
    env: { [WAIVER_ENV]: WAIVER_TOKEN, [WAIVER_REASON_ENV]: WAIVER_REASON },
    warn: (message) => warnings.push(message),
    probeWindowsAcl: async () => {
      probes += 1;
      throw new Error("spawn powershell.exe ENOENT");
    },
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assertClientV1PathOwnership(path, { uid: 0 }, "credential store root", options);
  }
  assert.equal(probes, 1, "a waived path must not re-spawn the probe per request");
  assert.equal(warnings.length, 1, "the disclosure is once per path, not once per request");

  // Installing PowerShell is an out-of-band repair, so the waiver — like the
  // success cache — is dropped by the same reset seam and re-driven.
  resetClientV1PathOwnershipCache();
  await assertClientV1PathOwnership(path, { uid: 0 }, "credential store root", options);
  assert.equal(probes, 2, "resetting the cache must re-drive a waived path");
  assert.equal(warnings.length, 2);
});

test("the ACL probe is spawned without this process's environment", async () => {
  // Both copies of the probe run inside the Cave server, which holds
  // COVEN_CAVE_ACCESS_TOKEN and COVEN_CAVE_AUTH_TOKEN. A subprocess that only
  // has to read a DACL must not receive them — the same rule sanitizedEnv()
  // enforces for PTY shells, and the reason `server-pty-ws.test.ts` bans the
  // spread outright in server.ts.
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");

  // Assert the PROPERTY, not one spelling of the mistake. A ban on the literal
  // `env: { ...process.env` is satisfied by `...process.env` one line lower, by
  // `Object.assign({}, process.env, …)`, and by naming a secret outright — so
  // instead: read the object each copy actually builds, and require that every
  // `process.env` it reaches for is on this list. Both copies, because the
  // regression CI caught existed in both and only one was ever checked here.
  const ALLOWED = new Set(["NODE_ENV", "SystemRoot", "windir", "PATHEXT", "TEMP", "TMP"]);
  const blocks: [string, RegExp][] = [
    ["src/lib/server/client-v1/path-ownership.ts", /function windowsProbeEnv\([\s\S]*?\n}/],
    ["server.ts", /const probeEnv: NodeJS\.ProcessEnv = \{[\s\S]*?\n {2}\};/],
  ];
  for (const [file, pattern] of blocks) {
    const source = await readFile(resolve(process.cwd(), file), "utf8");
    assert.doesNotMatch(
      source,
      /env: \{\s*\.\.\.process\.env/,
      `${file} must not hand the server's environment to the ACL probe`,
    );

    const block = pattern.exec(source);
    assert.ok(block, `${file} must build the probe environment as an explicit literal`);
    assert.doesNotMatch(
      block![0],
      /\.\.\./,
      `${file} must not spread anything into the probe environment`,
    );
    assert.doesNotMatch(
      block![0],
      /Object\.assign|structuredClone/,
      `${file} must not copy an environment into the probe wholesale`,
    );
    const reached = [...block![0].matchAll(/process\.env(?:\.(\w+)|\[\s*["'`](\w+)["'`]\s*\])/g)]
      .map((match) => match[1] ?? match[2]!);
    assert.ok(reached.length > 0, `${file} probe environment did not parse`);
    for (const name of reached) {
      assert.ok(
        ALLOWED.has(name),
        `${file} hands process.env.${name} to the ACL probe; only ${[...ALLOWED].join(", ")} may cross`,
      );
    }
    assert.doesNotMatch(
      block![0],
      /COVEN_CAVE_(?!CLIENT_V1_ACL_PATH)/,
      `${file}: only the path under test may cross into the probe from the COVEN_CAVE namespace`,
    );
  }
});
