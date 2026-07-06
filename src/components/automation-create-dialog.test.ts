// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./automation-create-dialog.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(source, /import \{ Button \}/, "dialog actions should use the shared Button primitive");
assert.match(source, /StandardSelect/, "dialog dropdowns should use the shared StandardSelect primitive");
assert.doesNotMatch(source, /<button\b/, "dialog should not hand-roll button controls");
assert.doesNotMatch(source, /rounded-md|rounded-lg/, "dialog controls should use radius tokens instead of hard-coded radii");
assert.match(source, /automation-create-dialog__hero/, "new automation editor should have a structured hero/header");
assert.match(source, /automation-create-dialog__section/, "new automation editor should group fields into scan-friendly sections");
assert.match(source, /automation-create-dialog__body/, "new automation editor should scroll fields separately from the action footer");
assert.match(source, /automation-create-dialog__primary-grid/, "name and cadence controls should sit in a compact primary grid");
assert.match(source, /automation-create-dialog__prompt-grid/, "goals and deliverables should be grouped together");
assert.match(source, /automation-create-dialog__runtime-grid/, "runtime settings should be grouped in a responsive grid");
assert.match(source, /automation-create-dialog__scope-grid/, "working directories, tags, and skill should be grouped in the scope section");
assert.match(source, /automation-create-dialog__footer/, "new automation editor should have a stable action footer");
assert.match(styles, /\.workflow-dialog[\s\S]*height: 100dvh;[\s\S]*overflow: hidden;/, "drawer should own the viewport height without scrolling");
assert.match(styles, /\.automation-create-dialog__body[\s\S]*min-height: 0;[\s\S]*overflow-y: auto;/, "dialog body should be the scroll container");

console.log("automation-create-dialog.test.ts: ok");
