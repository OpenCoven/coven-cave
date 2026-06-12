// @ts-nocheck
// Onboarding is a guided, numbered, step-by-step flow: the first incomplete
// required step auto-expands with everything needed inline — one-click
// actions, exact manual commands, and troubleshooting — across macOS,
// Windows, and Linux, with optional SSH runtimes and editable familiars.
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
  /const openStepKey = expandedStep \?\? activeStepKey \?\? "familiars"/,
  "users can expand any step manually; default follows the active step",
);

assert.match(
  source,
  /aria-expanded=\{expanded\}/,
  "step headers expose their expanded state",
);

// Step order: CLI → home → runtime → familiar → daemon → meet, then optional git.
const stepOrder = ["covenCli", "covenHome", "adapters", "binding", "daemon", "familiars", "git"];
let cursor = 0;
for (const key of stepOrder) {
  const at = source.indexOf(`key: "${key}",`, cursor);
  assert.ok(at > -1, `guided step ${key} present and in order`);
  cursor = at;
}

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

assert.match(
  source,
  /sshSetup: \[/,
  "every platform carries SSH key setup instructions",
);

assert.match(
  source,
  /aria-label="Show instructions for platform"/,
  "the platform is switchable so instructions are never locked to autodetect",
);

// ── SSH runtime ─────────────────────────────────────────────────────────────

assert.match(
  source,
  /fetch\("\/api\/onboarding\/ssh-check"/,
  "SSH connections are testable before creating the familiar",
);

assert.match(
  source,
  /Runs on a remote machine \(SSH\)/,
  "the familiar form offers a remote SSH runtime",
);

assert.match(
  source,
  /runtime: \{\s*\n\s*kind: "ssh",\s*\n\s*host: sshHost\.trim\(\),\s*\n\s*cwd: sshCwd\.trim\(\),/,
  "creating a remote familiar sends the ssh runtime to setup",
);

assert.match(
  source,
  /never stores passwords or key material/,
  "SSH copy is explicit that Cave holds no secrets",
);

// ── Editable familiars ──────────────────────────────────────────────────────

assert.match(
  source,
  /useFamiliarStudio/,
  "the overlay can open the Familiar Studio",
);

assert.match(
  source,
  /const editFamiliar = \(id: string\) => \{\s*\n[\s\S]{0,200}openFamiliarStudio\(id\)/,
  "each familiar gets an Edit action that opens the studio",
);

assert.match(
  source,
  /fetch\("\/api\/familiars"/,
  "the final step lists the actual familiars",
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

console.log("onboarding-guided-steps.test.ts: ok");
