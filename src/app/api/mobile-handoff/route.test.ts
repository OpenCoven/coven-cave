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
  /async function runTailscale\(args: string\[\], timeoutMs = 8000\): Promise<TailscaleResult> \{\s*\n\s*const first = await runTailscaleOnce\(args, timeoutMs\);\s*\n\s*if \(first\.ok \|\| first\.stderr !== TAILSCALE_TIMED_OUT\) return first;\s*\n\s*return runTailscaleOnce\(args, timeoutMs\);\s*\n\}/,
  "a timed-out probe is retried exactly once before the caller sees a failure",
);
assert.match(
  route,
  /function runTailscaleOnce\(args: string\[\], timeoutMs = 8000\): Promise<TailscaleResult> \{/,
  "the single-attempt spawn logic is a separate function the retry wrapper calls twice at most",
);

console.log("mobile-handoff route.test.ts OK");
