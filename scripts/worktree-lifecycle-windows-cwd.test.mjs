// @ts-nocheck
//
// The worktree lifecycle patrol classifies worktrees, and that classification
// authorises deleting them. One of the facts it classifies on is "is a live
// process working in this directory" — discovered on POSIX by `lsof -d cwd`,
// which Windows does not have. These tests cover the Windows replacement.
//
// The property under test is deliberately the DANGEROUS direction: a live
// process must keep a worktree non-retirable. Every test below is written so
// that a probe which silently reports "nothing is running anywhere" fails it —
// because that is the failure that deletes someone's work, and it is exactly
// what a broken probe looks like from the outside.
//
// The Windows half spawns REAL processes and runs the REAL PowerShell probe
// against them. Nothing here asserts on the text of a command we build.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { classifyLifecycleUnit, classifyWorktree } = await import(
  "../src/lib/worktree-lifecycle.ts"
);
const { parseWindowsCwdProbeOutput, reconcileHoldVerdicts } = await import(
  "./worktree-lifecycle-inventory.ts"
);

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const probeScript = path.join(sourceRoot, "scripts", "windows-process-cwd.ps1");
const isWindows = process.platform === "win32";

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
const HOUR = 3_600_000;
const HEAD = "a".repeat(40);

/**
 * An observation that classifies `retire-after-gate` — the lane the patrol
 * reports as cleanup-ready, and the only one from which deletion may proceed.
 * Every liveness test below starts from this and adds ONE fact, so a test that
 * still reports `retire-after-gate` proves that fact was ignored.
 */
