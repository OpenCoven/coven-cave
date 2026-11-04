// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = [
  await readFile(
    new URL("./onboarding-bootstrap-overlay.tsx", import.meta.url),
    "utf8",
  ),
  await readFile(new URL("../lib/onboarding-bootstrap.ts", import.meta.url), "utf8"),
].join("\n");
const runtimeStep = await readFile(
  new URL("./onboarding-runtime-step.tsx", import.meta.url),
  "utf8",
);
const lazy = await readFile(new URL("./lazy-surfaces.tsx", import.meta.url), "utf8");
const diagnostics = await readFile(
  new URL("./onboarding-setup-diagnostics.tsx", import.meta.url),
  "utf8",
);
const startupGate = await readFile(
  new URL("./onboarding-startup-gate.tsx", import.meta.url),
  "utf8",
);
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  lazy,
  /import\("@\/components\/onboarding-bootstrap-overlay"\)/,
  "the workspace loads the one-confirmation bootstrap surface",
);
assert.equal(
  source.match(/>\s*Set up Cave\s*</g)?.length,
  2,
  "the heading and one primary confirmation use the approved action copy",
);
assert.match(
  source,
  /aria-label="Setup progress"/,
  "live stages render as one accessible progress list",
);
assert.match(
  source,
  /aria-current=\{state\.activeStage === stage\.id \? "step" : undefined\}/,
  "the running stage is exposed to assistive technology",
);
assert.match(
  source,
  /useFocusTrap\(open && !diagnosticsOpen, dialogRef, \{ onEscape: dismiss \}\)/,
  "the outer trap yields while the nested diagnostics modal owns focus",
);
assert.match(
  source,
  /inert=\{diagnosticsOpen \|\| undefined\}/,
  "the underlying setup dialog leaves interaction and the tab order",
);
assert.doesNotMatch(
  source,
  /aria-hidden=\{diagnosticsOpen \|\| undefined\}/,
  "opening diagnostics does not hide a still-focused descendant with aria-hidden",
);
assert.match(
  source,
  /restoreDiagnosticsFocusRef\.current = true;[\s\S]*?setDiagnosticsOpen\(false\)/,
  "closing diagnostics records that focus must return to its trigger",
);
assert.match(
  source,
  /useFocusTrap\(open && !diagnosticsOpen[\s\S]*?useEffect\(\(\) => \{[\s\S]*?diagnosticsTriggerRef\.current\?\.focus\(\)/,
  "focus restoration runs after the outer trap effect reactivates",
);
assert.match(
  source,
  /if \(!state\.confirmed\) persistDismissal\(\)/,
  "declining setup persists the first-run dismissal",
);
assert.match(
  source,
  /motion-safe:animate-spin/,
  "progress animation respects reduced-motion preferences",
);
assert.match(
  source,
  /requestQueueRef\.current\.then\(\(\) =>\s*performRequest\(method, body\)/,
  "status, confirmation, and resume requests are serialized instead of dropped",
);
assert.match(
  source,
  /initialState\?: OnboardingBootstrapState/,
  "the server-resolved bootstrap state can hydrate the dialog",
);
assert.match(
  source,
  /\(\) => initialState \?\? createOnboardingBootstrapState\(\)/,
  "the hydrated state is used before any client bootstrap request",
);
assert.match(
  source,
  /if \(!open \|\| initialState\) return;/,
  "a server-hydrated dialog does not make an initial bootstrap GET",
);
assert.match(
  source,
  /document\.cookie = "cave_onboarding_dismissed=1;/,
  "a first-run dismissal becomes available to the server on the next launch",
);
assert.match(
  page,
  /await Promise\.all\(\[\s*onboardingBootstrapStatus\(\),\s*cookies\(\),\s*\]\)/s,
  "the root route resolves bootstrap state before choosing the first surface",
);
assert.match(
  page,
  /<OnboardingStartupGate initialState=\{bootstrap\} \/>/,
  "unfinished setup renders its hydrated startup gate instead of Workspace",
);
assert.match(
  startupGate,
  /import\("@\/components\/workspace-app"\)/,
  "the startup gate defers the Workspace bundle until setup exits",
);
assert.match(
  startupGate,
  /<OnboardingOverlay[\s\S]*initialState=\{initialState\}[\s\S]*onDismiss=\{\(\) => setShowWorkspace\(true\)\}/,
  "the first surface is the hydrated dialog and dismissal releases Workspace",
);
assert.doesNotMatch(
  workspace,
  /fetch\("\/api\/onboarding\/bootstrap"/,
  "Workspace no longer waits for a first-run bootstrap request after it mounts",
);
assert.doesNotMatch(
  source,
  /requestInFlightRef\.current\) return null/,
  "a status request cannot swallow a queued confirmation or resume",
);
assert.match(
  source,
  /useAnnouncer\(\)/,
  "stage changes and failures use the shared live region",
);
assert.match(
  source,
  /Provider sign-in is deferred until you first use a familiar/,
  "credential boundaries are explicit in first-run copy",
);
assert.match(
  source,
  /never asks for an administrator password/,
  "elevation boundaries are explicit in first-run copy",
);
assert.match(
  source,
  /Git is optional/,
  "Git remains visibly optional",
);
assert.match(source, /<OnboardingRuntimeStep open=\{open\} onReadyChange=\{setRuntimeReady\} \/>/,
  "the mounted setup dialog offers a runtime after local setup completes");
assert.match(source, /!state\.complete \|\| !runtimeReady/,
  "first run cannot auto-finish before a chat runtime is ready");
assert.match(runtimeStep, /confirmInstall: true/,
  "a runtime install uses the existing confirmed allowlisted API");
assert.match(runtimeStep, /"\/api\/harnesses"/,
  "setup checks existing chat runtimes before offering an install");
assert.match(
  source,
  /private Node\.js and npm runtime, then verify the Coven CLI/,
  "the local-components phase explains its concrete, Cave-owned work",
);
assert.match(
  source,
  /Cave keeps working if you run setup in the background\./,
  "running setup explains safe backgrounding without estimating completion",
);
assert.match(
  source,
  /Next, Cave checks your defaults, then checks the local service\./,
  "running local-component setup explains the remaining stages",
);
assert.match(
  source,
  /does not create Cave defaults or start a familiar runtime/,
  "a local-components failure says which later work did not happen",
);
assert.match(source, />\s*View diagnostics\s*</, "failed setup offers diagnostics beside Retry");
assert.match(
  source,
  /variant="primary"[\s\S]{0,180}?state\.failure\.recoveryLabel/,
  "Retry setup remains the primary recovery action",
);
assert.match(diagnostics, /<Modal/, "diagnostics reuse the shared modal primitive");
assert.match(diagnostics, /copyText\(/, "diagnostics reuse the resilient clipboard helper");
assert.match(diagnostics, /useAnnouncer\(\)/, "copy outcomes use the shared announcer");
assert.match(diagnostics, /select-text/, "diagnostic content remains selectable");
assert.doesNotMatch(
  diagnostics,
  /shell_open_path|invoke\(|Open application-data folder/,
  "diagnostics do not widen native path-opening permissions",
);

// Background re-entry (#5982): leaving a running dialog arms the retained
// latch the shell banner trigger reads, and the dialog feeds the shared
// status store so the banner and Settings render the same state.
assert.match(
  source,
  /const runInBackground = useCallback\(\(\) => \{\s*markSetupBackgrounded\(\);\s*onDismiss\(\);\s*\}, \[onDismiss\]\);/,
  "Run in background arms the latch before dismissing",
);
assert.match(
  source,
  /const dismiss = useCallback\(\(\) => \{\s*if \(state\.status === "running"\) \{\s*runInBackground\(\);\s*return;\s*\}\s*if \(!state\.confirmed\) persistDismissal\(\);/,
  "the close control and Escape background a running setup instead of abandoning it",
);
assert.match(source, /onClick=\{runInBackground\}>\s*Run in background/, "the footer button uses the same path");
assert.match(source, /publishOnboardingBootstrapState\(json\);/, "every server state reaches the shared store");
assert.match(
  source,
  /if \(initialState\) publishOnboardingBootstrapState\(initialState\);/,
  "the hydrated startup state is published without a request",
);
assert.doesNotMatch(
  source,
  /publishOnboardingBootstrapState\(state\)/,
  "the local placeholder state is never published as a reading",
);
assert.match(
  source,
  /setOnboardingDialogOpen\(open\);\s*return \(\) => setOnboardingDialogOpen\(false\);/,
  "the store knows when the dialog is showing progress",
);
assert.match(
  source,
  /if \(open && state\.complete\) clearSetupBackgrounded\(\);/,
  "completion observed in the dialog clears the latch so no duplicate notice follows",
);

console.log("onboarding-bootstrap-overlay.test.ts: ok");

assert.match(source, /state\.complete \? \([\s\S]{0,260}request\("POST", \{ confirm: true \}\)[\s\S]{0,80}Run setup again/,
  "completed setup has an explicit recovery action for a later daemon outage");
