// @ts-nocheck
// cave-4op: the working-tree panel's footer outbound-action buttons — Commit
// and Create pull request (primary), Create PR (secondary), Cancel (ghost) —
// use the shared Button primitive, so their radius / height / focus ring /
// disabled treatment come from one place.
//
// The bordered / bare icon-only buttons are normalized to the borderless
// IconButton (the app-wide convention): file-row revert/delete, checkpoint
// restore/delete, header Save, and the three alert dismiss "×" icons. Refresh
// stays a raw <button> — its inner-glyph animate-spin can't ride the primitive.
//
// Deliberately left bespoke (not standard controls): the file-row and
// checkpoint disclosure toggles, and the dense two-step revert / restore
// confirm buttons (tiny, custom danger-tinted, confirm-flow).
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

// ── cave-4op: icon-only buttons use the borderless IconButton primitive ──────
assert.match(
  src,
  /import \{ IconButton \} from "@\/components\/ui\/icon-button"/,
  "session-changes-panel imports the shared IconButton primitive",
);
assert.match(
  src,
  /<IconButton[\s\S]{0,80}icon=\{untracked \? "ph:trash" : "ph:arrow-counter-clockwise"\}[\s\S]{0,60}danger/,
  "file-row revert/delete is a danger IconButton",
);
assert.match(
  src,
  /<IconButton[\s\S]{0,120}icon="ph:archive"[\s\S]{0,220}saveCheckpoint\(\)/,
  "header Save is an IconButton wired to saveCheckpoint()",
);
assert.equal(
  (src.match(/<IconButton[\s\S]{0,60}icon="ph:x-bold"/g) ?? []).length,
  3,
  "all three alert dismiss × are IconButtons",
);
// The bordered icon-button recipe is gone (normalized to the borderless primitive).
assert.doesNotMatch(src, /const btn =/, "the bordered icon-button recipe (const btn) is removed");
// Refresh stays a raw <button> so its inner-glyph spin animation survives.
assert.match(
  src,
  /ph:arrows-clockwise[\s\S]{0,60}animate-spin/,
  "Refresh stays a raw button to keep its inner-glyph spin",
);

console.log("session-changes-panel.test.ts: cave-4op footer + icon-button control primitives ok");
