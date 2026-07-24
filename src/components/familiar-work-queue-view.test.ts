// @ts-nocheck
// Familiar Work Queue view — source pins for the triage-at-scale affordances
// (collapsible lanes, the visible cap, bead-row age stamps) AND the "Tasks list
// redesign refresh" handoff (Queue.dc.html): the meta row, the All/Unassigned
// scope segment, the segmented triage toolbar, the accent-rail rows, the inline
// markdown note composer, and the forward-to-familiar menu. The pure lane model
// is behaviorally tested in src/lib/beads-work-queue.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = [
  readFileSync(new URL("./familiar-work-queue-view.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("./familiar-work-queue-sections.tsx", import.meta.url), "utf8"),
].join("\n");
const css = readFileSync(new URL("../styles/familiar-work-queue.css", import.meta.url), "utf8");

// Lane headers are real disclosure controls, not decorative rows.
assert.match(view, /className="fwq-lane-toggle focus-ring-inset"/, "the whole lane head toggles");
assert.match(view, /aria-expanded=\{!collapsed\}/, "disclosure state is exposed to AT");
assert.match(view, /onClick=\{\(\) => toggleLane\(lane\.key\)\}/);
assert.match(css, /\.fwq-lane-caret\.is-open \{ transform: rotate\(90deg\); \}/, "caret signals open state");

// Collapse persists per lane; `waiting` starts collapsed; hydration is
// post-mount so SSR and the first client render agree.
assert.match(view, /const COLLAPSED_LANES_KEY = "cave:fwq:collapsed:v1"/);
assert.match(view, /DEFAULT_COLLAPSED: readonly WorkQueueLaneKey\[\] = \["waiting"\]/);
assert.match(view, /setCollapsedLanes\(readCollapsedLanes\(\)\);\s*\}, \[\]\)/, "storage hydrates after mount");
assert.match(view, /writeCollapsedLanes\(next\)/, "toggles persist");

