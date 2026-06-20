// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./onboarding-overlay.tsx", import.meta.url), "utf8");

// Refresh-failure tracking
assert.match(
  source,
  /const \[statusFailures, setStatusFailures\] = useState\(0\)/,
  "Onboarding should track consecutive status-poll failures",
);
assert.match(
  source,
  /setStatusFailures\(\(n\) => n \+ 1\)/,
  "Onboarding should increment statusFailures on a failed poll",
);
assert.match(
  source,
  /setStatusFailures\(0\)/,
  "Onboarding should reset statusFailures when a poll succeeds",
);

// The threshold banner — must be reachable from the rendered tree
assert.match(
  source,
  /statusFailures >= 3 \?/,
  "Onboarding should show the unreachable-status banner only after multiple consecutive failures (no single-blip flashes)",
);
assert.match(
  source,
  /Setup status is unreachable\./,
  "Onboarding banner copy should name the failure mode directly",
);
assert.match(
  source,
  /onClick=\{\(\) => void refresh\(\)\}/,
  "Onboarding banner should expose a retry affordance",
);
assert.match(
  source,
  /role="alert"/,
  "Onboarding status-unreachable banner should announce as alert",
);

assert.doesNotMatch(
  source,
  /setTimeout\(onDismiss,\s*1200\)/,
  "Onboarding should not auto-close after setup becomes complete; adding a familiar must leave setup open",
);

// Glyph input validation
assert.match(
  source,
  /aria-invalid=\{familiarGlyph\.trim\(\) !== "" && !familiarGlyph\.trim\(\)\.startsWith\("ph:"\)\}/,
  "Glyph input should mark itself invalid when a non-ph: value is typed",
);
assert.match(
  source,
  /Must start with <code className="font-mono">ph:<\/code>/,
  "Glyph input should explain the validation requirement inline",
);

// Both create buttons should refuse invalid glyphs
const createBlocks = source.match(/disabled=\{[\s\S]*?\}/g) ?? [];
const glyphGated = createBlocks.filter((block) =>
  /familiarGlyph\.trim\(\) !== "" && !familiarGlyph\.trim\(\)\.startsWith\("ph:"\)/.test(
    block,
  ),
);
assert.ok(
  glyphGated.length >= 2,
  `Both create buttons should refuse invalid glyphs; found ${glyphGated.length} guarded block(s)`,
);

assert.match(
  source,
  /enableDemoMode/,
  "Onboarding should let testers activate demo mode during setup",
);

assert.match(
  source,
  /setDemoModeEnabled\(true\)/,
  "Onboarding demo activation should use the shared local-only demo mode toggle",
);

// Install polling gives up after a failure budget so a network drop mid-install
// surfaces an error instead of an "Installing…" spinner that never resolves.
assert.match(
  source,
  /MAX_POLL_FAILURES\s*=\s*30/,
  "install poll caps consecutive failures (~1 min) before giving up",
);
assert.match(
  source,
  /Install timed out — server unreachable\. Try again\./,
  "a timed-out install surfaces a clear, retryable error",
);
assert.match(
  source,
  /\+\+failures >= MAX_POLL_FAILURES\) giveUp\(\)/,
  "both error responses and network throws count toward the give-up budget",
);

console.log("onboarding-polish.test.ts: ok");
