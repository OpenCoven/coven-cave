import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  assertClientV1PathOwnership,
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

test("probes a verified Windows path once and a refused one every time", async () => {
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

  // A refusal is never cached: repairing the DACL out of band has to take
  // effect without restarting the server.
  const refused = uniquePath();
  let refusedProbes = 0;
  const refusedOptions = windows({
    probeWindowsAcl: async () => {
      refusedProbes += 1;
      return report({ protected: false });
    },
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      assertClientV1PathOwnership(refused, { uid: 0 }, "discovery root", refusedOptions),
    );
  }
  assert.equal(refusedProbes, 2);

  resetClientV1PathOwnershipCache();
  await assertClientV1PathOwnership(verified, { uid: 0 }, "discovery root", options);
  assert.equal(verifiedProbes, 2, "resetting the cache must re-drive the probe");
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
