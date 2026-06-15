// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const entry = await readFile(new URL("./salem-pathfinder-entry.tsx", import.meta.url), "utf8");
const onboarding = await readFile(new URL("../onboarding-overlay.tsx", import.meta.url), "utf8");

// Entry component contract
assert.match(entry, /export function SalemPathfinderEntry/, "exports SalemPathfinderEntry");
assert.match(entry, /\/api\/salem\/pathfinder/, "posts to the pathfinder route");
assert.match(entry, /mode === "setup" \? "slim"/, "setup defaults to a slim card");
assert.match(entry, /<SalemPathfinderCard/, "renders the card");
assert.match(entry, /onRunDoctor=\{onRunDoctor\}/, "passes the run-doctor handler through");
assert.match(entry, /machineState,?\n?\s*caveState/, "forwards safe machine + cave state");
// Posts the mode in the request body so the route picks setup vs home behavior.
assert.match(entry, /mode,/, "posts the request mode");
// Accessible input: a labelled control, not a placeholder-only field.
assert.match(entry, /aria-label=\{label\}/, "input carries an accessible label");
// Honest UI: the card only renders once a response card exists.
assert.match(entry, /card \?\s*\(/, "no card is shown before a response");
// Honest UI: an explicit error state when the route can't map a path.
assert.match(entry, /setError\(true\)/, "sets an error state on failure");
assert.match(entry, /error \?\s*\(/, "renders the error state");
assert.match(entry, /salem-pf-entry__error/, "error state uses the error class");

// Setup wiring in onboarding-overlay
assert.match(onboarding, /import \{ SalemPathfinderEntry \}/, "onboarding imports the entry");
assert.match(onboarding, /<SalemPathfinderEntry/, "onboarding mounts the entry");
assert.match(onboarding, /mode="setup"/, "mounted in setup mode");
assert.match(onboarding, /density="slim"/, "setup uses the slim card");
assert.match(onboarding, /onRunDoctor=\{\(\) => void recheckNow\(\)\}/, "run-doctor wired to the re-check");
assert.match(onboarding, /!status\?\.complete \? \(/, "entry shows while setup is incomplete");
// Privacy: machine state is platform/health only — never secrets/tokens/logs.
assert.match(onboarding, /salemMachineState/, "derives a safe machine-state object");
assert.doesNotMatch(onboarding, /salemMachineState[\s\S]{0,400}(token|secret|env\b)/i, "machine state carries no secrets");

console.log("salem-pathfinder-entry.test.ts OK");
