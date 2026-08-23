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

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const surface = read("./reviewer-surface.tsx");
const sourceHook = read("./use-review-source.ts");
const queue = read("./review-queue.tsx");
const header = read("./review-workbench-header.tsx");
const diff = read("./review-diff-workbench.tsx");
const navigator = read("./review-file-navigator.tsx");
const evidence = read("./review-evidence-dock.tsx");
const verdict = read("./review-verdict-dock.tsx");
const checkpoints = read("./review-checkpoints-drawer.tsx");
const docs = read("../../../docs/role-surfaces.md");
const cssFacade = read("../../styles/review-deck.css");
const cssFiles = [
  "../../styles/review-deck/base.css",
  "../../styles/review-deck/layout.css",
  "../../styles/review-deck/queue.css",
  "../../styles/review-deck/diff.css",
  "../../styles/review-deck/evidence.css",
  "../../styles/review-deck/verdict.css",
  "../../styles/review-deck/responsive.css",
];
const css = cssFiles.map(read).join("\n");
const renderSources = [
  surface,
  queue,
  header,
  diff,
  navigator,
  evidence,
  verdict,
  checkpoints,
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
  assert.equal(
    prUrl({ repo: "o/r", number: 42 }),
    "https://github.com/o/r/pull/42",
  );
});

test("unified diff rows carry old and new line numbers", () => {
  const lines = parseDiffLines(
    [
      "@@ -8,3 +8,4 @@",
      " context",
      "-before",
      "+after",
      "+extra",
    ].join("\n"),
  );
  assert.deepEqual(
    lines.map(({ kind, oldLine, newLine }) => ({
      kind,
      oldLine,
      newLine,
    })),
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
  assert.ok(
    buildDiffRows(lines, 3, new Set([fold.key])).length > rows.length,
  );
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
    "ReviewQueue",
    "ReviewWorkbenchHeader",
    "ReviewDiffWorkbench",
    "ReviewEvidenceDock",
    "ReviewVerdictDock",
    "ReviewCheckpointsDrawer",
  ]) {
    assert.match(surface, new RegExp(`<${component}`));
  }
  assert.ok(
    surface.split("\n").length < 900,
    "orchestrator should stay bounded",
  );
});

test("review progress is scoped to the canonical revision", () => {
  assert.match(surface, /useReviewProgress\(\{/);
  assert.match(surface, /sourceId: workItem\?\.id \?\? null/);
  assert.match(surface, /revision: workItem\?\.revision \?\? null/);
  assert.match(diff, /readable files reviewed on this revision/);
  assert.match(diff, /aria-pressed=\{currentReviewed\}/);
  assert.match(diff, /Previous unread file/);
  assert.match(diff, /Next unread file/);
});

test("the always-visible note moved into the verdict flow", () => {
  assert.doesNotMatch(surface, /<textarea/);
  assert.match(verdict, /open=\{reviewMode != null\}/);
  assert.match(verdict, /Review note \{reviewMode === "approve" \? "· Optional" : ""\}/);
  assert.match(verdict, /The draft stays with this session/);
  assert.match(verdict, /maxLength=\{GITHUB_REVIEW_BODY_MAX_LENGTH\}/);
  assert.match(verdict, /aria-describedby="rd-review-help rd-review-count"/);
  assert.match(verdict, /noteError \? <span className="rd-error" role="alert"/);
});

test("keyboard shortcuts ignore editable targets and expose help", () => {
  assert.match(surface, /isEditableTarget\(event\.target\)/);
  assert.match(surface, /event\.isComposing/);
  assert.match(surface, /resolveReviewShortcut/);
  assert.match(header, /role="tablist" aria-label="Review Deck views"/);
  assert.match(header, /Character shortcuts pause while you type/);
  assert.match(navigator, /tabIndex=\{0\}/);
  assert.match(navigator, /aria-activedescendant=/);
});

test("retry, empty, checkpoint, and announcement states remain explicit", () => {
  assert.match(diff, /<SurfaceError/);
  assert.match(diff, /onRetry=\{source\.retry\}/);
  assert.match(diff, /Nothing was approved or merged/);
  assert.match(diff, /source\.open\(source\.openPath\)/);
  assert.match(checkpoints, /parseCheckpointEnvelope/);
  assert.match(checkpoints, /<SurfaceError/);
  assert.match(checkpoints, /No checkpoints saved/);
  assert.match(surface, /useAnnouncer/);
});

test("evidence is adaptive and names unavailable truth", () => {
  assert.match(evidence, /Review evidence/);
  assert.match(evidence, /readinessPhase === "loading"/);
  assert.match(evidence, /Nothing is inferred/);
  assert.match(evidence, /No checks have reported on this head/);
  assert.match(evidence, /Resolving threads needs a GitHub token/);
});

test("the stylesheet is a responsibility-split facade", () => {
  for (const name of [
    "base",
    "layout",
    "queue",
    "diff",
    "evidence",
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
  assert.ok(classes.size > 100, `expected a substantial surface, saw ${classes.size} classes`);
  const styled = new Set(
    [...css.matchAll(/\.(rd-[a-z0-9-]+)/g)].map((match) => match[1]),
  );
  assert.deepEqual(
    [...classes].filter((name) => !styled.has(name)).sort(),
    [],
  );
});

test("responsive and accessibility contracts are explicit", () => {
  assert.match(css, /container: review-deck \/ inline-size/);
  assert.match(css, /@container review-deck \(max-width: 78rem\)/);
  assert.match(css, /@container review-deck \(max-width: 58rem\)/);
  assert.match(css, /min-height: var\(--touch-target\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.rd-stage\[data-mobile-view="queue"\] \.rd-queue/);
  assert.match(diff, /<progress/);
  assert.match(evidence, /tabIndex=\{-1\}/);
  assert.match(queue, /aria-current=\{active \? "true" : undefined\}/);
});

test("the Review Deck documentation names the focused review run", () => {
  assert.match(
    docs,
    /\*\*Review Deck\*\* \(`reviewer-review-deck`, role `reviewer`\)/,
  );
});
