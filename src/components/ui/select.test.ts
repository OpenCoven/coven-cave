// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./select.tsx", import.meta.url), "utf8");

assert.match(source, /export function StandardSelect/, "exports the StandardSelect primitive");
assert.doesNotMatch(
  source,
  /import \{ Button \} from "@\/components\/ui\/button"/,
  "StandardSelect trigger should not import the shared Button primitive",
);
assert.doesNotMatch(
  source,
  /<Button[\s\S]*variant="secondary"[\s\S]*size="md"/,
  "StandardSelect trigger should not force .ui-btn/.ui-btn--secondary chrome over call-site select classes",
);
assert.match(
  source,
  /<button[\s\S]*className=\{\[[\s\S]*"standard-select-trigger[\s\S]*className \?\? ""/,
  "StandardSelect trigger should be a plain button with a reset hook and caller className applied",
);
assert.match(
  source,
  /ref=\{triggerRef\}[\s\S]*aria-haspopup="menu"[\s\S]*aria-expanded=\{open\}/,
  "plain trigger should preserve popover anchoring and menu accessibility",
);

console.log("select.test.ts OK");