function retirableObservation(overrides = {}) {
  return {
    kind: "worktree",
    path: "/repo/.worktrees/feat-x",
    ref: "refs/heads/feat/x",
    branch: "feat/x",
    head: HEAD,
    isPrimary: false,
    protectedBranch: false,
    changes: [],
    ignoredPaths: [],
    nonDisposableIgnoredPaths: [],
    indexFlags: [],
    processOwners: [],
    claimOwners: [],
    taskIds: [],
    mentionTaskIds: [],
    openPrs: [],
    mergedPr: { number: 47, headOid: HEAD, url: "https://example.test/47" },
    activeWorkflowUrls: [],
    headOnDefaultBranch: false,
    remoteRefsContainingHead: ["refs/remotes/origin/feat/x"],
    updatedAtMs: NOW - 24 * HOUR,
    probeErrors: [],
    metadata: {
      beadId: "cave-6r4t4",
      owner: "Timothy Wayne Gregg",
      purpose: "Windows process cwd probe",
      disposition: "pr",
      createdAt: "2026-08-20T12:00:00Z",
    },
    metadataErrors: [],
    metadataGlobalErrors: [],
    remoteRef: { ref: "refs/remotes/origin/feat/x", oid: HEAD },
    sessionIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The gate. These run on every platform, because the classifier is shared.
// ---------------------------------------------------------------------------

test("the baseline observation really is retirable, or nothing below proves anything", () => {
  // Without this, every assertion under it could pass against a fixture that was
  // never retirable in the first place.
  assert.equal(classifyLifecycleUnit(retirableObservation(), NOW).lane, "retire-after-gate");
});

test("a held worktree root keeps a unit out of the retirable lane", () => {
  const item = classifyLifecycleUnit(
    retirableObservation({ directoryHeldOpen: true }),
    NOW,
  );
  assert.equal(item.lane, "active", "an occupied worktree must never be offered for deletion");
  assert.match(item.reasons.join("\n"), /held open by a live process/);
});

test("a held root holds the unit even when no process could be attributed to it", () => {
  // The case the second probe exists for: the process is at a higher integrity
  // level, so its working directory is unreadable and `processOwners` is empty,
  // yet the filesystem still reports the directory occupied.
  const item = classifyLifecycleUnit(
    retirableObservation({ directoryHeldOpen: true, processOwners: [] }),
    NOW,
  );
  assert.equal(item.lane, "active");
});

test("a live process cwd inside the worktree keeps it out of the retirable lane", () => {
  const item = classifyLifecycleUnit(
    retirableObservation({ processOwners: [{ pid: 4321, command: "bash" }] }),
    NOW,
  );
  assert.equal(item.lane, "active");
  assert.match(item.reasons.join("\n"), /pid 4321/);
});

test("a free root does not hold the unit, and an absent verdict behaves the same", () => {
  assert.equal(
    classifyLifecycleUnit(retirableObservation({ directoryHeldOpen: false }), NOW).lane,
    "retire-after-gate",
  );
  const { directoryHeldOpen: _absent, ...withoutField } = retirableObservation({
    directoryHeldOpen: false,
  });
  assert.equal(
    classifyLifecycleUnit(withoutField, NOW).lane,
    "retire-after-gate",
    "a platform with no directory probe keeps its previous behaviour",
  );
});

test("the legacy classifyWorktree entry point carries the held verdict through", () => {
  // classifyWorktree rebuilds the observation field by field, so a field it
  // forgets is silently dropped and the unit reads as unoccupied. Exercised
  // separately because the inventory uses the OTHER entry point, which would
  // hide the omission.
  const { kind, ref, metadata, metadataErrors, metadataGlobalErrors, remoteRef, sessionIds, ...legacy } =
    retirableObservation({ directoryHeldOpen: true });
  const item = classifyWorktree(legacy, NOW);
  assert.equal(item.lane, "active");
  assert.match(item.reasons.join("\n"), /held open by a live process/);
});

test("a probe error keeps the unit non-retirable rather than silently free", () => {
  const item = classifyLifecycleUnit(
    retirableObservation({
      probeErrors: ["worktree root occupancy is unprovable: win32 error 5"],
    }),
    NOW,
  );
  assert.notEqual(item.lane, "retire-after-gate");
  assert.equal(item.lane, "uncertain");
});

// ---------------------------------------------------------------------------
// The parser. Every malformed shape must read as "cannot prove", not as "free".
// ---------------------------------------------------------------------------

const COMPLETE = [
  "#probe windows-process-cwd v1",
  "#self C:\\",
  "#processes total=10 read=7 unreadable=3",
  "#hold HELD C:\\repo\\.worktrees\\busy",
  "#hold FREE C:\\repo\\.worktrees\\quiet",
  "#hold ERROR:5 C:\\repo\\.worktrees\\denied",
  "#records",
  "p1234",
  "cbash",
  "fcwd",
  "nC:\\repo\\.worktrees\\busy",
  "#end",
  "",
].join("\n");

test("a complete probe output yields every part of the answer", () => {
  const probe = parseWindowsCwdProbeOutput(COMPLETE);
  assert.equal(probe.complete, true);
  assert.equal(probe.selfCwd, "C:\\");
  assert.deepEqual(probe.totals, { total: 10, read: 7, unreadable: 3 });
  assert.equal(probe.holds.get("C:\\repo\\.worktrees\\busy"), true);
  assert.equal(probe.holds.get("C:\\repo\\.worktrees\\quiet"), false);
  assert.equal(probe.holds.has("C:\\repo\\.worktrees\\denied"), false, "an error is not a verdict");
  assert.equal(probe.holdErrors.get("C:\\repo\\.worktrees\\denied"), "win32 error 5");
  assert.equal(probe.ownerRecords, "p1234\ncbash\nfcwd\nnC:\\repo\\.worktrees\\busy\n");
});

test("truncated output is never complete", () => {
  for (const [label, raw] of [
    ["no #end marker", COMPLETE.replace("#end\n", "")],
    ["no #records section", COMPLETE.split("\n").filter((l) => l !== "#records").join("\n")],
    ["empty", ""],
    ["nothing but a header", "#probe windows-process-cwd v1\n"],
  ]) {
    assert.equal(parseWindowsCwdProbeOutput(raw).complete, false, label);
  }
});

test("output continuing past #end is not complete", () => {
  // A second probe's output concatenated onto the first, or a shell banner
  // appended after the fact, means the stream is not the one we asked for.
  assert.equal(parseWindowsCwdProbeOutput(`${COMPLETE}p99\n`).complete, false);
});

test("a command name starting with # is a record, not a directive", () => {
  // The split between directives and records is positional, on the #records
  // marker, precisely so a process named like a directive cannot delete itself
  // from the inventory. A prefix-based split would drop this process entirely.
  const raw = COMPLETE.replace("cbash", "c#self C:\\elsewhere");
  const probe = parseWindowsCwdProbeOutput(raw);
  assert.equal(probe.selfCwd, "C:\\", "a record must not overwrite the self-check");
  assert.match(probe.ownerRecords, /c#self C:\\elsewhere/);
});

test("directory paths with spaces round-trip verbatim", () => {
  const probe = parseWindowsCwdProbeOutput(
    "#self C:\\\n#hold HELD C:\\my repo\\.worktrees\\a b\n#records\n#end\n",
  );
  assert.equal(probe.holds.get("C:\\my repo\\.worktrees\\a b"), true);
});

test("CRLF output parses identically", () => {
  const probe = parseWindowsCwdProbeOutput(COMPLETE.replace(/\n/g, "\r\n"));
  assert.equal(probe.complete, true);
  assert.equal(probe.selfCwd, "C:\\");
  assert.equal(probe.holds.get("C:\\repo\\.worktrees\\busy"), true);
});

// ---------------------------------------------------------------------------
// Reconciliation: a directory nobody answered for must never read as free.
// ---------------------------------------------------------------------------

test("a directory the probe never answered for becomes an error, not a free verdict", () => {
  const probe = parseWindowsCwdProbeOutput(COMPLETE);
  const asked = [
    "C:\\repo\\.worktrees\\busy",
    "C:\\repo\\.worktrees\\quiet",
    "C:\\repo\\.worktrees\\denied",
    "C:\\repo\\.worktrees\\unanswered",
  ];
  const { holds, holdErrors } = reconcileHoldVerdicts(asked, probe);
  assert.equal(holds.get("C:\\repo\\.worktrees\\busy"), true);
  assert.equal(holds.get("C:\\repo\\.worktrees\\quiet"), false);
  assert.equal(holds.has("C:\\repo\\.worktrees\\unanswered"), false);
  assert.equal(holdErrors.get("C:\\repo\\.worktrees\\unanswered"), "no verdict returned");
  assert.equal(holdErrors.get("C:\\repo\\.worktrees\\denied"), "win32 error 5");
});

test("a probe that answered for nothing leaves every directory carrying an error", () => {
  // The shape that matters most: silence must not read as an empty checkout.
  const asked = ["C:\\a", "C:\\b", "C:\\c"];
  const { holds, holdErrors } = reconcileHoldVerdicts(asked, {
    holds: new Map(),
    holdErrors: new Map(),
  });
  assert.equal(holds.size, 0);
  assert.deepEqual([...holdErrors.keys()].sort(), asked);
});

test("an existing error is never overwritten by the missing-verdict default", () => {
  const { holdErrors } = reconcileHoldVerdicts(["C:\\a"], {
    holds: new Map(),
    holdErrors: new Map([["C:\\a", "win32 error 5"]]),
  });
  assert.equal(holdErrors.get("C:\\a"), "win32 error 5");
});

// ---------------------------------------------------------------------------
// Real processes, the real probe script. Windows only.
// ---------------------------------------------------------------------------

function runProbe(directories, launchCwd) {
  const pathsFile = path.join(tmpdir(), `cwd-probe-test-${process.pid}-${Date.now()}.txt`);
  writeFileSync(pathsFile, `${directories.join("\n")}\n`, "utf8");
  try {
    const stdout = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", probeScript, pathsFile],
      { cwd: launchCwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return parseWindowsCwdProbeOutput(stdout);
  } finally {
    rmSync(pathsFile, { force: true });
  }
}

/** Every pid the probe reports with a cwd at or under `root`. */
function occupants(probe, root) {
  const prefix = `${root}${path.sep}`;
  const pids = [];
  let pid = null;
  for (const line of probe.ownerRecords.split("\n")) {
    if (/^p\d+$/.test(line)) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== null) {
      const cwd = line.slice(1).replace(/[\\/]+$/, "");
      if (cwd === root || `${cwd}${path.sep}`.startsWith(prefix)) pids.push(pid);
    }
  }
  return pids;
}

test(
  "a live process inside a worktree is seen, and the directory it sits in reads as held",
  { skip: isWindows ? false : "the Windows cwd probe only runs on Windows" },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "cwd-probe-"));
    const busy = path.join(root, "busy");
    const quiet = path.join(root, "quiet");
    mkdirSync(busy);
    mkdirSync(quiet);

    // A real process, with a real working directory, that we did not tell the
    // probe about.
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 120"],
      { cwd: busy, stdio: "ignore", windowsHide: true },
    );
    await new Promise((resolve) => child.once("spawn", resolve));
    // The working directory is set by the loader before the process runs, so it
    // is readable as soon as the pid exists.

    try {
      const probe = runProbe([busy, quiet], path.parse(process.cwd()).root);
      assert.equal(probe.complete, true, "the probe must produce a complete answer");
      assert.equal(
        probe.selfCwd.replace(/[\\/]+$/, "") || probe.selfCwd,
        path.parse(process.cwd()).root.replace(/[\\/]+$/, "") || probe.selfCwd,
        "the self-check must recover the directory the probe was launched in",
      );
      assert.ok(
        occupants(probe, busy).includes(child.pid),
        `pid ${child.pid} works in ${busy} and must be reported; the probe read ` +
          `${probe.totals.read} of ${probe.totals.total} processes`,
      );
      assert.equal(probe.holds.get(busy), true, "an occupied directory must read as held");
      assert.equal(probe.holds.get(quiet), false, "an empty directory must not read as held");
      assert.deepEqual([...probe.holdErrors.keys()], []);
    } finally {
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
    }

    // And the other half of the property: once nothing is running there, the
    // same directory must stop holding the unit. A probe hard-wired to "held"
    // would pass every assertion above and fail here.
    const after = runProbe([busy, quiet], path.parse(process.cwd()).root);
    assert.equal(after.complete, true);
    assert.deepEqual(occupants(after, busy), [], "the dead process must be gone");
    assert.equal(after.holds.get(busy), false, "a vacated directory must read as free");

    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  },
);

