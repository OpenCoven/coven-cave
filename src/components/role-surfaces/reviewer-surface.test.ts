import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildDiffRows,
  diffStatLabel,
  hideWhitespaceOnlyDiff,
  parseDiffLines,
  prLabel,
  prUrl,
  reviewQueue,
} from "./review-deck.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const surface = read("./reviewer-surface.tsx");
const sourceHook = read("./use-review-source.ts");
const panes = read("./use-review-panes.ts");
const deckModel = read("./use-review-deck-model.ts");
const topbar = read("./review-cockpit-topbar.tsx");
const queue = read("./review-queue.tsx");
const header = read("./review-workbench-header.tsx");
const tabs = read("./review-mobile-tabs.tsx");
const rail = read("./review-file-rail.tsx");
const diff = read("./review-diff-workbench.tsx");
const navigator = read("./review-file-navigator.tsx");
const inspector = read("./review-inspector.tsx");
const verdict = read("./review-verdict-dock.tsx");
const docs = read("../../../docs/role-surfaces.md");
const cssFacade = read("../../styles/review-deck.css");
const cssFiles = [
  "../../styles/review-deck/base.css",
  "../../styles/review-deck/layout.css",
  "../../styles/review-deck/queue.css",
  "../../styles/review-deck/diff.css",
  "../../styles/review-deck/inspector.css",
  "../../styles/review-deck/verdict.css",
  "../../styles/review-deck/responsive.css",
];
const css = cssFiles.map(read).join("\n");
const renderSources = [
  surface,
  topbar,
  queue,
  header,
  tabs,
  rail,
  diff,
  navigator,
  inspector,
  verdict,
];

function session(overrides = {}) {
  return {
    id: "s-0",
    archived_at: null,
    git: null,
    pullRequest: null,
    diff: null,
    updated_at: "2026-07-14T10:00:00Z",
    ...overrides,
  };
}

test("review queue stays real, scoped, and newest-first", () => {
  const result = reviewQueue([
    session({ id: "plain" }),
    session({
      id: "pr",
      pullRequest: { repo: "o/r", number: 7 },
      updated_at: "2026-07-14T09:00:00Z",
    }),
    session({
      id: "diffed",
      diff: { additions: 3, deletions: 1 },
      updated_at: "2026-07-14T11:00:00Z",
    }),
    session({
      id: "archived",
      pullRequest: { repo: "o/r", number: 9 },
      archived_at: "2026-07-13T00:00:00Z",
    }),
  ]);
  assert.deepEqual(
    result.map((item) => item.session.id),
    ["diffed", "pr"],
  );
  assert.deepEqual(result[1]?.reasons, ["pull-request"]);
});

test("diff labels and pull-request links do not invent data", () => {
  assert.equal(diffStatLabel(null), "no changes");
  assert.equal(diffStatLabel({ additions: 12, deletions: 3 }), "+12 −3");
  assert.equal(prLabel({ repo: "o/r" }), "o/r");
  assert.equal(prUrl({ repo: "o/r" }), null);
  assert.equal(prUrl({ repo: "o/r", number: 42 }), "https://github.com/o/r/pull/42");
});

test("unified diff rows carry old and new line numbers", () => {
  const lines = parseDiffLines(
    ["@@ -8,3 +8,4 @@", " context", "-before", "+after", "+extra"].join("\n"),
  );
  assert.deepEqual(
    lines.map(({ kind, oldLine, newLine }) => ({ kind, oldLine, newLine })),
    [
      { kind: "hunk", oldLine: null, newLine: null },
      { kind: "ctx", oldLine: 8, newLine: 8 },
      { kind: "del", oldLine: 9, newLine: null },
      { kind: "add", oldLine: null, newLine: 9 },
      { kind: "add", oldLine: null, newLine: 10 },
    ],
  );
});

