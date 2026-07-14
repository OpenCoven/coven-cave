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

// Familiar creation (and its glyph validation) moved to the in-app summoning
// circle — the wizard carries no familiar form fields at all.
assert.doesNotMatch(
  source,
  /familiarGlyph/,
  "the wizard has no familiar glyph field — the summoning circle owns creation",
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
  "exactly two finish CTAs — the above-the-fold completion banner and the footer — both via finishOnboarding (the meet-familiars step stays retired)",
);

// The shared setup-action error banner must be a live alert with a dismiss —
// every setup action (scaffold, daemon start, connection save) reports
// through it, and a silent <div> means SR users never hear why their click
// did nothing.
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

// ── cave-4op: the wizard's primary CTAs use the shared Button primitive ──────
// The four accent-background call-to-action buttons (Create Coven home, Start
// local daemon, Install the Coven CLI, Install <adapter>) render through
// <Button variant="primary">, so their radius / height / focus ring /
// disabled + busy treatment come from one place. The two install CTAs use the
// primitive's `loading` prop for their spinner. Bordered secondary actions,
// option cards, and skip links stay bespoke here.
assert.match(
  source,
  /import \{ Button \} from "@\/components\/ui\/button"/,
  "imports the shared Button primitive",
);
assert.equal(
  (source.match(/<Button\s+variant="primary"/g) ?? []).length,
  4,
  'all four primary CTAs render through <Button variant="primary">',
);
assert.match(
  source,
  /<Button[\s\S]{0,120}variant="primary"[\s\S]{0,160}scaffoldOnly/,
  "Create Coven home is a primary Button",
);
assert.match(
  source,
  /<Button[\s\S]{0,140}loading=\{installBusy\}/,
  "the OpenCoven tools CTA uses the primitive's loading state for its spinner",
);
assert.doesNotMatch(
  source,
  /className="focus-ring inline-flex[^"]*bg-\[var\(--accent-presence\)\][^"]*text-\[var\(--accent-presence-foreground\)\]/,
  "the hand-rolled accent-bg CTA recipe is gone (now Button variant=primary)",
);

// ── cave-uvv7: the finish CTA keeps its promise ──────────────────────────────
// "Open Cave — summon your familiar" must actually open the Summoning Circle
// (requestSummonFamiliar walks to Familiars AND latches the circle open) when
// the wizard's own fresh status shows a live daemon and an empty roster. The
// decision must NOT ride the workspace's daemonRunning poll, which can lag a
// just-auto-started daemon. Skip/Escape stay non-pushy: only finishOnboarding
// summons.
assert.match(
  source,
  /import \{ requestSummonFamiliar \} from "@\/lib\/summon-events"/,
  "the finish path routes through the shared summon-events wiring",
);
assert.match(
  source,
  /const finishOnboarding = useCallback\(\(\) => \{[\s\S]*?if \(s\?\.daemon\.ok && !s\.familiars\.ok\) requestSummonFamiliar\(\);[\s\S]*?onDismiss\(\);/,
  "finishOnboarding opens the Summoning Circle for a familiar-less machine with a live daemon",
);
assert.equal(
  (source.match(/requestSummonFamiliar\(\);/g) ?? []).length,
  1,
  "only the finish CTA summons the circle — Skip for now and Escape never do",
);

// ── cave-uvv7: three-beat journey strip ──────────────────────────────────────
// The wizard is beat one of Set up → Summon → First chat; the strip keeps the
// page from reading as a dead-ended infra checklist.
assert.match(
  source,
  /function JourneyStrip\(/,
  "the journey strip component exists",
);
assert.match(
  source,
  /aria-label="First-run journey"/,
  "the journey strip is labelled for assistive tech",
);
for (const beat of ["Set up Cave", "Summon a familiar", "First chat"]) {
  assert.match(
    source,
    new RegExp(`label: "${beat}"`),
    `journey strip carries the "${beat}" beat`,
  );
}
assert.match(
  source,
  /<JourneyStrip\s+setupDone=\{setupComplete\}\s+familiarDone=\{hasFamiliars\}/,
  "the strip's beats derive from live status (server complete / familiars step)",
);

// ── cave-uvv7: completion surfaces above the fold ────────────────────────────
// The footer CTA sits below the fold of a long page; when the last step ticks
// the user must see the next action without scrolling.
assert.match(
  source,
  /\{setupComplete \? \([\s\S]{0,1200}?Setup complete — Cave is ready\./,
  "a completion banner renders at the top of the wizard once setup is done",
);
assert.match(
  source,
  /\{hasFamiliars \? "Open Cave" : "Open Cave — summon your familiar"\}/,
  "the footer CTA only promises a summoning when the roster is actually empty",
);

console.log("onboarding-polish.test.ts: ok");
