// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const entries = read("./journal-entries.tsx");
const css = read("../../styles/journal.css");
const grimoire = read("../grimoire-view.tsx");

assert.match(css, /\.journal-list \{[\s\S]*?min-width:\s*0;/, "Journal master-detail shell can shrink inside the workspace");
assert.match(css, /\.journal-detail \{[\s\S]*?overflow-y:\s*auto;/, "Journal detail pane scrolls so long entries remain reviewable");
assert.match(css, /\.journal-detail \{[\s\S]*?overflow-x:\s*hidden;/, "Journal detail pane still contains horizontal overflow");
assert.match(
  grimoire,
  /className="grimoire-journal-tab flex h-full min-h-0 overflow-hidden"/,
  "the Grimoire Journal host constrains the detail pane to a real scroll boundary",
);

// ── The journal day rail collapses to a persistent, reachable spine ──────────
assert.match(entries, /JOURNAL_RAIL_COLLAPSED_KEY = "cave:journal:rail-collapsed:v1"/, "journal rail collapse uses a versioned preference");
assert.match(entries, /railCollapsed,\s*setRailCollapsed/, "JournalEntries tracks the day rail's collapsed state");
assert.match(entries, /aria-expanded=\{!railCollapsed\}/, "the rail disclosure exposes its current state");
assert.match(entries, /aria-controls="journal-day-rail-content"/, "the rail disclosure names the controlled content");
assert.match(entries, /aria-label=\{railCollapsed \? "Expand journal entries" : "Collapse journal entries"\}/, "the rail disclosure names the next action");
assert.match(entries, /data-collapsed=\{railCollapsed \? "true" : undefined\}/, "the rail publishes collapsed layout state");
assert.match(entries, /window\.localStorage\.setItem\(JOURNAL_RAIL_COLLAPSED_KEY, String\(next\)\)/, "rail collapse persists locally");
assert.match(css, /\.journal-list__rail\[data-collapsed="true"\] \{[\s\S]*?flex-basis:/, "the collapsed rail becomes a narrow spine");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.journal-list__rail/, "rail motion respects reduced-motion");
assert.match(
  css,
  /transition:\s*width var\(--duration-base\) var\(--ease-standard\),\s*flex-basis var\(--duration-base\) var\(--ease-standard\),\s*padding var\(--duration-base\) var\(--ease-standard\)/,
  "rail motion uses the design-system duration and easing tokens",
);

// JournalEntries can be edited and deleted through the persisted journal API.
assert.match(entries, /editing,\s*setEditing/, "JournalEntries tracks edit mode for daily reflections");
assert.match(entries, /draftReflection,\s*setDraftReflection/, "JournalEntries keeps a reflection edit draft");
assert.match(entries, /function startEdit\(\)/, "JournalEntries exposes an edit action");
assert.match(entries, /async function saveEdit\(text\?: string\): Promise<boolean>/, "JournalEntries saves edited reflections");
assert.match(entries, /fetch\("\/api\/journal",\s*\{[\s\S]*?method:\s*"POST"[\s\S]*?reflection:\s*draft/, "JournalEntries persists edited reflection text through /api/journal POST");
assert.match(entries, /function deleteEntry\(\)/, "JournalEntries exposes a delete action");
assert.match(entries, /fetch\(`\/api\/journal\?date=\$\{encodeURIComponent\(date\)\}`,\s*\{ method: "DELETE" \}/, "JournalEntries deletes the selected persisted day through /api/journal DELETE");
// Delete is deferred + undoable: it routes through the shared useUndoDelete helper.
assert.match(entries, /scheduleDelete\(date,/, "JournalEntries defers the delete through useUndoDelete");
assert.match(entries, /<UndoToast/, "JournalEntries renders an UndoToast for deletes");
assert.match(entries, /aria-label="Edit journal entry"/, "JournalEntries renders an edit affordance");
assert.match(entries, /aria-label="Delete journal entry"/, "JournalEntries renders a delete affordance");
// Edit mode hosts the shared MdEditor (WYSIWYG + markdown modes) in place of
// the old plain textarea. The MdEditor owns Save (⌘S) and Cancel (Escape in
// markdown mode / Cancel button); the draft mirrors back via onChange so the
// header ✓ Save button stays live.
assert.match(entries, /<MdEditor/, "Journal edit mode uses the shared MdEditor");
assert.match(entries, /showHeader=\{false\}/, "Journal reflections have no frontmatter header");
assert.match(entries, /onChange=\{\(raw\) => setDraftReflection\(raw\)\}/, "MdEditor mirrors the draft for the header Save button");
assert.match(entries, /onCancel=\{cancelEdit\}/, "MdEditor cancel exits journal edit mode");
assert.match(entries, /await saveEdit\(raw\)/, "MdEditor save persists through saveEdit");
assert.match(
  entries,
  /if \(wasEditingRef\.current && !editing\) editBtnRef\.current\?\.focus\(\)/,
  "Leaving the journal editor restores focus to the Edit button",
);
assert.match(entries, /ref=\{editBtnRef\}/, "the Edit button is the focus-restore target");
assert.match(
  entries,
  /await loadDays\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?editBtnRef\.current\?\.focus\(\)/,
  "save re-asserts focus on the next frame, after the reload's re-render commits",
);

// JournalEntries is scoped to the selected familiar and its memory coverage.
assert.match(entries, /const selectedFamiliarId = activeFamiliarId \?\? familiars\[0\]\?\.id \?\? null/, "JournalEntries derives one selected familiar scope");
// The list is now fetched whole and filtered client-side by the multiselect
// scope (empty = All), so switching familiars/scope never refetches.
assert.match(entries, /await fetch\(`\/api\/journal`, \{ cache: "no-store" \}\)/, "JournalEntries fetches the full journal day list");
assert.match(entries, /if \(!familiarInScope\(scope, d\.reflectedBy\)\) return false/, "JournalEntries filters the day list by the familiar multiselect scope");
// Entry reads stay coven-wide so a list row written by another familiar always
// opens. Only the inventory-derived stats/context request is familiar-scoped.
assert.match(entries, /const entryQuery = useCallback\(\(slug: string\) => `date=\$\{encodeURIComponent\(slug\)\}`/, "journal entry reads never inherit the active-familiar filter");
assert.match(entries, /const statsQuery = useCallback\(\(slug: string\) => \(\s*selectedFamiliarId\s*\?\s*`date=\$\{encodeURIComponent\(slug\)\}&familiar=\$\{encodeURIComponent\(selectedFamiliarId\)\}`/, "journal stats and generation context use the selected familiar");
assert.match(entries, /fetch\(`\/api\/journal\?\$\{entryQuery\(slug\)\}`/, "loadDay uses the coven-wide entry query");
assert.match(entries, /fetch\(`\/api\/journal\?\$\{statsQuery\(slug\)\}&stats=1`/, "fetchDayStats uses the familiar-scoped stats query");

// ── Perf: the entry paints without waiting for the memory inventory (cave-tgx9)
// The stats block needs a full memory-file inventory walk server-side (~1900
// stats warm, a multi-second head-read scan cold). It used to ride the SAME
// response as the entry, blocking every day selection — and Grimoire's/iOS's
// day reads, which never use stats, paid for it too.
const journalRoute = read("../../app/api/journal/route.ts");
assert.doesNotMatch(
  journalRoute,
  /Promise\.all\(\[readJournalEntry[\s\S]*?listMemoryFileEntries/,
  "Journal day GET must not block the entry read on the memory-inventory scan",
);
assert.match(
  journalRoute,
  /if \(searchParams\.has\("stats"\)\) \{[\s\S]*?listMemoryFileEntries\(\)[\s\S]*?buildJournalMemoryStats[\s\S]*?buildJournalMemoryContext/,
  "Journal route serves the inventory-derived stats block on its own ?stats=1 branch",
);
assert.match(
  entries,
  /fetch\(`\/api\/journal\?\$\{statsQuery\(slug\)\}&stats=1`/,
  "JournalEntries fetches the stats block on a separate non-blocking request",
);
assert.match(
  entries,
  /setDay\(\{ \.\.\.\(json as Omit<JournalDay, "stats" \| "context" \| "sources">\), stats: null, context: null, sources: null \}\)/,
  "JournalEntries paints the entry immediately with stats pending",
);
assert.match(
  entries,
  /prev && prev\.date === slug \? \{ \.\.\.prev, \.\.\.block \} : prev/,
  "Late stats only merge into the same day they were requested for",
);
// If the user hits Generate before the stats fetch lands, the context is
// fetched inline — generation must always carry the memory-scope note.
assert.match(
  entries,
  /const context = day\.context \?\? \(await fetchDayStats\(day\.date\)\)\?\.context \?\? ""/,
  "Generate falls back to an inline context fetch when stats have not arrived",
);
assert.match(entries, /day\.stats\.covenOrigin[\s\S]*?coven files/, "Journal stats include Coven-origin memory files");
assert.match(entries, /day\.stats\.externalRuntimes[\s\S]*?external runtime files/, "Journal stats include external runtime memory files");
assert.match(entries, /day\.stats\.runtimeMemory[\s\S]*?runtime files/, "Journal stats include runtime memory files");

// ── Day-fetch race + unmount guards ─────────────────────────────────────────
// Rapid day switching must not let a slow earlier fetch overwrite the current
// selection, and no async setState may land after unmount.
assert.match(entries, /const loadDayReqRef = useRef\(0\)/, "loadDay tracks a request id");
assert.match(entries, /const reqId = \+\+loadDayReqRef\.current/, "each loadDay stamps a request id");
assert.match(entries, /if \(reqId !== loadDayReqRef\.current \|\| !mountedRef\.current\) return/, "a stale/late day fetch is dropped");
assert.match(entries, /const mountedRef = useRef\(true\)/, "tracks mounted state for async guards");
assert.match(entries, /return \(\) => \{ mountedRef\.current = false; \}/, "mountedRef is cleared on unmount");
assert.match(entries, /setDay\(null\);\s*\n\s*setDayError\(null\);/, "selecting a day clears the previous entry before its request starts");
assert.match(entries, /if \(!res\.ok \|\| !json\.ok\) throw new Error\(json\.error \?\? "Couldn't load journal entry\."\)/, "failed day responses cannot leave stale content visible");
assert.match(entries, /headline="Couldn't load this journal entry"/, "day failures render a truthful error state");
assert.match(entries, /onClick=\{\(\) => \{ void loadDay\(selected\); \}\}/, "day failures expose a retry action");

// Initial list failures must not masquerade as an empty journal.
assert.match(entries, /daysError,\s*setDaysError/, "JournalEntries tracks day-list failures separately");
assert.match(entries, /const loadDaysReqRef = useRef\(0\)/, "loadDays tracks a request id");
assert.match(entries, /const reqId = \+\+loadDaysReqRef\.current/, "each loadDays stamps a request id");
assert.match(
  entries,
  /if \(reqId !== loadDaysReqRef\.current \|\| !mountedRef\.current\) return/,
  "a stale/late list response is dropped",
);
assert.match(entries, /if \(!res\.ok \|\| !json\.ok\) throw new Error\(json\.error \?\? "Couldn't load journal entries\."\)/, "failed list responses surface as errors");
assert.match(entries, /headline="Couldn't load journal entries"/, "list failures use the shared ErrorState");
assert.match(entries, /onClick=\{\(\) => \{ void loadDays\(\); \}\}/, "list failures expose a retry action");

// Generation may finish after the user navigates to another day. The list
// refresh is still useful, but the completed generation must not pull the
// detail pane back to the captured day.
assert.match(entries, /const selectedRef = useRef\(selected\)/, "generation can read the current selection");
assert.match(
  entries,
  /if \(selectedRef\.current === day\.date\) await loadDay\(day\.date\);/,
  "generation only reloads the detail when its day is still selected",
);

// Mutation failures stay visible even when the independently collapsible rail
// content is hidden.
{
  const railContentStart = entries.indexOf('<div id="journal-day-rail-content"');
  const asideEnd = entries.indexOf("</aside>", railContentStart);
  const mutationError = entries.indexOf('{error ? (', railContentStart);
  assert.ok(railContentStart >= 0 && asideEnd > railContentStart, "the collapsible rail subtree is present");
  assert.ok(mutationError > asideEnd, "the shared mutation error alert renders outside the collapsible rail");
}

// ── Selected day is announced + keyboard-navigable ──────────────────────────
assert.match(entries, /aria-current=\{d\.date === selected \? "true" : undefined\}/, "the open day row is aria-current");
assert.match(entries, /onKeyDown=\{onRailKeyDown\}/, "the day rail handles arrow-key navigation");
assert.match(entries, /e\.key === "ArrowDown" \? Math\.min\(btns\.length - 1, i \+ 1\)/, "ArrowDown moves to the next day");
// Chronological prev/next entry controls in the detail header.
assert.match(entries, /aria-label="Newer entry"/, "detail header has a newer-entry control");
assert.match(entries, /aria-label="Older entry"/, "detail header has an older-entry control");
assert.match(entries, /const hasOlder = dayIndex >= 0 && dayIndex < filteredDays\.length - 1/, "older-entry availability derives from the visible list");
assert.match(css, /\.journal-entry__sec--nav \{[\s\S]*?justify-content: space-between/, "the heading row lays out the nav controls");

// ── Reflection follow-up controls are display-only ───────────────────────────
// Journal is not a task/action owner. It strips the structured trailer before
// rendering Markdown and does not turn assistant intent into a mutation.
assert.match(entries, /function JournalReflection\(\{ text \}: \{ text: string \}\)/, "journal keeps a focused reflection renderer");
assert.match(entries, /const \{ visible \} = useMemo\(\(\) => extractNextPaths\(text\), \[text\]\);/, "journal strips next-path control blocks from reflection text");
assert.doesNotMatch(entries, /function NextPaths\(/, "journal does not render interactive next-path actions");
assert.doesNotMatch(entries, /cave:agents-new-chat/, "journal never launches chat from an assistant suggestion");
assert.doesNotMatch(entries, /body: JSON\.stringify\(\{ title: text/, "journal never files an assistant suggestion as a task");
assert.doesNotMatch(css, /\.journal-(?:entry__next|next__|notice)/, "journal removes the retired next-path and notice styling with its inactive UI");
assert.match(entries, /className=\{`journal-entry-gen\$\{generating \? " is-generating" : ""\}`\}/, "the generate button animates while reflecting");

// Engaging entry controls retain tactile press feedback.
assert.match(css, /\.journal-entry-gen:active:not\(:disabled\) \{ transform:/, "the generate button has a tactile press");
assert.match(css, /\.journal-day:active \{ transform:/, "day rows have a tactile press");
assert.match(css, /\.journal-entry__action:active:not\(:disabled\) \{ transform: scale/, "entry action icons have a tactile press");

// ── a11y: audible mutations, real headings, visible focus (cave-t1ou) ────────
assert.match(entries, /const \{ announce \} = useAnnouncer\(\)/, "the surface uses the shared announcer");
assert.match(entries, /announce\("Reflection generated\."\)/, "generate success is announced");
assert.match(entries, /announce\("Journal entry saved\."\)/, "save success is announced");
assert.match(entries, /const saveJson = await saveRes\.json\(\)\.catch\(\(\) => \(\{\}\)\)/, "generation inspects the persistence response body");
assert.match(entries, /if \(!saveRes\.ok \|\| !saveJson\.ok\) throw new Error\(saveJson\.error \?\? "Couldn't save the generated reflection\."\)/, "generation refuses to report success when persistence fails");
assert.match(entries, /\} finally \{\s*\n\s*if \(mountedRef\.current\) setGenerating\(false\);/, "generation always clears its busy state");
// Delete deliberately does NOT announce(): UndoToast is itself role=status
// (ui/undo-toast.tsx) and speaks the scheduled deletion — a second announce
// made AT hear every delete twice (cave-6rhk).
assert.doesNotMatch(
  entries,
  /announce\(`Deleting the entry/,
  "delete must not announce — UndoToast's live region already speaks it (double-announce, cave-6rhk)",
);
assert.match(entries, /aria-busy=\{generating\}/, "the generate button reports busy state");
assert.match(entries, /unavailable — select today to generate/, "the disabled reason reaches the accessible name (not just title=)");
assert.match(entries, /<h3 className="journal-entry__sec-heading">What happened/, "the day section is a real heading");
assert.match(entries, /<h4 className="journal-entry__sec journal-entry__sec-heading">Reflection<\/h4>/, "the reflection section is a real heading");
assert.doesNotMatch(entries, /journal-notice/, "journal no longer keeps an action-toast path for assistant suggestions");
assert.match(css, /\.journal-day:focus-visible \{\n  outline: var\(--ring-width, 2px\) solid var\(--ring-focus\)/, "day-rail rows have a visible focus ring");
assert.match(css, /\.journal-entry__action:focus-visible \{\n  outline: var\(--ring-width, 2px\) solid var\(--ring-focus\)/, "entry actions have a distinct focus ring");

// ── Sources / Visual / Generation prompt ("Memories Prototype", cave-hlic) ───
// The entry pane carries the prototype's three post-reflection sections:
// mtime-attributed source chips that deep-link into the Grimoire reader, a
// deterministic memory-constellation visual, and the editable prompt template
// behind Generate/Regenerate.
assert.match(entries, /<h4 className="journal-entry__sec journal-entry__sec-heading">Sources<\/h4>/, "the sources section is a real heading");
assert.match(entries, /day\.sources\?\.length \?/, "sources render only when the day touched memory files");
assert.match(entries, /openGrimoireDoc\("memory", s\.fullPath\)/, "a source chip deep-links into the Grimoire memory reader");
assert.doesNotMatch(
  entries,
  /grimoireHash/,
  "no standalone-host navigation fork remains — the journal lives only in the workspace Grimoire (PR #3751)",
);
assert.match(entries, /sources: Array\.isArray\(json\.sources\) \? \(json\.sources as JournalSource\[\]\) : \[\]/, "sources ride the non-blocking stats fetch");
assert.match(entries, /<JournalConstellation/, "the entry pane renders the constellation Visual");
assert.match(entries, /<h4 className="journal-entry__sec journal-entry__sec-heading">Generation prompt<\/h4>/, "the generation-prompt section is a real heading");
assert.match(entries, /aria-label="Generation prompt template"/, "the template textarea is labelled");
assert.match(entries, /splitPromptSegments\(journalPrompt\)/, "the highlight overlay marks {placeholder} runs");
assert.match(entries, /writeStoredJournalPrompt\(value\)/, "template edits persist");
assert.match(entries, /journalPrompt !== DEFAULT_JOURNAL_PROMPT \?/, "Reset appears only for a customized template");
assert.match(
  entries,
  /promptTemplate: journalPrompt,\s*\n\s*familiarName: familiarName\(familiarId\) \?\? undefined,/,
  "generate sends the edited template + placeholder vars",
);
assert.match(entries, /\{generating \? "Reflecting…" : "Regenerate entry"\}/, "an existing today-entry can be regenerated from the prompt section");
const constellation = read("./journal-constellation.tsx");
assert.match(constellation, /usePrefersReducedMotion\(\)/, "the visual's sketch beat respects prefers-reduced-motion");
assert.match(constellation, /var\(--accent-presence\)/, "constellation stars use theme tokens (no raw hex)");
assert.doesNotMatch(constellation, /#[0-9a-fA-F]{3,8}\b/, "no hardcoded colors in the constellation renderer");
assert.match(constellation, /role="img"/, "the constellation SVG is an image with an accessible name");
assert.match(css, /\.journal-prompt__ph \{[\s\S]*?color-mix\(in srgb, var\(--accent-presence\) 14%, transparent\)/, "placeholder highlight uses the one-hue tint recipe");
assert.match(css, /\.journal-sources__chip \{[\s\S]*?cursor: pointer;/, "source chips are styled, interactive controls");

// ── Journal write conflict + generatedAt (cave-9f2e) ─────────────────────────
// generate is the only real generation → it stamps generatedAt and sends the
// day's mtime baseline so it can't clobber a concurrent edit; a conflict is
// surfaced rather than silently overwriting.
assert.match(
  entries,
  /generate = useCallback[\s\S]*?generatedAt: new Date\(\)\.toISOString\(\)[\s\S]*?expectedModified: day\.modified/,
  "generate stamps generatedAt and sends the mtime baseline",
);
assert.match(entries, /saveRes && saveRes\.status === 409/, "generate surfaces a write conflict instead of overwriting");
// saveEdit is a manual edit → no generatedAt (server preserves it), but it still
// sends the baseline so it can't overwrite a concurrent change.
assert.match(
  entries,
  /reflectedBy: familiarId, expectedModified: day\.modified \}\)/,
  "saveEdit sends the mtime baseline and no generatedAt (preserved server-side)",
);

console.log("journal-entries.test.ts: ok");
