// @ts-nocheck
//
// The worktree lifecycle gate authorises deleting worktrees. `statusState`
// forces `-c core.fileMode=true` so repository configuration cannot hide a
// permission change from it, and on a filesystem with no POSIX executable bit
// that override manufactures a permanent phantom change for every tracked
// 100755 file. These tests pin the narrow discount that removes the phantom, and
// — more importantly — the two things it must never remove:
//
//   * a real content change, and
//   * a real executable-bit change on a filesystem that can hold one.
//
// Every assertion here exercises behaviour. The integration half runs real git
// against a real repository on disk rather than asserting on the text of the
// command we happen to build.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const {
  parseUnrepresentableExecutableBitCandidate,
  retainedStatusChanges,
} = await import("../src/lib/worktree-lifecycle.ts");
const { discountUnrepresentableExecutableBitChanges } = await import(
  "./worktree-lifecycle-inventory.ts"
);

const OID_A = "cab8485719a664fe7a7c4e8b1282fff20a900d2d";
const OID_B = "474243c3a063ac342c93db366b35ba5063f4ae70";

/** The exact record a checkout with no executable bit emits for a clean 100755 file. */
const PHANTOM = `1 .M N... 100755 100755 100644 ${OID_A} ${OID_A} scripts/dev-app.sh`;

const neverCalled = () => {
  throw new Error("resolver must not be consulted");
};

// ---------------------------------------------------------------------------
// The parser: which records can a missing executable bit possibly explain?
// ---------------------------------------------------------------------------

test("the phantom record is recognised, carrying its path and index oid", () => {
  assert.deepEqual(parseUnrepresentableExecutableBitCandidate(PHANTOM), {
    path: "scripts/dev-app.sh",
    indexOid: OID_A,
  });
});

test("records a missing executable bit cannot explain are never candidates", () => {
  for (const [label, entry] of [
    ["staged mode change", `1 M. N... 100755 100644 100644 ${OID_A} ${OID_A} a.sh`],
    // Isolates the "anything staged is a change on its own terms" guard: every
    // other field here is the phantom's, so only the XY code can reject it.
    ["staged, otherwise identical to the phantom", `1 M. N... 100755 100755 100644 ${OID_A} ${OID_A} a.sh`],
    ["staged and unstaged", `1 MM N... 100755 100755 100644 ${OID_A} ${OID_B} a.sh`],
    ["index differs from HEAD", `1 .M N... 100755 100755 100644 ${OID_A} ${OID_B} a.sh`],
    ["deleted in worktree", `1 .D N... 100755 100755 100644 ${OID_A} ${OID_A} a.sh`],
    ["type change", `1 .T N... 100755 100755 120000 ${OID_A} ${OID_A} a.sh`],
    ["submodule", `1 .M SC.. 100755 100755 100644 ${OID_A} ${OID_A} vendor`],
    // A filesystem that cannot store the bit also cannot invent one, so the
    // 100644 -> 100755 direction is always a real change.
    ["executable bit added", `1 .M N... 100644 100644 100755 ${OID_A} ${OID_A} a.sh`],
    ["no mode delta at all", `1 .M N... 100644 100644 100644 ${OID_A} ${OID_A} a.ts`],
    ["symlink", `1 .M N... 120000 120000 100644 ${OID_A} ${OID_A} a.sh`],
    ["untracked", "? scripts/new.sh"],
    ["unmerged", `u UU N... 100755 100755 100755 ${OID_A} ${OID_A} ${OID_B} a.sh`],
    ["rename entry", `2 R. N... 100755 100755 100644 ${OID_A} ${OID_A} R100 b.sh\ta.sh`],
    ["branch header", "# branch.oid abc123"],
    ["ignored", "! node_modules/x"],
    ["empty", ""],
  ]) {
    assert.equal(
      parseUnrepresentableExecutableBitCandidate(entry),
      null,
      `${label} must not be treated as an executable-bit artifact`,
    );
  }
});

