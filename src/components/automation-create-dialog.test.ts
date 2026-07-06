// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./automation-create-dialog.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(source, /import \{ Button \}/, "dialog actions should use the shared Button primitive");
assert.match(source, /StandardSelect/, "dialog dropdowns should use the shared StandardSelect primitive");
assert.doesNotMatch(source, /<button\b/, "dialog should not hand-roll button controls");
assert.doesNotMatch(source, /rounded-md|rounded-lg/, "dialog controls should use radius tokens instead of hard-coded radii");
assert.match(source, /className="workflow-dialog automation-create-dialog"/, "dialog should opt into the automation drawer layout");
for (const section of ["Essentials", "Prompt", "Runtime", "Scope"]) {
  assert.match(source, new RegExp(`<section className="automation-create-dialog__section" aria-label="${section}"`), `${section} section is grouped and labelled`);
}
assert.match(source, /automation-create-dialog__footer/, "dialog actions should use the sticky automation footer");
assert.match(styles, /\.automation-create-dialog__primary-grid[\s\S]*grid-template-columns: minmax\(220px, 0\.8fr\) minmax\(300px, 1\.2fr\)/, "primary fields use a responsive two-column layout");
assert.match(styles, /@media \(max-width: 920px\)[\s\S]*\.automation-create-dialog__primary-grid,[\s\S]*grid-template-columns: 1fr/, "dialog grids collapse on narrow screens");

console.log("automation-create-dialog.test.ts: ok");
