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
const rows = readFileSync(new URL("./session-changes-rows.tsx", import.meta.url), "utf8");

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
  rows,
  /<IconButton[\s\S]{0,80}icon=\{untracked \? "ph:trash" : "ph:arrow-counter-clockwise"\}[\s\S]{0,60}danger/,
  "file-row revert/delete remains a danger IconButton in the row presentation boundary",
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

// cave-bvbw: the jump-to-diff focus must apply each nonce exactly once. The
// effect is (deliberately) keyed on filesSig so a late-appearing file still
// gets focused — but filesSig churns on every 5s poll while an agent edits,
// and an unguarded effect re-expanded the stale focus target on every refresh,
// snapping the panel away from the diff the user had manually selected.
assert.match(
  src,
  /appliedFocusNonceRef\.current === focusNonce\) return;/,
  "a consumed focus nonce must not re-assert itself on poll refreshes",
);
assert.match(
  src,
  /if \(!match\) return;\s*\n\s*appliedFocusNonceRef\.current = focusNonce;/,
  "the nonce is consumed only once a match lands (retry stays alive for late-appearing files)",
);
assert.match(
  src,
  /long === short \|\| long\.endsWith\(`\/\$\{short\}`\)/,
  "focus matching aligns on / boundaries — bare string suffixes cross-match sibling files",
);

// ── Commit review action (cave-nqoy) ─────────────────────────────────────────
// The toolbar's Review button starts a NEW chat session whose opening prompt
// reviews the working-tree changes like a commit review, routed through the
// cave:agents-new-chat bridge (Workspace opens the chat from the Code surface;
// ChatSurface handles it when the panel lives in chat).
assert.match(
  src,
  /import \{ buildChangesReviewPrompt \} from "@\/lib\/changes-review"/,
  "the review prompt comes from the pure changes-review helper",
);
assert.match(
  src,
  /new CustomEvent\("cave:agents-new-chat", \{\s*\n\s*detail: \{\s*\n\s*projectRoot: root,\s*\n\s*initialPrompt: buildChangesReviewPrompt\(\{ repoRoot: root, files \}\),/,
  "Review dispatches a new-chat event carrying the project root and the review prompt",
);
assert.match(
  src,
  /const root = repoRoot \?\? projectRoot;/,
  "the review targets the resolved git root, falling back to the project root",
);
assert.match(
  src,
  /leadingIcon="ph:git-diff"[\s\S]{0,240}?onClick=\{startReviewSession\}\s*\n\s*disabled=\{!canCommit\}[\s\S]{0,200}?aria-label="Review changes in a new session"/,
  "the Review button is labeled for AT and disabled when there is nothing to review",
);
assert.match(
  src,
  /announce\("Review session started on the working-tree changes\."\)/,
  "starting a review announces the outcome",
);

console.log("session-changes-panel.test.ts: cave-4op footer + icon-button control primitives ok");
