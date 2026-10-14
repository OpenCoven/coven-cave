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
assert.match(entries, /fetch\(`\/api\/journal\?\$\{entryQuery\(target\)\}`,\s*\{ method: "DELETE" \}/, "JournalEntries deletes the selected (date, familiar) entry through /api/journal DELETE");
// Delete is deferred + undoable: it routes through the shared useUndoDelete helper,
// keyed by (date, familiar) so another familiar's entry for that day never reads as deleted.
assert.match(entries, /scheduleDelete\(key,/, "JournalEntries defers the delete through useUndoDelete");
assert.match(entries, /const key = entryKey\(day\.date, day\.familiar\);/, "the undo key is the entry's (date, familiar)");
assert.match(entries, /<UndoToast/, "JournalEntries renders an UndoToast for deletes");
assert.match(entries, /aria-label="Edit journal entry"/, "JournalEntries renders an edit affordance");
assert.match(entries, /aria-label="Delete journal entry"/, "JournalEntries renders a delete affordance");
// Edit mode hosts the shared MdEditor (WYSIWYG + markdown modes) in place of
// the old plain textarea. The MdEditor owns Save (⌘S) and Cancel (Escape in
// markdown mode / Cancel button); the draft mirrors back via onChange so the
// header ✓ Save button stays live.
assert.match(entries, /<MdEditor/, "Journal edit mode uses the shared MdEditor");
assert.match(entries, /visualLifecycleQueueRef=\{visualLifecycleQueueRef\}/, "rapid journal edit remounts share a stable visual lifecycle queue");
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
// ── One entry per familiar per day ───────────────────────────────────────────
// Storage is per familiar, so a day can carry several rows. The selection is a
// (date, familiar) pair; every read/stats/delete names the familiar so the
// right file is used, and the rail keys rows by date + familiar.
assert.match(entries, /type JournalSelection = \{ date: string; familiar: string \| null \}/, "the selection is a (date, familiar) pair");
assert.match(entries, /function entryKey\(date: string, familiar: string \| null\): string \{\s*\n\s*return `\$\{date\}\|\$\{familiar \?\? ""\}`;/, "entries are keyed by date + familiar");
assert.match(
  entries,
  /function entryQuery\(sel: JournalSelection\): string \{\s*\n\s*return sel\.familiar\s*\n?\s*\? `date=\$\{encodeURIComponent\(sel\.date\)\}&familiar=\$\{encodeURIComponent\(sel\.familiar\)\}`/,
  "entry reads pass &familiar= so the selected familiar's own file is read",
);
assert.match(entries, /fetch\(`\/api\/journal\?\$\{entryQuery\(sel\)\}`/, "loadDay reads the selected (date, familiar) entry");
assert.match(entries, /fetch\(`\/api\/journal\?\$\{entryQuery\(sel\)\}&stats=1`/, "fetchDayStats is scoped to the selected entry's familiar");
assert.match(entries, /const rowKey = entryKey\(d\.date, d\.reflectedBy\);[\s\S]*?<li key=\{rowKey\}>/, "rail rows are keyed by date + familiar (several familiars can share a day)");
assert.match(entries, /onClick=\{\(\) => selectDay\(d\.date, d\.reflectedBy\)\}/, "clicking a row selects that familiar's entry");
// Generation writes as the open entry's familiar; with per-familiar files it
// can only ever replace that familiar's own entry.
assert.match(entries, /const authorId = selected\.familiar \?\? defaultFamiliarId;/, "generation writes as the selected familiar");
assert.doesNotMatch(entries, /keeps one entry per day/, "the retired one-entry-per-day copy is gone");
assert.doesNotMatch(entries, /outOfScopeBy/, "the cross-familiar overwrite guard is obsolete with per-familiar storage");
// The default selection never opens a familiar the scoped rail is hiding.
assert.match(
  entries,
  /const defaultFamiliarId = scope\.size > 0 && \(!selectedFamiliarId \|\| !scope\.has\(selectedFamiliarId\)\)/,
  "the default familiar falls back into the scope",
);

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
  /const block = await fetchDayStats\(sel\);/,
  "JournalEntries fetches the stats block on a separate non-blocking request after the entry paints",
);
assert.match(
  entries,
  /setDay\(\{ \.\.\.\(json as Omit<JournalDay, "familiar" \| "stats" \| "context" \| "sources">\), familiar: sel\.familiar, stats: null, context: null, sources: null \}\)/,
  "JournalEntries paints the entry immediately with stats pending",
);
assert.match(
  entries,
  /prev && prev\.date === sel\.date && prev\.familiar === sel\.familiar \? \{ \.\.\.prev, \.\.\.block \} : prev/,
  "Late stats only merge into the same entry they were requested for",
);
// If the user hits Generate before the stats fetch lands, the context is
// fetched inline — generation must always carry the memory-scope note.
assert.match(
  entries,
  /const context = day\.context \?\? \(await fetchDayStats\(day\)\)\?\.context \?\? ""/,
  "Generate falls back to an inline context fetch when stats have not arrived",
);
// The memory totals are one compact muted line, not three dominant tiles.
assert.match(entries, /formatJournalMemoryMeta\(day\.stats\)/, "Journal stats render as one compact meta line");
assert.match(entries, /<p className="journal-entry__meta">/, "the meta line sits under the heading");
assert.match(entries, /"Loading memory stats…"/, "the pending stats line is named, not blank");
assert.doesNotMatch(entries, /journal-entry__stat\b/, "the big stat tiles are gone");
assert.doesNotMatch(css, /\.journal-entry__stats? \{/, "and so is their styling");
assert.match(css, /\.journal-entry__meta \{[\s\S]*?color: var\(--text-muted\)/, "the meta line is muted");

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
  /if \(isSelected\(target\.date, target\.familiar\)\) \{[\s\S]*?else await loadDay\(target\);/,
  "generation only reloads the detail when its (date, familiar) entry is still selected",
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
assert.match(entries, /aria-current=\{isRowSelected \? "true" : undefined\}/, "the open day row is aria-current");
assert.match(entries, /const isRowSelected = rowKey === selectedKey;/, "row selection compares the (date, familiar) key");
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
// The prompt editor is a collapsed-by-default disclosure, its open state
// remembered locally (it used to take the bottom third of every day).
assert.match(entries, /JOURNAL_PROMPT_OPEN_KEY = "cave:journal:prompt-open:v1"/, "the prompt disclosure uses a versioned preference");
assert.match(entries, /const \[promptOpen, setPromptOpen\] = useState\(false\)/, "the prompt editor starts collapsed");
assert.match(entries, /window\.localStorage\.setItem\(JOURNAL_PROMPT_OPEN_KEY, String\(next\)\)/, "the disclosure state persists locally");
assert.match(entries, /aria-expanded=\{promptOpen\}\s*\n\s*aria-controls="journal-prompt-panel"/, "the disclosure exposes its state and target");
assert.match(entries, />\s*\n?\s*<Icon name=\{promptOpen \? "ph:caret-down" : "ph:caret-right"\}[^>]*\/>\s*\n\s*Customize the prompt/, "the disclosure is named for what it does");
assert.match(entries, /id="journal-prompt-panel" className="journal-prompt__panel" hidden=\{!promptOpen\}/, "the editor is hidden while collapsed");
assert.match(entries, /aria-label="Generation prompt template"/, "the template textarea is labelled");
assert.match(entries, /splitPromptSegments\(journalPrompt\)/, "the highlight overlay marks {placeholder} runs");
assert.match(entries, /writeStoredJournalPrompt\(value\)/, "template edits persist");
assert.match(entries, /journalPrompt !== DEFAULT_JOURNAL_PROMPT \?/, "Reset appears only for a customized template");
assert.match(
  entries,
  /promptTemplate: journalPrompt,\s*\n\s*familiarName: familiarName\(familiarId\) \?\? undefined,/,
  "generate sends the edited template + placeholder vars",
);
assert.match(entries, /\{generating \? "Reflecting…" : "Regenerate entry"\}/, "an existing today-entry can be regenerated");
{
  const regen = entries.indexOf('"Regenerate entry"');
  const panel = entries.indexOf('id="journal-prompt-panel"');
  assert.ok(regen > 0 && panel > 0 && regen < panel, "Regenerate stays reachable with the prompt disclosure collapsed");
}
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

// ── Generation errors say what happened and what to do ───────────────────────
// The banner used to show the bare transport string ("the familiar reported an
// error"). It now maps the message to a headline + next step, offers Retry,
// and keeps the raw text behind a Details disclosure.
assert.match(entries, /describeJournalGenerateError\(genError\.message, familiarName\(genError\.familiar\)\)/, "generate errors are humanized");
assert.match(entries, /genError && genError\.key === selectedKey/, "a generate error only shows on the entry it was for");
assert.match(entries, /className="journal-gen-error"[\s\S]*?<summary>Details<\/summary>[\s\S]*?\{genErrorCopy\.detail\}/, "the raw message sits behind Details");
assert.match(entries, /className="journal-gen-error"[\s\S]*?onClick=\{\(\) => \{ void generate\(\); \}\}[\s\S]*?Retry/, "the banner offers Retry");
assert.match(css, /\.journal-gen-error \{[\s\S]*?var\(--color-danger\)/, "the banner uses the danger tint recipe");

// ── Reflection reads at a comfortable measure ────────────────────────────────
assert.match(entries, /<MarkdownBlock text=\{visible\} className="journal-entry__reflection" \/>/, "the reflection uses the chat's markdown reader");
assert.match(css, /\.journal-entry__reflection \{[\s\S]*?max-width: 68ch;[\s\S]*?line-height: var\(--leading-relaxed\);[\s\S]*?font-size: var\(--text-md\);/, "the reflection has a reading measure built from tokens");

// ── Empty state names the familiar ───────────────────────────────────────────
assert.match(entries, /`\$\{selectedName\} hasn't reflected on this day yet`/, "the empty state names the selected familiar");

// ── Automation card: the familiar's daily reflection routine ─────────────────
const auto = read("./journal-automation-card.tsx");
assert.match(entries, /<JournalAutomationCard\s*\n\s*key=\{selected\.familiar\}/, "the day pane hosts the selected familiar's automation card");
assert.match(auto, /fetch\(`\/api\/journal\/automation\?familiar=\$\{encodeURIComponent\(familiarId\)\}`/, "the card reads the familiar's routine");
assert.match(auto, /method: "PUT",[\s\S]*?JSON\.stringify\(\{ familiar: familiarId, enabled, hour: nextHour, runtime: nextRuntime, familiarName \}\)/, "toggle, hour and harness save through PUT");
assert.match(auto, /JSON\.stringify\(\{ familiar: familiarId, action: "run" \}\)/, "Run now posts the run action");
assert.match(auto, /role="switch"\s*\n\s*aria-checked=\{enabled\}/, "the toggle is an accessible switch");
// The native scheduler runs on the hour (no BYMINUTE), so the picker is an
// hour select, not a minute-level time input that would be refused.
assert.match(auto, /<StandardSelect\s*\n\s*id="journal-auto-time"/, "an hour picker sets the reflection time");
assert.doesNotMatch(auto, /type="time"/, "no minute-level time input — the daemon cannot run at :30");
assert.match(auto, /useState<number>\(\(\) => suggestedJournalHour\(familiarId\)\)/, "a new routine defaults to the familiar's staggered morning hour");
assert.match(auto, /RUN_POLL_LIMIT = Math\.ceil\(\(\(JOURNAL_ROUTINE_TIMEOUT_MINUTES \+ 1\) \* 60_000\) \/ RUN_POLL_MS\)/, "Run now is watched for as long as a run may take");
assert.match(auto, /reqRef\.current \+= 1;\s*\n\s*try \{/, "a save drops refreshes read before it, so they can't undo it");
assert.match(auto, /const saveRuntime = routine \? undefined :/, "a save keeps a harness picked elsewhere unless the picker changes it");
assert.match(auto, /const saveHour = customSchedule \? null : hour;/, "a save keeps a custom schedule instead of overwriting it");
assert.match(auto, /label: "Custom schedule"/, "a custom schedule is shown as one, not as a made-up hour");
assert.match(auto, /onRunFinishedRef\.current\?\.\(next\.kind === "ready" \? next\.lastRunEntry : null\)/, "a finished run reports the day it wrote");
assert.match(entries, /if \(entry\?\.written && entry\.date !== current\.date\) selectDay\(entry\.date, current\.familiar\);/, "and the journal opens that day");
assert.match(auto, /json\.available === false \|\| res\.status === 503/, "an unreachable daemon is detected");
assert.match(auto, /Automations service isn&apos;t reachable/, "and said precisely, with no fallback");
assert.match(auto, /Last run: <span data-run-status=\{wroteNothing \? "empty" : lastRun\.status\}>/, "the last run's status is shown");
// A signed-out harness exits 0 ("Login expired"), so "succeeded" alone is not
// proof; the pane trusts the server's check that the entry file landed.
assert.match(auto, /const wroteNothing = lastRun\?\.status === "succeeded" && lastRunEntry !== null && !lastRunEntry\.written;/, "a succeeded run that wrote nothing is called out");
assert.match(auto, /<StandardSelect\s*\n\s*id="journal-auto-runtime"/, "the harness the reflection runs on is choosable");
assert.match(auto, /announce\(/, "automation mutations are announced");
assert.match(css, /\.journal-auto__switch \{/, "the switch is styled in the surface stylesheet");
assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.journal-auto__switch,/, "the switch respects reduced motion");

console.log("journal-entries.test.ts: ok");
