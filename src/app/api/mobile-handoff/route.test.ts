// @ts-nocheck
// Source pins for the mobile-handoff route's access-secret guards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  route,
  /verifyArmedMobileAccessSecret/,
  "the env-armed secret is re-verified against the persisted file",
);
assert.match(
  route,
  /assertExclusivePathOwnership\(file, stats, "The persisted mobile access secret"\)/,
  "the armed value is verified with the async ownership guard (one cached probe per process)",
);
assert.match(
  route,
  /if \(stats\.isSymbolicLink\(\)\) return false;/,
  "a symlinked persisted secret refuses the gate",
);
assert.match(
  route,
  /if \(existing\) \{\s*\n\s*if \(!\(await verifyArmedMobileAccessSecret\(\)\)\) return null;/,
  "a refused persisted file returns null instead of trusting the armed value (cave-8pd39)",
);

// Source pins for the runTailscale() retry-on-timeout wrapper (cave-j2056).
// The local Tailscale daemon/system-extension IPC occasionally stalls a
// single CLI invocation for several seconds even while Tailscale is fully
// connected; without a retry that stall hard-fails pairing readiness with
// "tailscale is not connected" and the QR code never renders, even though
// Tailscale is genuinely connected.
assert.match(
  route,
  /const TAILSCALE_TIMED_OUT = "Tailscale command timed out";/,
  "the timeout stderr string is a shared constant, not duplicated inline",
);
assert.match(
  route,
  /async function runTailscale\(args: string\[\], timeoutMs = 8000\): Promise<TailscaleResult> \{\s*\n\s*const first = await runTailscaleOnce\(args, timeoutMs\);\s*\n\s*if \(first\.ok \|\| first\.cleanupFailed \|\| first\.stderr !== TAILSCALE_TIMED_OUT\) return first;\s*\n\s*return runTailscaleOnce\(args, timeoutMs\);\s*\n\}/,
  "a timed-out probe is retried exactly once before the caller sees a failure",
);
assert.match(
  route,
  /function runTailscaleOnce\(args: string\[\], timeoutMs = 8000\): Promise<TailscaleResult> \{/,
  "the single-attempt spawn logic is a separate function the retry wrapper calls twice at most",
);
assert.match(
  route,
  /const TAILSCALE_TERMINATION_FAILED =\s*\n\s*"Tailscale command timed out and its process tree could not be stopped";/,
  "failed timeout cleanup has a distinct non-retryable result",
);
assert.match(
  route,
  /const terminated = await terminateProcessTree\(child\);\s*\n\s*finish\(\{\s*\n\s*ok: false,\s*\n\s*status: null,\s*\n\s*stdout: stdout\.text\(\),\s*\n\s*stderr: terminated \? TAILSCALE_TIMED_OUT : TAILSCALE_TERMINATION_FAILED,/,
  "the timeout result waits for process-tree termination and reports cleanup failure",
);
assert.match(
  route,
  /child\.on\("close", \(status\) => \{\s*\n\s*if \(timedOut\) return;/,
  "a timed-out child's close event cannot resolve before process-tree cleanup completes",
);
assert.match(
  route,
  /child\.on\("error", \(error\) => \{\s*\n\s*if \(timedOut\) return;/,
  "a timed-out child's error event cannot resolve before process-tree cleanup completes",
);
assert.match(
  route,
  /type TailscaleResult = \{[\s\S]{0,180}?cleanupFailed: boolean;/,
  "callers receive a typed signal when timeout cleanup is unconfirmed",
);
assert.match(
  route,
  /if \(first\.ok \|\| first\.cleanupFailed \|\| first\.stderr !== TAILSCALE_TIMED_OUT\) return first;/,
  "cleanup failure is terminal and cannot trigger the same-command retry",
);
assert.match(
  route,
  /cleanupFailed: !terminated,/,
  "the timeout result records whether process-tree cleanup failed",
);
assert.equal(
  route.match(/if \(self\.cleanupFailed\) return tailscaleCleanupFailureResponse\(self, backend\);/g)?.length,
  2,
  "both Serve probe ladders abort when self-status cleanup is unconfirmed",
);
assert.match(
  route,
  /if \(result\.cleanupFailed\) \{\s*\n\s*return \{ ok: false, response: tailscaleCleanupFailureResponse\(result, backend\) \};/,
  "the shared ownership-status read aborts before any probe or mutation after cleanup failure",
);
assert.match(
  route,
  /if \(mutation\.cleanupFailed\) \{\s*\n\s*return \{\s*\n\s*ok: false as const,\s*\n\s*response: tailscaleCleanupFailureResponse\(mutation, backend\),/,
  "a timed-out Serve mutation aborts before post-status discovery",
);

console.log("mobile-handoff route.test.ts OK");
