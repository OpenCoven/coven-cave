// @ts-nocheck
// #5930: GitHub rejects APPROVE and REQUEST_CHANGES from a pull request's
// author ("Can not approve your own pull request"). Both review surfaces ask
// the routes whether you wrote the PR, offer Comment only when you did, and
// show the shared one-line reason. Source pins: these components need a live
// GitHub read to render, and the verb gating is the contract to keep.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const composer = read("./github-card-composer.tsx");
const card = read("./github-card.tsx");
const panel = read("./code-session-pr-panel.tsx");

test("the card carries the item route's viewerIsAuthor through to the composer", () => {
  assert.match(card, /viewerIsAuthor\?: boolean \| null;/, "the card's pull detail knows the field");
  assert.match(composer, /viewerIsAuthor\?: boolean \| null;/, "the composer item's pull block knows the field");
});

test("the composer offers Comment (and merge) only on your own PR", () => {
  assert.match(composer, /const ownPull = item\.isPull && item\.pull\?\.viewerIsAuthor === true;/);
  assert.match(
    composer,
    /mergeable\s*\?\s*ownPull\s*\?\s*\(\["comment", "merge"\] as Mode\[\]\)\s*:\s*\(\["comment", "approve", "request", "merge"\] as Mode\[\]\)/,
    "approve and request changes are never rendered on your own PR",
  );
  assert.match(composer, /viewerIsAuthor: item\.pull\?\.viewerIsAuthor \?\? null,/, "the palette is gated too");
  assert.match(
    composer,
    /if \(ownPull && \(mode === "approve" \|\| mode === "request"\)\) setMode\("comment"\);/,
    "a verb picked before the authorship read lands falls back to Comment",
  );
  assert.match(composer, /\{ownPull && mergeable \? <p className="ghc-own-note">\{OWN_PR_REVIEW_NOTE\}<\/p> : null\}/);
});

test("the Code PR panel hides Approve on your own PR and says why", () => {
  assert.match(panel, /viewerIsAuthor: boolean \| null/, "the checks read carries authorship");
  assert.match(panel, /const ownPull = checks\.phase === "ready" && checks\.viewerIsAuthor === true;/);
  assert.match(panel, /\{ownPull \? null : \(\s*<Button[\s\S]{0,400}onClick=\{\(\) => review\("APPROVE"\)\}/);
  assert.match(panel, /\{ownPull \? <p[^>]*>\{OWN_PR_REVIEW_NOTE\}<\/p> : null\}/);
});
