import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./research-tab-resources.tsx", import.meta.url), "utf8");

test("resources render real SavedLink fields only — no fabricated stats", () => {
  // The store holds url/title/category/addedAt/source; everything shown is
  // one of those or derived (domain, cited-by). The design's invented
  // stars/forks/read-times/comment-counts must never appear.
  for (const fabricated of [/stars/i, /\bforks\b/i, /read.time/i, /comment count/i, /★/]) {
    assert.doesNotMatch(source, fabricated);
  }
  // Real fields drive the cards and the overlay stats strip.
  assert.match(source, /RelativeTime iso=\{link\.addedAt\}/);
  assert.match(source, /RelativeTime iso=\{openLink\.addedAt\}/);
  assert.match(source, /linkDomain\(link\.url\)/);
  assert.match(source, /linkDomain\(openLink\.url\)/);
  assert.match(source, /LINK_CATEGORY_META\[link\.category\]/);
  // Mono title styling is reserved for GitHub links, per the design.
  assert.match(source, /link\.category === "github" \? " research-res-card__title--mono"/);
  // Honest counts: header line and the /save mention (a real chat command).
  assert.match(source, /\{links\.length\} saved · from pastes, \/save, and run citations/);
});

test("cited-by is derived by cross-referencing normalized mission source urls", () => {
  // The index maps normalizeLinkUrl(source.url) → citing missions, and links
  // look themselves up through the same normalization — never a stored count.
  assert.match(source, /for \(const mission of research\.missions\)/);
  assert.match(source, /if \(source\.url\) urls\.add\(normalizeLinkUrl\(source\.url\)\)/);
  assert.match(source, /citedByIndex\.get\(normalizeLinkUrl\(link\.url\)\)/);
  // Cards surface the count only when N > 0.
  assert.match(source, /cited\.length > 0 \?/);
  assert.match(source, /cited by \{cited\.length\} run\{cited\.length === 1 \? "" : "s"\}/);
  // Overlay chips jump to the citing run on the Desk.
  assert.match(source, /onNavigate\("desk", \{ missionId: mission\.id \}\)/);
  // The uncited nudge is derived from the same cross-reference and routes to
  // the Prompt tab — no invented report names in the copy.
  assert.match(source, /links\.filter\(\(link\) => citingMissions\(link\)\.length === 0\)\.length/);
  assert.match(source, /uncitedCount > 0 \?/);
  assert.match(source, /onNavigate\("prompt"\)/);
  assert.match(source, /Draft the brief/);
});

test("add-to-run uses the evidence ledger's attach-source candidate mechanism", () => {
  // Same action, same shape: candidate status, web sourceType, on the
  // currently selected mission via research.act.
  assert.match(source, /action: "attach-source"/);
  assert.match(source, /status: "candidate"/);
  assert.match(source, /sourceType: "web"/);
  assert.match(source, /await act\(selectedMission\.id, \{/);
  // Disabled with a hint when no mission is selected.
  assert.match(source, /disabled=\{!selectedMission \|\| attachBusy/);
  assert.match(source, /Select a run on the Desk first/);
  // Already-attached links (normalized-url match) can't be attached twice.
  assert.match(source, /selectedMission\.sources\.some\(\s*\(source\) => source\.url && normalizeLinkUrl\(source\.url\) === key/);
});

test("remove is a two-step inline confirm wired to useResearchLinks.remove", () => {
  assert.match(source, /Remove from saves/);
  assert.match(source, /Remove this save\? It leaves Resources and quick saves\./);
  assert.match(source, /Yes, remove/);
  assert.match(source, /\{confirmingRemove \?/);
  assert.match(source, />\s*Keep\s*<\/Button>/);
  assert.match(source, /setConfirmingRemove\(true\)/);
  assert.match(source, /await remove\(openLink\.id\)/);
  // Opening a different resource never inherits a pending confirm.
  assert.match(source, /setConfirmingRemove\(false\);\s*setCopied\(false\);\s*\}, \[openId\]\)/);
});

test("grid/rows view persists under cave:research:res-view with an SSR guard", () => {
  assert.match(source, /const VIEW_STORAGE_KEY = "cave:research:res-view"/);
  // Read and write are both guarded for import-safety under node --test.
  assert.match(source, /function readStoredView\(\): ResourceView \{\s*if \(typeof window === "undefined"\) return "grid";/);
  assert.match(source, /setView\(next\);\s*if \(typeof window === "undefined"\) return;/);
  assert.match(source, /window\.localStorage\.setItem\(VIEW_STORAGE_KEY, next\)/);
  // Unknown stored values fall back to grid instead of crashing the layout.
  assert.match(source, /=== "rows" \? "rows" : "grid"/);
  // The seg toggle exposes a pressed state on both options.
  assert.match(source, /aria-pressed=\{view === "grid"\}/);
  assert.match(source, /aria-pressed=\{view === "rows"\}/);
});

test("detail overlay is a focus-trapped dialog with honest copy/open actions", () => {
  assert.match(source, /useFocusTrap\(Boolean\(openLink\), dialogRef, \{ onEscape: closeOverlay \}\)/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-labelledby="research-res-overlay-title"/);
  assert.match(source, /tabIndex=\{-1\}/);
  // Copy flashes ✓ for 1200ms (a text/icon swap — reduced-motion safe) and
  // Open goes through the surface context, not a raw anchor.
  assert.match(source, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(source, /setTimeout\(\(\) => setCopied\(false\), 1200\)/);
  assert.match(source, /context\.openUrl\(openLink\.url\)/);
});

test("save row reports the extraction result honestly via role=status", () => {
  // The dashed paste target is a real input wired to useResearchLinks.save;
  // added/duplicates/no-links outcomes each get their own truthful line.
  assert.match(source, /const result = await save\(draft\)/);
  assert.match(source, /No links found in that text\./);
  assert.match(source, /skipped \$\{result\.duplicates\} duplicate/);
  assert.match(source, /role="status"/);
});
