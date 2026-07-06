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

// Finishing setup must record the dismissal exactly like "Skip for now" —
// otherwise the workspace auto-open relaunches the whole wizard for a
// finished user whenever the daemon happens to be down (complete flips false).
assert.match(
  source,
  /const finishOnboarding = useCallback\(\(\) => \{[\s\S]*?localStorage\.setItem\("cave:onboarding:dismissed", "1"\);[\s\S]*?onDismiss\(\);[\s\S]*?\}, \[onDismiss\]\)/,
  "finishing onboarding writes the dismissed flag before closing",
);
assert.equal(
  source.match(/(?:onClick=\{finishOnboarding\}|onOpenCave=\{finishOnboarding\})/g)?.length,
  2,
  "both Open Cave CTAs (footer + meet-familiars step) finish via finishOnboarding",
);

// The shared setup-action error banner must be a live alert with a dismiss —
// every setup action (scaffold, daemon start, familiar create, connection
// save) reports through it, and a silent <div> means SR users never hear
// why their click did nothing.
assert.match(
  source,
  /\{setupError \? \([\s\S]{0,700}?role="alert"/,
  "the setupError banner announces as an alert",
);
assert.match(
  source,
  /onClick=\{\(\) => setSetupError\(null\)\}/,
  "the setupError banner is dismissible so a stale error doesn't outlive a retry",
);

// The empty-list harness retry loop has a failure budget + retry affordance;
// without it a broken /api/harnesses left the runtime grid empty and polling
// silently forever.
assert.match(
  source,
  /const HARNESS_RETRY_BUDGET = 15/,
  "harness retry loop declares a give-up budget",
);
assert.match(
  source,
  /if \(harnessFailures >= HARNESS_RETRY_BUDGET\) return;/,
  "the harness retry interval stops once the budget is spent",
);
assert.match(
  source,
  /harnessesStuck \? \([\s\S]{0,400}?role="alert"/,
  "a spent harness budget surfaces as a retryable alert in the runtime step",
);

// Step progress is announced to screen readers (steps tick via a 2s poll,
// which is visually obvious and otherwise silent), and the spotlighted step
// carries aria-current for AT step navigation.
assert.match(
  source,
  /const \{ announce \} = useAnnouncer\(\)/,
  "the wizard wires the shared polite live region",
);
assert.match(
  source,
  /announce\([\s\S]{0,200}?— done\. Next: step /,
  "completing a step announces the completion and what comes next",
);
assert.match(
  source,
  /aria-current=\{isActive \? "step" : undefined\}/,
  "the active step is exposed via aria-current",
);

console.log("onboarding-polish.test.ts: ok");
