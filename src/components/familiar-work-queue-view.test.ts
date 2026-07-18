// @ts-nocheck
// Familiar Work Queue view (cave-19jy) — source pins for the triage-at-scale
// affordances: collapsible lanes with persisted state, the visible cap with a
// Show-all toggle, bead-row age stamps, and priority-tinted chips. The pure
// lane model is behaviorally tested in src/lib/beads-work-queue.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./familiar-work-queue-view.tsx", import.meta.url), "utf8");
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

// Bead-only rows carry a truthful age stamp (PR rows already had one).
assert.match(
  view,
  /\{!item\.pr && !item\.merged && item\.bead\?\.updated_at \? \(\s*<span className="fwq-card-time"/,
  "bead rows show updated-relative time",
);

// P0/P1 read at a glance in a mixed lane.
assert.match(view, /fwq-tag--p\$\{Math\.min\(item\.bead\.priority, 3\)\}/);
assert.match(css, /\.fwq-tag--p0,\s*\.fwq-tag--p1 \{/, "warm tint for high priorities");

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
// The filtered-empty state clears everything at once.
assert.match(view, /setFamiliarFilter\(null\);\s*setSearch\(""\);\s*setPriorityFilter\("all"\);/);

// ── Bead inspector (cave-u2p1) ───────────────────────────────────────────────
// Bead titles open a focus-trapped dialog over the existing show contract.
assert.match(view, /className="fwq-card-name fwq-card-name--link focus-ring-inset"/);
assert.match(view, /\/api\/beads\?mode=show&id=\$\{encodeURIComponent\(id\)\}/, "drawer reads bd show --json");
assert.match(view, /import \{ Modal \} from "@\/components\/ui\/modal"/, "reuses the focus-trapped house dialog");
assert.match(view, /breadcrumb=\{\["Queue", id\]\}/);
assert.match(view, /import\("@\/lib\/clipboard"\)/, "copy-id uses the shared clipboard helper");
assert.match(css, /\.fwq-detail-desc \{/, "description block has real styles");
assert.match(css, /\.fwq-card-name--link \{[\s\S]*?border: 0;/, "inspector links reset native button borders");
assert.match(css, /\.fwq-lane-toggle \{[\s\S]*?border: 0;/, "lane toggles reset native button borders");
assert.match(css, /\.fwq-lane-more \{[\s\S]*?border: 0;[\s\S]*?border-top:/, "lane footer keeps only its divider");

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

// ── cave-p63a: claim-for-familiar picker ─────────────────────────────────────
// Claim stays the default (connected user); a compact StandardSelect beside it
// claims on a picked familiar's behalf — only when a roster exists.
assert.match(view, /import \{ StandardSelect \} from "@\/components\/ui\/select"/);
assert.match(view, /\{familiars\.length > 0 \? \(\s*<StandardSelect/, "picker renders only with familiars present");
assert.match(view, /label="Claim for familiar…"/);
assert.match(view, /className="fwq-claim-for focus-ring-inset"/, "styled as a compact ghost control");
assert.match(
  view,
  /JSON\.stringify\(\{ action: "claim", id, assignee: familiar\.id \}\)/,
  "claim-for POSTs the familiar's id as assignee",
);
assert.match(view, /`Claimed \$\{id\} for \$\{familiar\.display_name\}\.`/, "announce names the familiar");
assert.match(css, /\.fwq-claim-for \{/, "the picker trigger has real styles");
assert.match(css, /\.fwq-claim-for \{[^}]*min-height: 22px/, "matches the xs Button height");

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
