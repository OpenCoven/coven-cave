import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./required-inputs-dialog.tsx", import.meta.url), "utf8");

assert.match(source, /import \{ Modal \}/, "dialog should use the shared Modal primitive");
assert.match(source, /inputs: RequiredInput\[\]/, "dialog should accept required input descriptors");
assert.match(source, /onSubmit: \(values: Record<string, string>\) => void/, "dialog should submit keyed values");
assert.match(source, /required-inputs-form/, "dialog should render a stable form class");
assert.match(source, /required-inputs-field/, "dialog should render labelled fields");
assert.match(source, /required-inputs-dialog/, "dialog should expose stable body class");
// Familiar params must be picked from the valid familiar list, not typed free-hand
// (an unknown/empty familiar makes the daemon reject the run).
assert.match(source, /familiarOptions/, "dialog should accept the valid familiar list");
assert.match(source, /input\.control === "familiar"/, "familiar params should render a picker, not a text field");
assert.match(source, /StandardSelect/, "familiar control should render the shared custom select");
assert.doesNotMatch(source, /<select/, "familiar control should not render a native select");
assert.match(source, /hasMissingRequired/, "dialog should explicitly guard required custom-select values");

console.log("required-inputs-dialog.test.ts: ok");