test("whitespace hiding is conservative and context folds stay expandable", () => {
  const lines = parseDiffLines(
    [
      "@@ -1,8 +1,8 @@",
      " one",
      " two",
      " three",
      " four",
      " five",
      " six",
      " seven",
      " eight",
      "-const value = 1;",
      "+const  value=1;",
      " nine",
      " ten",
      " eleven",
    ].join("\n"),
  );
  assert.equal(hideWhitespaceOnlyDiff(lines).length, lines.length - 2);
  const rows = buildDiffRows(lines, 3, new Set());
  const fold = rows.find((row) => row.kind === "fold");
  assert.ok(fold);
  assert.ok(buildDiffRows(lines, 3, new Set([fold.key])).length > rows.length);
});

test("the selected session truthfully pins PR or local source", () => {
  assert.match(
    sourceHook,
    /const kind: ReviewSourceKind = pr \? "pull-request" : projectRoot \? "local" : "none"/,
  );
  assert.match(sourceHook, /\/api\/github\/diff/);
  assert.match(sourceHook, /\/api\/changes\?projectRoot=/);
  assert.match(surface, /useReviewSource\(\{/);
  assert.match(surface, /source\.kind === "pull-request"/);
  assert.match(surface, /pullRequestReviewWorkItem/);
  assert.match(surface, /localReviewWorkItem/);
  assert.match(surface, /localReviewRevision/);
});

test("readiness and actions fail closed without an exact GitHub state", () => {
  assert.match(surface, /reviewActionsAvailable\(\{/);
  assert.match(surface, /readinessPhase: readiness\.phase/);
  assert.match(surface, /state: facts\?\.state/);
  assert.match(surface, /draft: facts\?\.draft/);
  assert.match(surface, /if \(!canAct \|\| !selectedPullRequest \|\| busy\) return false/);
  assert.match(verdict, /Actions are held until the pull request's state loads/);
});

test("approval, change requests, and squash merge preserve existing APIs", () => {
  assert.match(surface, /fetch\("\/api\/github\/review"/);
  assert.match(surface, /event: "APPROVE"/);
  assert.match(surface, /event: "REQUEST_CHANGES"/);
  assert.match(surface, /fetch\("\/api\/github\/merge"/);
  assert.match(surface, /method: "squash"/);
  assert.match(surface, /readiness\.refresh\(\)/);
  assert.match(surface, /announce\(message, "assertive"\)/);
});

test("the reviewer surface is orchestration, not a monolithic renderer", () => {
  for (const component of [
    "ReviewCockpitTopBar",
    "ReviewQueue",
    "ReviewWorkbenchHeader",
    "ReviewFileRail",
    "ReviewDiffWorkbench",
    "ReviewInspector",
    "ReviewVerdictDock",
  ]) {
    assert.match(surface, new RegExp(`<${component}`));
  }
  assert.ok(surface.split("\n").length < 900, "orchestrator should stay bounded");
});

test("deck-scoped chrome lives in the top bar and item-scoped chrome does not", () => {
  // A control's column is what tells a reader what it acts on. Filters and
  // item navigation act on the deck; the workspace header acts on one item.
  assert.match(topbar, /aria-label="Filter the queue by attention"/);
  assert.match(topbar, /Next item \(\]\)/);
  assert.doesNotMatch(header, /Filter the queue/);
  assert.doesNotMatch(header, /onBucketFilter/);
  // …and the reverse: the verdict is not duplicated into the top bar.
  assert.doesNotMatch(topbar, /Squash & merge|Request changes/);
});

test("the queue names a reason it actually read, and never counts checks", () => {
  // The queue affords one GitHub read per row; check runs are a second
  // request it does not make, so no row may claim a failing-check count.
  assert.match(deckModel, /queueRowReason\(facts, \{ hasPullRequest, hasLocalChanges \}\)/);
  // …and from the single-read facts map, never from the readiness fan-out.
  assert.doesNotMatch(deckModel, /usePrReadiness|prBlockers/);
  assert.doesNotMatch(queue, /failing/);
  assert.match(queue, /rd-row-reason/);
});

test("blockers name their severity, their owner, and the evidence behind them", () => {
  assert.match(surface, /triageBlockers\(rawBlockers, \{/);
  assert.match(surface, /canResolveThreads: facts\?\.threads\.canResolve \?\? false/);
  assert.match(inspector, /blocker\.severity/);
  assert.match(inspector, /blocker\.owner/);
  assert.match(inspector, /Only the author can clear this/);
  assert.match(inspector, /onRevealBlocker\(blocker\.reveal!\)/);
});

test("review progress is scoped to the canonical revision", () => {
  assert.match(surface, /useReviewProgress\(\{/);
  assert.match(surface, /sourceId: workItem\?\.id \?\? null/);
  assert.match(surface, /revision: workItem\?\.revision \?\? null/);
  assert.match(rail, /aria-pressed=\{currentReviewed\}/);
  assert.match(rail, /readable files reviewed on this revision/);
  assert.match(diff, /files read on/);
});

test("review threads render at their line, and an unplaced one is still shown", () => {
  assert.match(diff, /interleaveThreads<DiffRow>/);
  assert.match(diff, /woven\.unplaced\.length > 0/);
  assert.match(diff, /not on a visible line/);
});

test("the note is reachable without opening a dialog, and required for changes", () => {
  assert.doesNotMatch(surface, /<textarea/);
  assert.match(inspector, /id="rd-inspector-note"/);
  assert.match(verdict, /open=\{reviewMode != null\}/);
  assert.match(verdict, /Review note · \{reviewMode === "changes" \? "Required" : "Optional"\}/);
  assert.match(verdict, /The draft stays with this session/);
  assert.match(verdict, /maxLength=\{GITHUB_REVIEW_BODY_MAX_LENGTH\}/);
  assert.match(verdict, /aria-describedby="rd-review-help rd-review-count"/);
  assert.match(surface, /A note is required — GitHub sends it/);
});

test("an unavailable merge keeps its place and says why", () => {
  // A control that disappears teaches nothing about why it is unavailable.
  assert.match(verdict, /label: "Merge",\s*\n\s*tone: "muted",\s*\n\s*disabled: true/);
  assert.match(verdict, /Blocked: \$\{blockers\.map\(\(blocker\) => blocker\.title\)\.join\(" · "\)\}/);
  assert.match(verdict, /Merging needs a pull request/);
});

test("keyboard shortcuts ignore editable targets and expose help", () => {
  assert.match(surface, /isEditableTarget\(event\.target\)/);
  assert.match(surface, /event\.isComposing/);
  assert.match(surface, /resolveReviewShortcut/);
  assert.match(tabs, /role="tablist" aria-label="Review Deck views"/);
  assert.match(header, /Character shortcuts pause while you type/);
  assert.match(navigator, /tabIndex=\{0\}/);
  assert.match(navigator, /aria-activedescendant=/);
});

test("retry, empty, checkpoint, and announcement states remain explicit", () => {
  assert.match(diff, /<SurfaceError/);
  assert.match(diff, /onRetry=\{source\.retry\}/);
  assert.match(diff, /Nothing was approved or merged/);
  assert.match(diff, /source\.open\(source\.openPath\)/);
  assert.match(surface, /parseCheckpointEnvelope/);
  assert.match(verdict, /No checkpoints saved for this project/);
  assert.match(verdict, /the deck never applies a patch/);
  assert.match(surface, /useAnnouncer/);
});

test("the inspector names unavailable truth instead of inferring it", () => {
  assert.match(inspector, /Review inspector/);
  assert.match(inspector, /readinessPhase === "loading"/);
  assert.match(inspector, /Nothing is inferred/);
  assert.match(inspector, /No checks have reported on this head/);
  assert.match(inspector, /Resolving threads needs a GitHub token/);
  assert.match(inspector, /facts\.mergeable == null \? "computing"/);
});

test("panes are clamped against the live window, not just their own bounds", () => {
  assert.match(panes, /clampPaneWidth\(queueWidth, QUEUE_PANE, available, QUEUE_SHARE\)/);
  // Measure the STAGE, not the window: the deck can render inside a workspace
  // pane narrower than the window, and clamping to a share of the window there
  // lets a rail take most of the pane.
  assert.match(panes, /new ResizeObserver/);
  assert.match(panes, /observer\.observe\(node\)/);
  assert.doesNotMatch(panes, /window\.innerWidth/);
  assert.match(panes, /pointermove/);
  assert.match(panes, /pointercancel/);
  assert.match(surface, /--rd-queue-width/);
  assert.match(surface, /--rd-inspector-width/);
});

test("the stylesheet is a responsibility-split facade", () => {
  for (const name of [
    "base",
    "layout",
    "queue",
    "diff",
    "inspector",
    "verdict",
    "responsive",
  ]) {
    assert.match(cssFacade, new RegExp(`review-deck/${name}\\.css`));
  }
});

test("every rendered Review Deck class has a stylesheet rule", () => {
  const classes = new Set<string>();
  for (const source of renderSources) {
    for (const match of source.matchAll(/className="([^"]*)"/g)) {
      for (const name of match[1].split(/\s+/)) {
        if (name.startsWith("rd-")) classes.add(name);
      }
    }
    for (const match of source.matchAll(/className=\{`([^`]*)`\}/g)) {
      for (const name of match[1].match(/rd-[a-z0-9-]+/g) ?? []) {
        classes.add(name);
      }
    }
  }
  assert.ok(
    classes.size > 90,
    `expected a substantial surface, saw ${classes.size} classes`,
  );
  const styled = new Set([...css.matchAll(/\.(rd-[a-z0-9-]+)/g)].map((match) => match[1]));
  assert.deepEqual([...classes].filter((name) => !styled.has(name)).sort(), []);
});

test("tone is one custom property, never a second hue per state", () => {
  // Adding a state means adding a row to the tone table, not a colour rule.
  assert.match(css, /\[data-rd-tone="danger"\]\s*\{\s*--rd-tone: var\(--color-danger\);/);
  assert.match(css, /\[data-rd-tone="accent"\]\s*\{\s*--rd-tone: var\(--accent-presence\);/);
  assert.match(css, /background: color-mix\(in oklch, var\(--rd-tone\) 14%, transparent\)/);
  // The attribute is deck-specific. A bare `[data-tone]` mapping would reach
  // the status bar and the coven tab, which carry that shared attribute; and
  // scoping under `.rd-stage` would strip the tone from the composer and merge
  // dialogs, which Modal portals outside it.
  assert.doesNotMatch(css, /^\[data-tone=/m);
  assert.doesNotMatch(css, /\.rd-stage \[data-rd-tone=/);
});

test("the narrow-width switcher is a sibling of the layout, never inside a pane", () => {
  // It used to render inside the workspace header, which lives in `.rd-main` —
  // and the ≤58rem rules hide `.rd-main` in the queue and inspector views. So
  // switching away from the diff hid the control that switches back. Nothing
  // in a source-text assertion could see that; driving the surface at 820px
  // could, and did.
  assert.doesNotMatch(header, /rd-mobile-tabs/);
  assert.match(tabs, /rd-mobile-tabs/);
  const switcher = surface.indexOf("<ReviewMobileTabs");
  const layout = surface.indexOf('<div className="rd-layout">');
  assert.ok(switcher > 0 && layout > switcher, "the switcher must precede the layout");
});

test("responsive and accessibility contracts are explicit", () => {
  assert.match(css, /container: review-deck \/ inline-size/);
  assert.match(css, /@container review-deck \(max-width: 78rem\)/);
  assert.match(css, /@container review-deck \(max-width: 58rem\)/);
  assert.match(css, /min-height: var\(--touch-target\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.rd-stage\[data-mobile-view="queue"\] \.rd-queue/);
  assert.match(css, /\.rd-stage\[data-mobile-view="evidence"\] \.rd-inspector/);
  assert.match(inspector, /tabIndex=\{-1\}/);
  assert.match(queue, /aria-current=\{active \? "true" : undefined\}/);
  assert.match(rail, /role="tablist" aria-label="Changed files"/);
  // The mix bar is decoration for a sighted reader and a sentence for everyone else.
  assert.match(queue, /aria-label=\{`Queue mix: \$\{summary\}`\}/);
});

test("the Review Deck documentation names the focused review run", () => {
  assert.match(docs, /\*\*Review Deck\*\* \(`reviewer-review-deck`, role `reviewer`\)/);
});
