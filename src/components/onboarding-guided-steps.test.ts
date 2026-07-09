// @ts-nocheck
// Onboarding is a guided, numbered, step-by-step flow: the first incomplete
// required step auto-expands with everything needed inline — one-click
// actions, exact manual commands, and troubleshooting — across macOS,
// Windows, and Linux. The wizard stops at INFRASTRUCTURE (tools, home,
// runtime, daemon): familiar creation lives exclusively in the app's
// Familiar Summoning Circle (see familiar-summoning-circle.test.ts).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./onboarding-overlay.tsx", import.meta.url),
  "utf8",
);

// ── Guided stepper structure ────────────────────────────────────────────────

assert.match(
  source,
  /<ol className="flex flex-col gap-3" aria-label="Setup steps">/,
  "steps render as an ordered list",
);

assert.match(
  source,
  /const firstIncomplete = steps\.find\(\(s\) => !s\.optional && !s\.ok\)/,
  "the spotlighted step is the first incomplete required step",
);

assert.match(
  source,
  /const openStepKey = expandedStep \?\? activeStepKey \?\? "daemon"/,
  "users can expand any step manually; default follows the active step",
);

assert.match(
  source,
  /aria-expanded=\{expanded\}/,
  "step headers expose their expanded state",
);

// Step order: CLI -> home -> runtime -> daemon, then optional git. The wizard
// ends at infrastructure — no familiar-creation or meet-your-familiars steps.
const stepOrder = ["covenCli", "covenHome", "adapters", "daemon", "git"];
let cursor = 0;
for (const key of stepOrder) {
  const at = source.indexOf(`key: "${key}",`, cursor);
  assert.ok(at > -1, `guided step ${key} present and in order`);
  cursor = at;
}
for (const gone of ['key: "binding",', 'key: "familiars",']) {
  assert.ok(
    !source.includes(gone),
    `retired wizard step ${gone} must not return — creation lives in the summoning circle`,
  );
}

// ── Familiar creation is fully out of the wizard ────────────────────────────

