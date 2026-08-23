// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./composer-context-pill.tsx", import.meta.url), "utf8");

assert.match(source, /showProject\?: boolean;/, "callers can suppress a redundant project chip");
assert.match(
  source,
  /const showProject = props\.showProject \?\? true;/,
  "existing chat composers keep the project chip by default",
);
assert.match(
  source,
  /\{showProject \? \([\s\S]*aria-label=\{`Project:/,
  "the project trigger is omitted only when explicitly disabled",
);
assert.match(
  source,
  /\{showProject \? \([\s\S]*<ProjectPickerPopover/,
  "the project popover is omitted with its trigger",
);

console.log("composer-context-pill.test.ts: ok");
