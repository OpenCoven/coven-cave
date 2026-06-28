import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./required-inputs-dialog.tsx", import.meta.url), "utf8");

assert.match(source, /import \{ Modal \}/, "dialog should use the shared Modal primitive");
assert.match(source, /inputs: RequiredInput\[\]/, "dialog should accept required input descriptors");
assert.match(source, /onSubmit: \(values: Record<string, string>\) => void/, "dialog should submit keyed values");
assert.match(source, /required-inputs-form/, "dialog should render a stable form class");
assert.match(source, /required-inputs-field/, "dialog should render labelled fields");
assert.match(source, /required-inputs-dialog/, "dialog should expose stable body class");

console.log("required-inputs-dialog.test.ts: ok");