test("paths are taken verbatim, including spaces and a trailing space", () => {
  assert.equal(
    parseUnrepresentableExecutableBitCandidate(
      `1 .M N... 100755 100755 100644 ${OID_A} ${OID_A} scripts/my tool.sh `,
    ).path,
    "scripts/my tool.sh ",
  );
});

// ---------------------------------------------------------------------------
// The decision: both facts required, every unknown keeps the entry.
// ---------------------------------------------------------------------------

test("nothing is discounted where the filesystem can hold an executable bit", () => {
  // This is the POSIX guarantee in its most direct form: a genuine `chmod -x`
  // produces exactly PHANTOM, and on a filesystem that can store the bit it must
  // survive untouched, without the resolver even being asked.
  assert.deepEqual(retainedStatusChanges([PHANTOM], true, neverCalled), [PHANTOM]);
});

test("a phantom whose content matches the index is discounted", () => {
  assert.deepEqual(
    retainedStatusChanges([PHANTOM], false, () => new Map([["scripts/dev-app.sh", OID_A]])),
    [],
  );
});

test("a mode-shaped entry whose content differs is kept", () => {
  assert.deepEqual(
    retainedStatusChanges([PHANTOM], false, () => new Map([["scripts/dev-app.sh", OID_B]])),
    [PHANTOM],
  );
});

test("an unanswerable hash keeps every entry", () => {
  assert.deepEqual(retainedStatusChanges([PHANTOM], false, () => null), [PHANTOM]);
  assert.deepEqual(retainedStatusChanges([PHANTOM], false, () => new Map()), [PHANTOM]);
});

test("non-candidate entries are neither hashed nor dropped", () => {
  const real = `1 .M N... 100644 100644 100644 ${OID_A} ${OID_A} src/app.ts`;
  const untracked = "? secret.env";
  let asked = null;
  const kept = retainedStatusChanges([real, PHANTOM, untracked], false, (paths) => {
    asked = paths;
    return new Map([["scripts/dev-app.sh", OID_A]]);
  });
  assert.deepEqual(kept, [real, untracked]);
  assert.deepEqual(asked, ["scripts/dev-app.sh"], "only candidates are hashed");
});

// ---------------------------------------------------------------------------
// Real git, real filesystem.
// ---------------------------------------------------------------------------

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
  };
}

function requireGit(cwd, args) {
  const result = git(cwd, args);
  assert.ok(result.ok, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/** The inventory's own status invocation, verbatim, including the forced flag. */
function statusChanges(root) {
  const result = git(root, [
    "-c", "status.relativePaths=false",
    "-c", "core.fileMode=true",
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-c", "core.ignoreStat=false",
    "status", "--porcelain=v2", "-z",
    "--untracked-files=all", "--ignored=matching",
    "--ignore-submodules=none", "--no-renames",
  ]);
  assert.ok(result.ok, `status failed: ${result.stderr}`);
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .filter((entry) => !entry.startsWith("# ") && !entry.startsWith("! "));
}

async function makeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "worktree-filemode-"));
  requireGit(root, ["init", "--quiet", "-b", "main"]);
  requireGit(root, ["config", "user.email", "test@example.invalid"]);
  requireGit(root, ["config", "user.name", "Filemode Test"]);
  requireGit(root, ["config", "commit.gpgsign", "false"]);
  await mkdir(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(root, "scripts", "tool.sh"), "#!/bin/sh\necho hi\n");
  writeFileSync(path.join(root, "plain.txt"), "hello\n");
  // Set the bit on disk first: real on a filesystem that holds it, a no-op on
  // one that does not. Then force it in the index too, so HEAD and the index
  // record 100755 on BOTH platforms. The result is a fixture that is genuinely
  // clean on ext4, and carries the executable-bit artifact on NTFS — which is
  // exactly the difference under test.
  chmodSync(path.join(root, "scripts", "tool.sh"), 0o755);
  requireGit(root, ["add", "."]);
  requireGit(root, ["update-index", "--chmod=+x", "scripts/tool.sh"]);
  requireGit(root, ["commit", "--quiet", "-m", "seed"]);
  return root;
}