assert.doesNotMatch(
  source,
  /StepFamiliar|StepMeetFamiliars/,
  "the familiar-creation step components are retired",
);
assert.doesNotMatch(
  source,
  /onboarding\/ssh-check|openclaw-agents/,
  "SSH checks and OpenClaw agent discovery moved into the summoning circle",
);
assert.doesNotMatch(
  source,
  /familiar:\s*\{/,
  "the wizard never posts a familiar draft to /api/onboarding/setup",
);
assert.match(
  source,
  /Open Cave — summon your familiar/,
  "the completion CTA hands off to the in-app summoning circle",
);
assert.match(
  source,
  /once you're inside Cave \(Familiars → Summon familiar\)/,
  "the OpenClaw install card points at the in-app summoning path",
);

// ── One-click installs ──────────────────────────────────────────────────────

assert.match(
  source,
  /fetch\("\/api\/onboarding\/install"/,
  "one-click installs call the allowlisted install endpoint",
);

assert.match(
  source,
  /const HARNESS_ONE_CLICK/,
  "harnesses with an npm package get one-click install buttons",
);

assert.match(
  source,
  /@openai\/codex[\s\S]*@anthropic-ai\/claude-code/,
  "Codex and Claude Code carry their exact install commands",
);

assert.match(
  source,
  /npmMissing/,
  "a missing npm is detected and routed to Node.js setup guidance",
);

assert.match(
  source,
  /NodeSetupNotice/,
  "Node.js setup instructions render inline when npm is missing",
);

// ── Cross-platform instructions ─────────────────────────────────────────────

for (const platform of ["windows", "linux", "mac"]) {
  assert.match(
    source,
    new RegExp(`${platform}: \\{\\s*\\n\\s*label:`),
    `PLATFORM_COPY covers ${platform}`,
  );
}

assert.match(
  source,
  /nodeSetup: \[/,
  "every platform carries Node.js fallback instructions",
);

assert.doesNotMatch(
  source,
  /sshSetup/,
  "SSH key setup copy left with the familiar step — the circle owns SSH now",
);

assert.doesNotMatch(
  source,
  /aria-label="Show instructions for platform"/,
  "the first-viewport welcome/platform selector is removed from startup",
);

assert.doesNotMatch(
  source,
  /setShownPlatform/,
  "startup no longer keeps visible platform-selector state",
);

assert.match(
  source,
  /const platformCopy = PLATFORM_COPY\[platform\]/,
  "startup still uses detected platform copy for install commands",
);

// ── OpenClaw bridge (runtime step) ──────────────────────────────────────────

assert.match(
  source,
  /OPENCLAW_AGENT_ROOT = "~\/\.openclaw\/agents"/,
  "OpenClaw startup copy centralizes the agent discovery root",
);

assert.match(
  source,
  /Bridge existing OpenClaw agents into Cave/,
  "the OpenClaw install card explains the bridge startup path",
);

assert.match(
  source,
  /saveOnboardingConnection/,
  "onboarding should provide a setup-time save path for local/server hub routing",
);

assert.match(
  source,
  /body: JSON\.stringify\(\{ multiHost: \{ mode: onboardingMultiHostMode, hubUrl: onboardingHubUrl, executorUrls: parseOnboardingExecutorUrls\(onboardingExecutorText\) \} \}\)/,
  "onboarding should persist hub URL and executor addresses through /api/onboarding/setup",
);

assert.match(
  source,
  /Server hub URL/,
  "onboarding daemon step should expose the server hub URL field",
);

assert.match(
  source,
  /Run this local command:[\s\S]*coven daemon start/,
  "startup daemon step should present the exact local command plainly",
);

assert.match(
  source,
  /Start local daemon \(coven daemon start\)/,
  "startup daemon CTA should name the command it runs",
);

assert.match(
  source,
  /exit code: \$\{json\.exitCode\}/,
  "daemon start errors include the CLI exit code when available",
);

assert.match(
  source,
  /json\.stderr[\s\S]*json\.stdout/,
  "daemon start errors keep CLI stderr/stdout diagnostics visible",
);

assert.doesNotMatch(
  source,
  /useFamiliarStudio|openFamiliarStudio/,
  "familiar editing left the wizard with the meet-your-familiars step — the Studio and the circle own it",
);

assert.doesNotMatch(
  source,
  /fetch\("\/api\/familiars"/,
  "the wizard no longer lists familiars — the roster lives on the Familiars surface",
);

// ── Never stuck ─────────────────────────────────────────────────────────────

assert.match(
  source,
  /Still not found after installing\?/,
  "the CLI step carries a troubleshooting fallback",
);

assert.match(
  source,
  /step 1 below still works and is the usual fix/,
  "the status-unreachable banner points at a concrete next action",
);

assert.match(
  source,
  /or run it yourself:/,
  "every one-click action keeps the manual command alongside",
);

assert.match(
  source,
  /hermes-agent\.nousresearch\.com\/install\.sh/,
  "Hermes one-click uses the official NousResearch installer",
);

assert.match(
  source,
  /windowsCommand: "iex \(irm https:\/\/hermes-agent\.nousresearch\.com\/install\.ps1\)"/,
  "Hermes shows the PowerShell installer on Windows",
);

assert.match(
  source,
  /if \(!open \|\| harnesses\.length > 0\) return;[\s\S]{0,120}setInterval\(\(\) => void loadHarnesses\(\), 2000\)/,
  "harness list retries while empty so a slow first fetch cannot strand the runtime step",
);

// ── Background install jobs (client) ────────────────────────────────────────

assert.match(
  source,
  /installJobs/,
  "per-target install jobs replace the single global busy flag",
);

assert.doesNotMatch(
  source,
  /disabled=\{installBusy !== null\}/,
  "one running install must not disable every other install button",
);

assert.match(
  source,
  /api\/onboarding\/install\?target=/,
  "the client polls the job status endpoint",
);

assert.match(
  source,
  /NPM_INSTALL_TARGETS/,
  "npm-kind targets share a busy lock (mirrors the server's 409)",
);

assert.match(
  source,
  /type InstallTarget =[\s\S]*"coven-cli"[\s\S]*"coven-code"/,
  "startup one-click installs include coven-code as an OpenCoven tool target",
);

assert.match(
  source,
  /"coven-code": "npm"/,
  "coven-code uses the npm install lane",
);

assert.match(
  source,
  /tools=\{status\?\.tools \?\? \[\]\}/,
  "the startup CLI step receives OpenCoven tool status from onboarding status",
);

assert.match(
  source,
  /const covenCodeReady =[\s\S]{0,180}installed[\s\S]{0,80}!.*outdated/,
  "startup should require the latest Coven Code version before treating it as ready",
);

assert.match(
  source,
  /OpenCoven tools/,
  "the startup CLI step renders both OpenCoven tool statuses",
);

assert.match(
  source,
  /onClick=\{\(\) => onInstall\(tool\.id\)\}/,
  "missing or outdated OpenCoven tools install by their allowlisted target id",
);

assert.match(
  source,
  /function openCovenToolStatusText\(tool: OpenCovenToolStatus\): string/,
  "startup formats tool status explicitly instead of treating unknown versions as up to date",
);

assert.match(
  source,
  /Installing… \$\{formatElapsed\(/,
  "busy install buttons show elapsed time, not a frozen label",
);

assert.match(
  source,
  /ph:circle-notch-bold/,
  "busy install buttons show a spinner",
);

assert.match(
  source,
  /\{busy && job \? <InstallLiveTail/,
  "live installer output renders while a job runs",
);

assert.match(
  source,
  /disabled=\{busy \|\|/,
  "the disable rule is per-target (own busy state), not a global lock",
);

assert.match(
  source,
  /<HermesSetupNext onCopy/,
  "a successful Hermes install surfaces the setup next-step at a render site",
);

assert.match(
  source,
  /Show full output/,
  "failed installs expose the full installer output tail",
);


// ── cave-fy1q phase 1: the daemon step auto-starts once ─────────────────────

assert.match(
  source,
  /const daemonAutoStartRef = useRef\(false\)/,
  "one-shot latch is a ref (survives re-renders, StrictMode re-runs)",
);
assert.match(
  source,
  /if \(s\.daemon\.ok\) \{\s*daemonAutoStartRef\.current = true;\s*return;\s*\}/,
  "a daemon that's already up latches — a later crash never triggers a surprise auto-start",
);
assert.match(
  source,
  /if \(!s\.covenCli\.ok \|\| !s\.covenHome\.ok \|\| !s\.adapters\.ok\) return;\s*daemonAutoStartRef\.current = true;\s*void startDaemon\(\);/,
  "auto-start fires only once the wizard has reached the daemon step (all prior infra healthy)",
);
assert.match(
  source,
  /\{startingDaemon \? "Starting…" : "Start local daemon"\}/,
  "the manual button remains — it is the retry affordance when auto-start fails",
);

assert.match(
  source,
  /if \(!open \|\| daemonAutoStartRef\.current\) return;/,
  "auto-start is gated on the overlay being OPEN — hooks run even while it renders null, and a closed wizard must never start the daemon",
);

console.log("onboarding-guided-steps.test.ts: ok");