test(
  "a directory that cannot be probed reports an error rather than a free verdict",
  { skip: isWindows ? false : "the Windows cwd probe only runs on Windows" },
  () => {
    const missing = path.join(tmpdir(), `cwd-probe-absent-${Date.now()}`);
    const probe = runProbe([missing], path.parse(process.cwd()).root);
    assert.equal(probe.complete, true);
    assert.equal(probe.holds.has(missing), false, "an unprobeable path must not be called free");
    assert.match(probe.holdErrors.get(missing) ?? "", /^win32 error \d+$/);
  },
);

test(
  "the probe reads its own working directory back out of process memory",
  { skip: isWindows ? false : "the Windows cwd probe only runs on Windows" },
  () => {
    // The self-check the caller refuses on. Launched somewhere OTHER than the
    // filesystem root so the assertion cannot pass by accident on a default.
    const here = mkdtempSync(path.join(tmpdir(), "cwd-probe-self-"));
    try {
      const probe = runProbe([], here);
      assert.equal(probe.complete, true);
      assert.equal(
        probe.selfCwd.replace(/[\\/]+$/, ""),
        here.replace(/[\\/]+$/, ""),
        "a mismatch here means the memory offsets are wrong on this Windows build",
      );
      assert.ok(probe.totals.read > 0, "a probe that reads no process at all is not working");
    } finally {
      rmSync(here, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);
