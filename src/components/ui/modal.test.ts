// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./modal.tsx", import.meta.url), "utf8");

// The dialog must carry an accessible name. Most call sites pass a breadcrumb and
// no ariaLabel, so the breadcrumb header has to name the dialog via aria-labelledby
// (fall back to aria-label only when there's no breadcrumb). Without this, screen
// readers announce those dialogs with no title.
assert.match(
  src,
  /aria-labelledby=\{breadcrumb \? headingId : undefined\}/,
  "dialog names itself from the breadcrumb header when present",
);
assert.match(
  src,
  /aria-label=\{breadcrumb \? undefined : ariaLabel\}/,
  "dialog falls back to ariaLabel only when there's no breadcrumb",
);
assert.match(src, /const headingId = useId\(\)/, "modal mints a stable id via useId");
assert.match(
  src,
  /className="ui-modal-header-breadcrumb" id=\{headingId\}/,
  "the breadcrumb header carries the id referenced by aria-labelledby",
);

console.log("modal.test.ts: ok");