// Long lanes mount a capped card list until asked — the N-bead perf fix.
assert.match(view, /const LANE_VISIBLE_CAP = 8/);
assert.match(view, /lane\.items\.slice\(0, LANE_VISIBLE_CAP\)/);
assert.match(view, /`Show all \$\{lane\.items\.length\}`/, "cap toggle names the hidden count");
assert.match(view, /`Show top \$\{LANE_VISIBLE_CAP\}`/, "and collapses back");
assert.match(view, /aria-expanded=\{showAll\}/, "cap toggle is a disclosure for AT");
assert.match(css, /\.fwq-lane-more \{/, "the foot row has real styles");

// ── Redesign: meta row (live summary + Refresh) ──────────────────────────────
assert.match(view, /<header className="fwq-meta">/, "the header is the redesigned meta row");
assert.match(view, /<span className="fwq-meta-strong">\{q\.actionable\}<\/span> actionable/, "actionable count leads");
assert.match(view, /<span className="fwq-meta-count">\{q\.total\}<\/span> total/, "total rides in mono");
assert.match(view, /className="fwq-refresh"[\s\S]*?aria-label="Refresh queue"/, "Refresh keeps its AT name");
assert.match(view, /updated \{relativeTime\(lastUpdated\)\}/, "freshness readout stays truthful");
assert.match(css, /\.fwq-meta \{[\s\S]*?border-bottom: 1px solid var\(--border-hairline\)/, "meta row has a divider");

// ── Redesign: All/Unassigned scope segment ───────────────────────────────────
assert.match(view, /const \[scope, setScope\] = useState<"all" \| "unassigned">\("all"\)/);
assert.match(view, /scope === "all" \|\| item\.familiar === "unassigned"/, "Unassigned narrows to un-owned work");
assert.match(view, /aria-label="Filter by scope"/, "the scope segment is a labelled group");
assert.match(view, /const scopeCounts = useMemo/, "the segment shows the whole-queue split");
assert.match(css, /\.fwq-seg-btn\.is-active \{[\s\S]*?background: var\(--bg-elevated\)/, "the active segment fills");

// Bead-only rows carry a truthful age stamp (PR rows already had one).
assert.match(
  view,
  /\{isBeadOnly && item\.bead\?\.updated_at \? \(\s*<>\s*<span className="fwq-dot-sep"[\s\S]*?<span className="fwq-updated"/,
  "bead rows show updated-relative time",
);

// P0/P1 read at a glance in a mixed lane (now the row's priority readout).
assert.match(view, /fwq-pri-text--p\$\{Math\.min\(item\.bead\.priority, 3\)\}/);
assert.match(css, /\.fwq-pri-text--p0 \{ color: var\(--color-danger\); \}/, "P0 reads danger");
assert.match(css, /\.fwq-pri-text--p1 \{ color: var\(--color-warning\); \}/, "P1 reads warning");

// The accent rail is a finite enum → a fwq-row--rail-* class (colour stays in
// CSS, not an inline style): priority for bead rows, lane state for PR rows.
assert.match(view, /function railClass\(item: WorkQueueItem\): string/);
assert.match(view, /className=\{`fwq-row fwq-row--rail-\$\{railClass\(item\)\}/, "each row picks its rail class");
assert.match(css, /box-shadow: inset 3px 0 0 var\(--fwq-rail, transparent\)/, "the rail renders as an inset bar");
assert.match(css, /\.fwq-row--rail-danger \{ --fwq-rail: var\(--color-danger\); \}/, "rail tones live in CSS");

// ── Triage tools (cave-u2p1) ─────────────────────────────────────────────────
// Search matches title, bead id, and PR number — all client-side.
assert.match(view, /import \{ SearchInput \} from "@\/components\/ui\/search-input"/);
assert.match(view, /onValueChange=\{setSearch\}/, "search is controlled");
assert.match(view, /item\.bead\?\.id\.toLowerCase\(\)\.includes\(q\)/, "bead ids are searchable");
assert.match(view, /`#\$\{prNumber\}`\.includes\(q\)/, "PR numbers are searchable");
// Priority bands + sort toggle.
assert.match(view, /useState<"all" \| "p0" \| "p1" \| "p2plus">\("all"\)/);
assert.match(view, /useState<"priority" \| "recent">\("priority"\)/, "priority-oldest is the default order");
assert.match(view, /if \(sortMode === "recent"\) items = \[\.\.\.items\]\.sort/, "recent re-sorts a copy — queue identity untouched");
assert.match(view, /setSortMode\(\(cur\) => \(cur === "priority" \? "recent" : "priority"\)\)/);
assert.match(view, /aria-pressed=\{sortMode === "recent"\}/, "sort toggle exposes its active state");
assert.match(view, /title=\{sortMode === "priority" \? "Sort by recently updated" : "Sort by priority and oldest"\}/);
// The filtered-empty state clears everything at once (scope included).
assert.match(
  view,
  /setFamiliarFilter\(null\);\s*setScope\("all"\);\s*setSearch\(""\);\s*setPriorityFilter\("all"\);/,
);

// ── Bead inspector (cave-u2p1) ───────────────────────────────────────────────
// Bead titles open a focus-trapped dialog over the existing show contract.
assert.match(view, /className="fwq-card-name fwq-card-name--link focus-ring-inset"/);
assert.match(view, /\/api\/beads\?mode=show&id=\$\{encodeURIComponent\(id\)\}&projectRoot=\$\{encodeURIComponent\(projectRoot\)\}/, "drawer reads the selected project's bead");
assert.match(view, /import \{ Modal \} from "@\/components\/ui\/modal"/, "reuses the focus-trapped house dialog");
assert.match(view, /breadcrumb=\{\["Queue", id\]\}/);
assert.match(view, /import\("@\/lib\/clipboard"\)/, "copy-id uses the shared clipboard helper");
assert.match(css, /\.fwq-detail-desc \{/, "description block has real styles");
assert.match(css, /\.fwq-row-name--link \{[\s\S]*?border: 0;/, "inspector links reset native button borders");
assert.match(css, /\.fwq-lane-toggle \{[\s\S]*?border: 0;/, "lane toggles reset native button borders");
assert.match(css, /\.fwq-lane-more \{[\s\S]*?border: 0;[\s\S]*?border-top:/, "lane footer keeps only its divider");

// ── Redesign: inline markdown note composer ──────────────────────────────────
// Write/Preview tabs + a formatting toolbar over a self-contained md renderer.
assert.match(view, /const \[noteMode, setNoteMode\] = useState<"write" \| "preview">\("write"\)/);
assert.match(view, /className=\{`fwq-note-tab\$\{noteMode === "write" \? " is-active" : ""\}`\}/);
assert.match(view, /function applyMarkdown\(/, "the toolbar edits the selection");
assert.match(view, /function renderMarkdown\(/, "preview renders markdown to inert HTML");
assert.match(view, /const esc = \(s: string\) => s\.replace\(\/&\/g, "&amp;"\)/, "every user string is HTML-escaped first");
assert.match(view, /dangerouslySetInnerHTML=\{\{ __html: renderMarkdown\(draft\) \}\}/, "preview pane mounts the rendered HTML");
assert.match(view, /aria-label=\{`Handoff note for \$\{beadId\}`\}/, "the composer keeps its AT name");
assert.match(view, /Save note/, "the composer commits with Save note");
assert.match(css, /\.fwq-note-tab\.is-active \{/, "the active note tab has real styles");
assert.match(css, /\.fwq-note-tool \{/, "the toolbar buttons have real styles");
// Escape closes but keeps the draft; Cancel is the clear (verification text is
// never destroyed by an accidental keystroke).
assert.match(view, /if \(e\.key === "Escape"\) \{[\s\S]*?closeComposer\(\);/, "Escape keeps the draft");
assert.match(view, /onClick=\{\(\) => closeComposer\(\{ clearDraft: true \}\)\}/, "Cancel clears the draft");

// ── cave-p63a: File bead on unlinked attention rows ──────────────────────────
// The strip's unlinked rows expose a one-click File bead; the parent owns the
// fetch + announce + reload and threads it down as onFileBead.
assert.match(view, /onFileBead\?: \(pr: PullRequestSummary\) => Promise<boolean>/, "strip takes the optional handler");
assert.match(
  view,
  /<AttentionStrip items=\{q\.attention\} onOpenUrl=\{onOpenUrl\} onFileBead=\{runFileBead\} \/>/,
  "parent threads onFileBead into the strip",
);
assert.match(view, /\{unlinked \? \(\s*<Button[^]*?File bead/, "only unlinked rows offer File bead");
assert.match(view, /leadingIcon="ph:plus-circle"/, "File bead carries the plus-circle icon");
assert.match(view, /loading=\{filingPr === pr\.number\}/, "busy state pins to the clicked row");
assert.match(
  view,
  /disabled=\{!onFileBead \|\| filingPr != null\}/,
  "all File bead buttons are disabled while a request is in flight",
);
// The create payload links the bead back to the PR twice over: externalRef
// gh-<n> for the visibility layer, and the PR URL in the description for the
// ready-output ref join (external_ref is absent from `bd ready --json`).
assert.match(view, /action: "create",\s*title: pr\.title/, "bead titled after the PR");
assert.match(view, /description: `Filed from unlinked PR #\$\{pr\.number\} — \$\{pr\.url\}`/);
assert.match(view, /externalRef: `gh-\$\{pr\.number\}`/, "externalRef uses the gh-<n> form");
assert.match(view, /labels: \["from-pr"\]/);
assert.match(view, /`Filed \$\{beadId\} for PR #\$\{pr\.number\}\.`/, "success announces the new bead id");
assert.match(view, /await load\(true\)/, "queue mutations reload the explicitly selected project");

// Queue readiness is explicit: load its selected root first, include it in
// both bridge calls, and offer the requested Generate recovery if Beads is
// absent. It must not warm anonymous Queue requests in the background.
assert.match(view, /fetch\("\/api\/queue\/readiness"/, "Queue checks readiness before reading work");
assert.match(view, /projectRoot=\$\{encodeURIComponent\(projectRoot\)\}/, "both Queue sources receive the selected root");
assert.match(view, /action, id, projectRoot/, "claim and close mutations receive the selected root");
assert.match(view, /action: "comment", id, comment, projectRoot/, "handoff comments receive the selected root");
assert.match(view, /action: "claim", id, assignee: familiar\.id, projectRoot/, "claim-for receives the selected root");
assert.match(view, /projectRoot=\{readiness\?\.project\?\.root\}/, "Asana filing receives the selected root");
assert.match(view, /const sourcesUnavailable = !readinessUnavailable && readiness\?\.ok === true && readiness\.project !== null/, "a ready project with failing adapters is not treated as unselected");
assert.match(view, /code\?: string/, "Queue preserves readiness remediation codes from the server");
assert.match(view, /const selectionRemediable = readiness\?\.code === "no-project"/, "stale and invalid selections retain a Choose-project recovery");
assert.match(view, /readiness\?\.code === "not-git-repository"/, "ordinary non-Git projects retain Choose-project recovery");
assert.match(view, /const projectUnavailable = !readinessUnavailable && !sourcesUnavailable && !canGenerate && !selectionRemediable && readiness\?\.project !== null/, "only non-repairable selected projects suppress Generate");
assert.match(view, /Clear all prior-project controls synchronously/, "selection clears Queue state before the next readiness response");
assert.match(view, /headline=\{readinessUnavailable \? "Queue check unavailable" : sourcesUnavailable \? "Queue sources unavailable" : canGenerate \? "Generate your Queue" : projectUnavailable \? "Queue project needs attention" : "Queue needs a project"\}/);
assert.match(view, /readinessUnavailable \|\| sourcesUnavailable \|\| projectUnavailable \? null : canGenerate \? \(/, "Generate wins before a selected-project warning and stale roots offer Choose project");
assert.match(view, />\s*Generate\s*<\/Button>/, "empty Queue state offers Generate");
assert.doesNotMatch(view, /readSurfaceResource\("tasks:queue"/, "Queue no longer consumes an unscoped warm cache");

// ── cave-p63a: forward-to-familiar menu (redesign) ───────────────────────────
// The split control's picker is now a custom dropdown (design's "Forward to
// familiar"), but it keeps the "Claim for familiar…" trigger name and
// menuitemradio items so the a11y + e2e contract is unchanged.
assert.match(view, /function ForwardMenu\(/, "the picker is a dedicated menu component");
assert.match(view, /<ForwardMenu familiars=\{familiars\} disabled=\{busy\} onClaimFor=\{onClaimFor\} \/>/);
assert.match(view, /aria-label="Claim for familiar…"/, "trigger keeps its AT name");
assert.match(view, /role="menuitemradio"/, "familiar options stay menuitemradio for AT + e2e");
assert.match(css, /\.fwq-forward-trigger \{/, "the picker trigger has real styles");
assert.match(css, /\.fwq-forward-menu \{/, "the picker menu has real styles");

// Claim stays the default (connected user); the menu claims for a familiar.
assert.match(view, /className="fwq-act fwq-act--claim"/, "Claim is the redesigned row action");
assert.match(view, /\{familiars\.length > 0 \? \(\s*<ForwardMenu/, "the menu renders only with familiars present");
assert.match(view, /action: "claim", id, assignee: familiar\.id, projectRoot/, "forward-to-familiar keeps the selected project root");

// The /api/beads claim action honors the optional assignee: bare claim keeps
// `--claim`; an assignee becomes explicit --assignee/--status flags (both
// verified against `bd update -h`).
const beadsRoute = readFileSync(new URL("../app/api/beads/route.ts", import.meta.url), "utf8");
assert.match(beadsRoute, /assignee\?: string/, "BeadsPostBody grew the optional assignee");
assert.match(
  beadsRoute,
  /\["update", id, "--assignee", assignee, "--status", "in_progress", "--json"\]/,
  "assignee claim builds explicit update flags",
);
assert.match(beadsRoute, /\["update", id, "--claim", "--json"\]/, "bare claim is unchanged");

console.log("familiar-work-queue-view.test.ts: ok");
