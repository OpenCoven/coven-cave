import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./research-tab-resources.tsx", import.meta.url), "utf8");
const xSources = readFileSync(new URL("./research-x-sources.tsx", import.meta.url), "utf8");
const emptyState = readFileSync(new URL("../ui/empty-state.tsx", import.meta.url), "utf8");
const styles = readFileSync(
  new URL("../../styles/globals/surface-research-resources.css", import.meta.url),
  "utf8",
);

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
  assert.match(source, /linkCategoryMeta\(link\.category\)/);
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
  // Cards surface an honest citation state for both cited and uncited links.
  assert.match(source, /cited\.length > 0\s*\?/);
  assert.match(
    source,
    /`Cited by \$\{cited\.length\} \$\{cited\.length === 1 \? "run" : "runs"\}`/,
  );
  assert.match(source, /"Not cited yet"/);
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
  // No-mission and already-attached states are explicit instead of presenting
  // an unexplained disabled action.
  assert.match(source, /\) : selectedMission \? \(/);
  assert.match(source, /disabled=\{attachBusy\}/);
  assert.match(source, /Select a run on the Desk first/);
  assert.match(source, /Select a run to add/);
  assert.match(source, /In this run/);
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
  // Copy goes through lib/clipboard's copyText — navigator.clipboard is
  // undefined outside secure contexts (packaged Tauri, plain-http LAN), so
  // the raw API silently no-ops there while copyText falls back to
  // execCommand and reports whether the copy landed. The ✓ flash (1200ms
  // text/icon swap — reduced-motion safe) only shows on real success, and a
  // failure is announced assertively. Open goes through the surface context,
  // not a raw anchor.
  assert.match(source, /import \{ copyText \} from "@\/lib\/clipboard"/);
  assert.match(source, /const ok = await copyText\(url\)/);
  assert.match(source, /announce\("Couldn’t copy the link\.", "assertive"\)/);
  assert.doesNotMatch(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /setTimeout\(\(\) => setCopied\(false\), 1200\)/);
  assert.match(source, /context\.openUrl\(openLink\.url\)/);
});

