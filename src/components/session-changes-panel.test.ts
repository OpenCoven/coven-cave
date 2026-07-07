// @ts-nocheck
// cave-4op: the working-tree panel's footer outbound-action buttons — Commit
// and Create pull request (primary), Create PR (secondary), Cancel (ghost) —
// use the shared Button primitive, so their radius / height / focus ring /
// disabled treatment come from one place.
//
// Deliberately left bespoke (not standard controls): the file-row and
// checkpoint disclosure toggles, the dense two-step revert/restore confirm
// buttons, the bordered / spin-animated header icon actions, and the alert
// dismiss "×" icons. A follow-up can take the icon-button family.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./session-changes-panel.tsx", import.meta.url), "utf8");

assert.match(
  src,
  /import \{ Button \} from "@\/components\/ui\/button"/,
  "session-changes-panel imports the shared Button primitive",
);

// Scope to the commit/PR footer so the assertions can't be satisfied by an
// unrelated <Button> elsewhere.
const footerStart = src.indexOf("session-changes-panel__commit");
assert.ok(footerStart >= 0, "the commit/PR footer region exists");
const footer = src.slice(footerStart);

assert.match(
  footer,
  /<Button[\s\S]{0,180}variant="primary"[\s\S]{0,220}commitChanges\(\)/,
  "Commit is a primary Button that calls commitChanges()",
);
assert.match(
  footer,
  /<Button[\s\S]{0,180}variant="primary"[\s\S]{0,220}createPr\(\)/,
  "Create pull request is a primary Button that calls createPr()",
);
assert.match(
  footer,
  /<Button[\s\S]{0,160}variant="secondary"[\s\S]{0,160}setPrOpen\(true\)/,
  "Create PR is a secondary Button that opens the PR form",
);
assert.match(
  footer,
  /<Button[\s\S]{0,160}variant="ghost"[\s\S]{0,160}setPrOpen\(false\)/,
  "Cancel is a ghost Button that closes the PR form",
);

// The hand-rolled accent-background action buttons are gone — the primary
// variant now supplies that treatment via .ui-btn--primary.
assert.doesNotMatch(
  footer,
  /bg-\[var\(--accent-presence\)\]/,
  "no hand-rolled accent-bg action buttons remain in the footer",
);

console.log("session-changes-panel.test.ts: cave-4op footer control primitives ok");