function cleanup(root) {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // Windows keeps handles on freshly-read git files; leaking a temp directory
    // must not fail the suite.
  }
}

const executableBitHeld = (() => {
  const dir = mkdtempSync(path.join(tmpdir(), "worktree-filemode-probe-"));
  const probe = path.join(dir, "probe");
  try {
    writeFileSync(probe, "");
    chmodSync(probe, 0o755);
    return (statSync(probe).mode & 0o111) !== 0;
  } finally {
    cleanup(dir);
  }
})();

test("a byte-for-byte clean checkout reports no changes", async () => {
  const root = await makeRepo();
  try {
    const before = statusChanges(root);
    const after = discountUnrepresentableExecutableBitChanges(root, before, git);
    if (executableBitHeld) {
      // The bit round-trips, so git never reported a delta in the first place.
      assert.deepEqual(before, [], "a clean POSIX checkout has nothing to discount");
    } else {
      assert.ok(
        before.some((entry) => entry.includes("scripts/tool.sh")),
        "the forced core.fileMode=true must still surface the mode delta",
      );
    }
    assert.deepEqual(after, [], "a clean checkout must classify as clean");
  } finally {
    cleanup(root);
  }
});

test("an unstaged content edit to an executable stays dirty", async () => {
  // The guarantee that the obvious fix loses. On a checkout with no executable
  // bit this file's status record is shaped exactly like the phantom above —
  // same `.M`, same 100755/100755/100644, same repeated object id — so anything
  // keying off the record alone would delete this edit.
  const root = await makeRepo();
  try {
    writeFileSync(path.join(root, "scripts", "tool.sh"), "#!/bin/sh\necho EDITED\n");
    const kept = discountUnrepresentableExecutableBitChanges(root, statusChanges(root), git);
    assert.ok(
      kept.some((entry) => entry.endsWith("scripts/tool.sh")),
      `an edited executable must remain a change; kept: ${JSON.stringify(kept)}`,
    );
  } finally {
    cleanup(root);
  }
});

test("an unstaged content edit to a non-executable stays dirty", async () => {
  const root = await makeRepo();
  try {
    writeFileSync(path.join(root, "plain.txt"), "goodbye\n");
    const kept = discountUnrepresentableExecutableBitChanges(root, statusChanges(root), git);
    assert.ok(
      kept.some((entry) => entry.endsWith("plain.txt")),
      `an edited file must remain a change; kept: ${JSON.stringify(kept)}`,
    );
  } finally {
    cleanup(root);
  }
});

test("a staged executable-bit removal stays dirty on every platform", async () => {
  const root = await makeRepo();
  try {
    requireGit(root, ["update-index", "--chmod=-x", "scripts/tool.sh"]);
    const kept = discountUnrepresentableExecutableBitChanges(root, statusChanges(root), git);
    assert.ok(
      kept.some((entry) => entry.endsWith("scripts/tool.sh")),
      `a staged mode change must remain a change; kept: ${JSON.stringify(kept)}`,
    );
  } finally {
    cleanup(root);
  }
});

test("a real chmod -x stays dirty where the filesystem holds the bit", async (t) => {
  if (!executableBitHeld) {
    t.skip("filesystem cannot store the executable bit; nothing real to chmod");
    return;
  }
  const root = await makeRepo();
  try {
    const target = path.join(root, "scripts", "tool.sh");
    chmodSync(target, 0o644);
    const before = statusChanges(root);
    assert.ok(
      before.some((entry) => entry.endsWith("scripts/tool.sh")),
      "git must see the permission change",
    );
    const kept = discountUnrepresentableExecutableBitChanges(root, before, git);
    assert.ok(
      kept.some((entry) => entry.endsWith("scripts/tool.sh")),
      `a genuine permission change must remain a change; kept: ${JSON.stringify(kept)}`,
    );
  } finally {
    cleanup(root);
  }
});
