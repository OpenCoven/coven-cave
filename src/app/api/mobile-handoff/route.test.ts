// @ts-nocheck
// Source pins for the mobile-handoff route's access-secret guards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const mobileHandoff = readFileSync(
  new URL("../../../lib/mobile-handoff.ts", import.meta.url),
  "utf8",
);

assert.match(
  route,
  /Tailscale Serve removal was verified, but the owned backend process did not stop safely; its access credential was retained\./,
  "process cleanup failure reports the route-first transaction truthfully",
);

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
  mobileHandoff,
  /const TAILSCALE_TIMED_OUT = "Tailscale command timed out";/,
  "the timeout stderr string is a shared constant, not duplicated inline",
);
assert.match(
  mobileHandoff,
  /export async function runTailscaleCommand\([\s\S]{0,100}?args: string\[\],[\s\S]{0,100}?timeoutMs = 8000,[\s\S]{0,100}?\): Promise<TailscaleServeCommandResult> \{\s*const first = await runTailscaleCommandOnce\(args, timeoutMs\);\s*if \(first\.ok \|\| first\.cleanupFailed \|\| first\.stderr !== TAILSCALE_TIMED_OUT\) return first;\s*return runTailscaleCommandOnce\(args, timeoutMs\);\s*\}/,
  "a timed-out probe is retried exactly once before the caller sees a failure",
);
assert.match(
  mobileHandoff,
  /function runTailscaleCommandOnce\([\s\S]{0,100}?args: string\[\],[\s\S]{0,100}?timeoutMs = 8000,[\s\S]{0,100}?\): Promise<TailscaleServeCommandResult> \{/,
  "the single-attempt spawn logic is a separate function the retry wrapper calls twice at most",
);
assert.match(
  mobileHandoff,
  /const TAILSCALE_TERMINATION_FAILED =\s*\n\s*"Tailscale command timed out and its process tree could not be stopped";/,
  "failed timeout cleanup has a distinct non-retryable result",
);
assert.match(
  mobileHandoff,
  /const terminated = await terminateProcessTree\(child\);\s*\n\s*finish\(\{\s*\n\s*ok: false,\s*\n\s*status: null,\s*\n\s*stdout: stdout\.text\(\),\s*\n\s*stderr: terminated \? TAILSCALE_TIMED_OUT : TAILSCALE_TERMINATION_FAILED,/,
  "the timeout result waits for process-tree termination and reports cleanup failure",
);
assert.match(
  mobileHandoff,
  /child\.on\("close", \(status\) => \{\s*\n\s*if \(timedOut\) return;/,
  "a timed-out child's close event cannot resolve before process-tree cleanup completes",
);
assert.match(
  mobileHandoff,
  /child\.on\("error", \(error\) => \{\s*\n\s*if \(timedOut\) return;/,
  "a timed-out child's error event cannot resolve before process-tree cleanup completes",
);
assert.match(
  mobileHandoff,
  /export type TailscaleServeCommandResult = \{[\s\S]{0,180}?cleanupFailed: boolean;/,
  "callers receive a typed signal when timeout cleanup is unconfirmed",
);
assert.match(
  mobileHandoff,
  /if \(first\.ok \|\| first\.cleanupFailed \|\| first\.stderr !== TAILSCALE_TIMED_OUT\) return first;/,
  "cleanup failure is terminal and cannot trigger the same-command retry",
);
assert.match(
  mobileHandoff,
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
  /runTailscaleCommand as runTailscale/,
  "the API route and shell helper share one timeout/cleanup-safe Tailscale runner",
);
assert.match(
  route,
  /normalizeLoopbackBackendUrl\(process\.env\.COVEN_CAVE_NATIVE_APP_BACKEND_URL\)/,
  "native app backend selection uses the shared normalizer that preserves bracketed IPv6 loopback origins",
);
assert.match(
  route,
  /if \(mutation\.cleanupFailed\) \{\s*\n\s*return \{\s*\n\s*ok: false as const,\s*\n\s*response: tailscaleCleanupFailureResponse\(mutation, backend\),/,
  "a timed-out Serve mutation aborts before post-status discovery",
);
assert.match(
  route,
  /async function mutateOwnedServeRoute\([\s\S]+?const beforeMutation = await readServeStatus\(backend\);[\s\S]+?serveStatusFingerprint\(beforeMutation\.status\)[\s\S]+?serveStatusFingerprint\(expectedStatus\)[\s\S]+?const mutation = await runTailscale\(args\);/,
  "every direct API mutation rereads and compares complete Serve status after probing and immediately before mutation",
);
assert.equal(
  route.match(/mutateOwnedServeRoute\([\s\S]{0,180}?(?:ownership\.status|serveStatus),\s*\)/g)?.length,
  3,
  "native HTTPS, native HTTP fallback, and browser handoff mutations all carry their inspected status into the final race guard",
);

// Every read/decide/mutate sequence shares one bounded machine-wide lease with
// the Rust desktop repair loop. In particular, reset must reacquire and reread
// status while holding the lease so a waiting dev process cannot erase a
// packaged route that won ownership before it entered the critical section.
assert.match(
  route,
  /acquireTailscaleServeLease/,
  "the route imports the shared cross-process Serve lease",
);
assert.match(
  route,
  /async function withServeMutationLease[\s\S]+?const lease = await acquireTailscaleServeLease\(\);[\s\S]+?if \(!lease\)[\s\S]+?503[\s\S]+?try \{[\s\S]+?return await operation\(\);[\s\S]+?finally \{[\s\S]+?await lease\.release\(\);/,
  "lease acquisition is bounded/fail-closed and release is guaranteed",
);
assert.equal(
  route.match(/const res = await withServeMutationLease\(/g)?.length,
  2,
  "app-start and GET/start each arbitrate inside the shared lease",
);
assert.match(
  mobileHandoff,
  /export async function resetTailscaleServeRoute\([\s\S]+?const lease = await acquireLease\(\);[\s\S]+?if \(!lease\) return \{ kind: "busy" \};[\s\S]+?finally \{[\s\S]+?await lease\.release\(\);/,
  "app-stop and explicit reset reacquire and reread ownership inside the shared lease",
);
assert.match(
  route,
  /assessServeOwnership\([\s\S]{0,250}?takeOverHealthyLoopback:\s*packagedServeMayTakeOverHealthyLoopback\(backend\)/,
  "TypeScript grants healthy-loopback takeover only from trusted packaged 3020 evidence",
);
assert.match(
  mobileHandoff,
  /const reset = await runTailscale\(\["serve", "reset"\]\);[\s\S]{0,500}?const verified = await readTailscaleServeStatus\(runTailscale\);/,
  "reset rereads Serve status before reporting success",
);
assert.match(
  route,
  /resetTailscaleServeRoute/,
  "app-stop and explicit reset use the canonical typed Serve reset protocol",
);
assert.match(
  route,
  /if \(action === "reset"\) \{\s*return \(await resetOwnedServeRoute\(backendUrl\(\)\)\)\.response;\s*\}/,
  "explicit reset unwraps the typed reset result without changing credential state",
);
assert.match(
  route,
  /const reset = await resetOwnedServeRoute\(\s*nativeAppBackendUrl\(\),\s*retireMobileAccessSecret,\s*\);[\s\S]{0,500}?return reset\.response;/,
  "app-stop delegates credential retirement to the locked verified-removal callback",
);
assert.match(
  route,
  /const retirement = afterVerifiedRemoval\(\);[\s\S]+?if \(retirement\.kind === "retained"\) \{[\s\S]+?throw new Error\(retirement\.error\);/,
  "credential retirement failure becomes a typed non-success reset result instead of being swallowed",
);
assert.match(
  route,
  /Tailscale Serve removal was verified, but the access credential could not be retired and remains armed\./,
  "partial route-removal success reports that the credential remains armed",
);

console.log("mobile-handoff route.test.ts OK");