test("resources expose a labeled multiline batch intake with truthful preview", () => {
  assert.match(source, /summarizeLinkIntake\(draft, links\)/);
  assert.match(source, /<label htmlFor="research-resource-intake">Add resources<\/label>/);
  assert.match(source, /<textarea[\s\S]*id="research-resource-intake"/);
  assert.match(
    source,
    /className="research-res__paste focus-ring"/,
    "the new textarea uses the shared focus-ring contract",
  );
  assert.doesNotMatch(
    styles,
    /\.research-res__paste:focus-visible/,
    "surface CSS must not override the shared focus-ring token",
  );
  assert.match(
    source,
    /aria-describedby="research-resource-intake-help research-resource-intake-preview"/,
  );
  assert.match(
    source,
    /aria-keyshortcuts="Meta\+Enter Control\+Enter"/,
    "the advertised submit shortcut is exposed to assistive technology",
  );
  assert.match(
    source,
    /Paste up to \{MAX_LINKS_PER_SAVE\} links, separated by commas or line breaks\./,
  );
  assert.match(source, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(source, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.match(source, />\s*Save resources\s*<\/Button>/);
  assert.doesNotMatch(source, /research-res__saverow/);
});

test("batch save feedback uses resource vocabulary and preserves duplicate-only drafts", () => {
  assert.match(source, /const submittedDraft = draft;\s*setSaving\(true\);\s*const result = await save\(submittedDraft\)/);
  assert.match(source, /No links found\. Paste full http:\/\/ or https:\/\/ URLs\./);
  assert.match(source, /All \$\{result\.duplicates\}[\s\S]{0,160}already saved/);
  assert.match(source, /Saved \$\{result\.added\}[\s\S]{0,160}resource/);
  assert.match(
    source,
    /if \(result\.added > 0\)[\s\S]*setDraft\(\(current\) => current === submittedDraft \? "" : current\)/,
    "a completed save only clears the batch that was actually submitted",
  );
  assert.match(source, /role="status"/);
});

test("resources filter by type before workflow-first grouping", () => {
  assert.match(
    source,
    /groupSavedLinksByUsage\(\s*visibleLinks,\s*citedByIndex,\s*selectedMission\?\.id/,
  );
  assert.doesNotMatch(source, /groupSavedLinks\(/);
  assert.match(source, /<SearchInput/);
  assert.match(source, /placeholder="Search resources…"/);
  assert.match(source, /setQuery\(""\);\s*setFilter\("all"\)/);
  assert.match(source, />\s*Clear filters\s*<\/Button>/);
});

test("resource cards and details keep actions in predictable footers", () => {
  assert.match(source, /className="research-res-card__footer"/);
  assert.match(source, /context\.openUrl\(link\.url\)/);
  assert.match(source, />\s*Open link\s*<\/Button>/);
  assert.match(source, /In this run/);
  assert.match(source, /Select a run to add/);
  assert.match(source, /className="research-res-overlay__primary-actions"/);
  assert.match(source, /context\.openUrl\(openLink\.url\)/);
  assert.match(styles, /\.research-res-card__footer/);
  assert.match(styles, /@container research-desk \(max-width: 560px\)/);
});

test("Resources mounts Grab from X inline without changing the five-tab host", () => {
  assert.match(source, /import \{ ResearchXSources \} from "\.\/research-x-sources"/);
  assert.match(
    source,
    /<ResearchXSources\s+familiar=\{context\.activeFamiliar\}\s+selectedMissionId=\{selectedMission\?\.id \?\? null\}\s+onMissionAttached=\{research\.applyMission\}/,
  );
  assert.match(source, /<ResearchXSources[\s\S]*<form className="research-res__intake"/);
});

test("X source links use theme-aware text contrast instead of the fixed research accent", () => {
  assert.match(styles, /\.research-x-post__link:hover\s*\{\s*color: var\(--text-primary\);/);
  assert.doesNotMatch(
    styles,
    /\.research-x-post__link:hover\s*\{\s*color: var\(--research-accent\);/,
  );
});

test("X source ownership remounts by familiar/grant and same-scope retries claim a new generation", () => {
  assert.match(
    xSources,
    /return <ResearchXSourcesScope key=\{scopeKey\} \{\.\.\.props\} \/>;/,
  );
  assert.match(xSources, /const generation = \+\+generationRef\.current;/);
  assert.match(xSources, /setLookupBusy\(false\);[\s\S]*setSearchBusy\(false\);/);
});

test("X source mutations validate mission identity and preserve newer reads without stealing focus", () => {
  assert.match(xSources, /const mission = parseResearchMission\(value\.mission\);/);
  assert.match(xSources, /mission\.id === requestedMissionId/);
  assert.match(xSources, /mission\.familiarId === familiar\.id/);
  assert.doesNotMatch(xSources, /value\.mission as ResearchMission/);
  assert.match(xSources, /const sourceReadEpoch = sourceMutationEpochRef\.current;/);
  assert.match(xSources, /mergeSourceRead\(current, parsed as SavedXSourceView\[\]\)/);
  assert.match(xSources, /const refreshButtonRefs = useRef\(new Map<string, HTMLButtonElement>\(\)\);/);
  assert.match(xSources, /function focusBelongsToSourceCard\(/);
  assert.match(xSources, /sourceCard\?\.contains\(activeElement as Node\) === true/);
  assert.match(xSources, /function trackRefreshFocus\(/);
  assert.match(xSources, /ownerDocument\.addEventListener\("pointerdown", onPointerDown, true\);/);
  assert.match(xSources, /ownerDocument\.addEventListener\("focusin", onFocusIn, true\);/);
  assert.match(xSources, /!focusOwnership\.movedElsewhere/);
  assert.match(xSources, /focusOwnership\.ownerDocument\.body/);
  assert.match(xSources, /\|\| retainedDisabledFocus\) \{\s*sourceCard\?\.focus\(\);/);
  assert.match(xSources, /pendingRefreshFocusRef\.current = \{\s*sourceId: source\.id,/);
  assert.match(xSources, /if \(activeElement === null \|\| activeElement === pending\.ownerDocument\.body\) \{\s*refreshButton\.focus\(\);/);
  assert.match(xSources, /sourceMutationEpochRef\.current \+= 1;\s*setSources/);
});

test("manual zero-result announcements suppress duplicate EmptyState live output", () => {
  assert.match(xSources, /<EmptyState\s+compact\s+live=\{false\}\s+headline="No X posts found"/);
  assert.match(emptyState, /live = true/);
  assert.match(emptyState, /role=\{live \? "status" : undefined\}/);
});

test("the grid collapses empty tracks, and the card cap is grid-only (cave-93jz1)", () => {
  // Assertions are scoped to ONE rule body each. An unbounded [\s\S]*? from a
  // selector runs to the end of the sheet, which both false-FAILS (an
  // unrelated later `auto-fill` reads as this rule regressing) and
  // false-PASSES (a later `auto-fit` satisfies the check even if this rule
  // was reverted). Slice the body, then assert inside it.
  const ruleBody = (selector: string, from = 0): string => {
    const at = styles.indexOf(selector, from);
    assert.notEqual(at, -1, `missing rule: ${selector}`);
    const open = styles.indexOf("{", at);
    const close = styles.indexOf("}", open);
    assert.ok(open !== -1 && close !== -1, `unterminated rule: ${selector}`);
    return styles.slice(open + 1, close);
  };

  // The base grid rule (the one that declares `display: grid`, not the 560px
  // single-column override that shares its selector).
  const grid = ruleBody('.research-res__items[data-view="grid"]');
  assert.match(grid, /display: grid/, "sliced the base rule, not an override");
  // auto-FILL creates and KEEPS empty tracks, so a group holding fewer links
  // than the row fits leaves its cards stranded at the 250px minimum beside
  // dead space. auto-fit collapses them.
  assert.match(grid, /grid-template-columns: repeat\(auto-fit, minmax\(250px, 1fr\)\)/);
  assert.doesNotMatch(grid, /auto-fill/, "auto-fill strands single-item groups — cave-93jz1");

  // Collapsing alone would stretch ONE saved link across the whole row, so the
  // card carries a cap. Measured: a lone card renders 360px against 255px in a
  // packed row — recognisably the same component.
  assert.match(ruleBody('.research-res-card[data-view="grid"]'), /max-width: 360px/);

  // The cap must not reach the rows view, whose cards span the full surface
  // (measured 1314px at 1440) — capping there shrinks every row to a quarter.
  assert.doesNotMatch(ruleBody(".research-res-card {"), /max-width/);

  // …nor the phone breakpoint's single column (measured 496px filling a 520px
  // viewport), where a cap re-creates the very gap this fixes. Search from the
  // start of that container block so the override, not the base rule, is read.
  const narrowAt = styles.indexOf("@container research-desk (max-width: 560px)");
  assert.notEqual(narrowAt, -1);
  assert.match(ruleBody('.research-res-card[data-view="grid"]', narrowAt), /max-width: none/);
});
