import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as reviewDeck from "./review-deck.ts";
import {
  diffStatLabel,
  needsHuman,
  parseDiffLines,
  prLabel,
  prUrl,
  reviewDeckStatus,
  reviewQueue,
  reviewSummary,
  reviewType,
  reviewTypeMeta,
  sessionLifecycle,
  verdictMeta,
} from "./review-deck.ts";

const surface = readFileSync(new URL("./reviewer-surface.tsx", import.meta.url), "utf8");
const reviewSource = readFileSync(new URL("./use-review-source.ts", import.meta.url), "utf8");
const prReadiness = readFileSync(new URL("./use-pr-readiness.ts", import.meta.url), "utf8");
const deckBuckets = readFileSync(new URL("./use-deck-buckets.ts", import.meta.url), "utf8");
const navigator = readFileSync(new URL("./review-file-navigator.tsx", import.meta.url), "utf8");
const register = readFileSync(new URL("./register.tsx", import.meta.url), "utf8");
const docs = readFileSync(new URL("../../../docs/role-surfaces.md", import.meta.url), "utf8");
const reviewDeckCss = readFileSync(new URL("../../styles/review-deck.css", import.meta.url), "utf8");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

// ── Queue rules (behavioral, real module) ────────────────────────────────────

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

test("reviewQueue keeps only sessions with review material, newest first", () => {
  const queue = reviewQueue([
    session({ id: "plain" }),
    session({ id: "pr", pullRequest: { repo: "o/r", number: 7 }, updated_at: "2026-07-14T09:00:00Z" }),
    session({ id: "diffed", diff: { additions: 3, deletions: 1 }, updated_at: "2026-07-14T11:00:00Z" }),
    session({ id: "branched", git: { branch: "feat/x" }, updated_at: "2026-07-14T08:00:00Z" }),
    session({ id: "archived", pullRequest: { repo: "o/r", number: 9 }, archived_at: "2026-07-13T00:00:00Z" }),
    session({ id: "zero-diff", diff: { additions: 0, deletions: 0 } }),
  ]);
  assert.deepEqual(
    queue.map((item) => item.session.id),
    ["diffed", "pr", "branched"],
  );
});

test("reviewQueue explains why each session is on the deck", () => {
  const [item] = reviewQueue([
    session({
      id: "everything",
      pullRequest: { repo: "o/r", number: 1 },
      diff: { additions: 1, deletions: 0 },
      git: { branch: "main" },
    }),
  ]);
  assert.deepEqual(item.reasons, ["pull-request", "working-changes", "branch"]);
});

test("diffStatLabel is honest about empty diffs", () => {
  assert.equal(diffStatLabel(null), "no changes");
  assert.equal(diffStatLabel({ additions: 0, deletions: 0 }), "no changes");
  assert.equal(diffStatLabel({ additions: 12, deletions: 3 }), "+12 −3");
});

test("PR labels and URLs need a number to link", () => {
  assert.equal(prLabel(null), null);
  assert.equal(prLabel({ repo: "o/r" }), "o/r");
  assert.equal(prLabel({ repo: "o/r", number: 42 }), "o/r#42");
  assert.equal(prUrl({ repo: "o/r" }), null);
  assert.equal(prUrl({ repo: "o/r", number: 42 }), "https://github.com/o/r/pull/42");
});

test("reviewDeckStatus reads ok when clear and busy with a queue", () => {
  assert.deepEqual(reviewDeckStatus({ queue: 0, pullRequests: 0 }), { label: "deck clear", tone: "ok" });
  assert.deepEqual(reviewDeckStatus({ queue: 3, pullRequests: 0 }), { label: "3 to review", tone: "busy" });
  assert.deepEqual(reviewDeckStatus({ queue: 3, pullRequests: 1 }), { label: "3 to review · 1 PR", tone: "busy" });
});

test("latest review request keeps project B when project A resolves last", async () => {
  assert.equal(typeof reviewDeck.createReviewRequestGate, "function");
  const gate = reviewDeck.createReviewRequestGate();
  const projectA = gate.begin("reviewer:session-a:/repo/a");
  const projectB = gate.begin("reviewer:session-b:/repo/b");
  const projectAResponse = deferred<void>();
  const projectBResponse = deferred<void>();
  const committed: string[] = [];

  const finishA = projectAResponse.promise.then(() => {
    if (gate.isCurrent(projectA, "reviewer:session-b:/repo/b")) committed.push("project-a");
  });
  const finishB = projectBResponse.promise.then(() => {
    if (gate.isCurrent(projectB, "reviewer:session-b:/repo/b")) committed.push("project-b");
  });

  projectBResponse.resolve();
  await finishB;
  projectAResponse.resolve();
  await finishA;
  assert.deepEqual(committed, ["project-b"]);
  assert.equal(gate.isCurrent(projectB, "reviewer:session-a:/repo/a"), false);
});

test("reset invalidates an in-flight diff without needing a replacement request", async () => {
  assert.equal(typeof reviewDeck.createReviewRequestGate, "function");
  const gate = reviewDeck.createReviewRequestGate();
  const oldDiff = gate.begin("reviewer:session-a:/repo/a:a.ts");
  gate.invalidate();

  let committed = false;
  await Promise.resolve().then(() => {
    if (gate.isCurrent(oldDiff, "reviewer:session-a:/repo/a:a.ts")) committed = true;
  });

  assert.equal(committed, false);
});

test("checkpoint envelopes preserve a valid empty list", () => {
  assert.equal(typeof reviewDeck.parseCheckpointEnvelope, "function");
  assert.deepEqual(reviewDeck.parseCheckpointEnvelope({ ok: true, checkpoints: [] }), []);
});

test("checkpoint envelopes reject failed, missing, and malformed payloads", () => {
  assert.equal(typeof reviewDeck.parseCheckpointEnvelope, "function");
  assert.throws(() => reviewDeck.parseCheckpointEnvelope({ ok: false, checkpoints: [] }));
  assert.throws(() => reviewDeck.parseCheckpointEnvelope({ checkpoints: [] }));
  assert.throws(() => reviewDeck.parseCheckpointEnvelope({ ok: true }));
  assert.throws(() =>
    reviewDeck.parseCheckpointEnvelope({
      ok: true,
      checkpoints: [{ name: "saved.patch", savedAt: "now", bytes: "four" }],
    }),
  );
});

// ── Surface wiring (source pins) ─────────────────────────────────────────────

test("the review source is decided by the session, not by which fetch resolved first", () => {
  // A linked pull request is read from GitHub; only a session without one falls
  // back to its project's working tree.
  assert.match(reviewSource, /const kind: ReviewSourceKind = pr \? "pull-request" : projectRoot \? "local" : "none"/);
  assert.match(reviewSource, /\/api\/github\/diff\?repo=\$\{encodeURIComponent\(repo\)\}&number=/);
  assert.match(reviewSource, /\/api\/changes\?projectRoot=\$\{encodeURIComponent\(projectRoot as string\)\}/);
  assert.match(reviewSource, /&path=\$\{encodeURIComponent\(path\)\}/);
  // Pull-request actions gate on the source and GitHub's state, never the row.
  assert.match(surface, /const canAct = isPr && readiness\.phase === "ready" && facts\?\.state === "open" && !facts\.draft/);
  assert.match(surface, /&checkpoints=1/);
  assert.match(surface, /Patch truncated server-side/);
  assert.match(surface, /never edits the working tree/);
});

test("source loaders scope request gates to the selected session and reset them", () => {
  assert.match(reviewSource, /const listGate = useRef\(createReviewRequestGate\(\)\)/);
  assert.match(reviewSource, /const request = listGate\.current\.begin\(scope\)/);
  assert.match(reviewSource, /listGate\.current\.isCurrent\(request, latestScope\.current\)/);
  assert.match(reviewSource, /const patchGate = useRef\(createReviewRequestGate\(\)\)/);
  assert.match(reviewSource, /patchGate\.current\.begin\(`\$\{scope\}:\$\{path\}`\)/);
  assert.match(reviewSource, /patchGate\.current\.isCurrent\(request, `\$\{latestScope\.current\}:\$\{path\}`\)/);
  // Both gates close when the hook unmounts or the session changes.
  assert.match(
    reviewSource,
    /return \(\) => \{\s*listGate\.current\.invalidate\(\);\s*patchGate\.current\.invalidate\(\);\s*\};/,
  );
  // A new list drops the previously open file rather than leaving a stale patch.
  assert.match(reviewSource, /setOpenPath\(null\);\s*setOpenPatch\(IDLE_PATCH\);/);
  // The scope carries the session, so a reply for the previous one is discarded.
  assert.match(surface, /const selectedScope = `\$\{familiarId\}:\$\{selected\?\.session\.id \?\? "none"\}/);
});

test("the queue derives from the familiar's real sessions", () => {
  assert.match(surface, /reviewQueue\(context\.runtimeState\.sessions\)/);
  assert.match(surface, /context\.openSession\(selected\.session\.id, familiarId\)/);
  assert.match(surface, /context\.openUrl\(selectedPrUrl\)/);
  assert.match(surface, /SurfaceEmpty/);
  assert.match(surface, /useRoleSurfaceState<ReviewerState>/);
});

test("bucket filter announcements run outside React state updaters", () => {
  assert.match(
    surface,
    /const next = bucketFilter === bucket \? null : bucket;\s*setBucketFilter\(next\);\s*announce\(/,
  );
  assert.doesNotMatch(
    surface,
    /setBucketFilter\(\(prev\) => \{[\s\S]*?announce\(/,
  );
});

test("the deck exposes errors and expansion state accessibly", () => {
  assert.match(surface, /\bSurfaceError\b/);
  assert.match(surface, /aria-current=\{active \? "true" : undefined\}/);
  // File rows are options in a roving listbox, not expanders — only the
  // directory rows that really open and close carry aria-expanded.
  assert.match(navigator, /aria-expanded=\{!row\.collapsed\}/);
  assert.doesNotMatch(navigator, /kind === "file"[\s\S]{0,400}aria-expanded/);
});

test("registration names the Review Deck with its own accent and drawer chrome", () => {
  assert.match(register, /id: REVIEWER_SURFACE_ID/);
  assert.match(register, /role: "reviewer"/);
  assert.match(register, /title: "Review Deck"/);
  assert.match(register, /iconName: "ph:git-diff"/);
  assert.match(register, /accentHue: 0/);
  assert.match(register, /combo: "mod\+shift\+d",\s*\n\s*description: "Toggle the checkpoints drawer"/);
  assert.match(register, /reviewDeckStatus\(/);
});

test("the Review Deck is documented as an initial room", () => {
  assert.match(docs, /\*\*Review Deck\*\* \(`reviewer-review-deck`, role `reviewer`\)/);
});

test("the Review Deck stacks its tri-pane layout before verdict actions clip", () => {
  assert.match(
    reviewDeckCss,
    /@container role-surface-host \(max-width: 1080px\) \{[\s\S]*?\.rd-stage \{[\s\S]*?overflow-y: auto;/,
  );
  assert.match(
    reviewDeckCss,
    /@container role-surface-host \(max-width: 1080px\) \{[\s\S]*?\.rd-grid[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
  );
  assert.match(
    reviewDeckCss,
    /@container role-surface-host \(max-width: 1080px\) \{[\s\S]*?\.rd-verdict-bar \{[\s\S]*?flex-wrap: wrap;/,
  );
});

// ── Type, lifecycle & verdict derivation ─────────────────────────────────────

test("reviewType picks the strongest handle a session carries", () => {
  assert.equal(reviewType(["pull-request", "working-changes", "branch"]), "pull-request");
  assert.equal(reviewType(["working-changes", "branch"]), "working-changes");
  assert.equal(reviewType(["branch"]), "branch");
});

test("reviewTypeMeta labels each type with a real icon", () => {
  assert.equal(reviewTypeMeta(["pull-request"]).label, "PR");
  assert.equal(reviewTypeMeta(["pull-request"]).icon, "ph:git-pull-request");
  assert.equal(reviewTypeMeta(["working-changes"]).icon, "ph:git-diff");
  assert.equal(reviewTypeMeta(["branch"]).icon, "ph:git-branch");
});

test("sessionLifecycle maps daemon statuses onto the board lifecycle", () => {
  assert.equal(sessionLifecycle("running"), "running");
  assert.equal(sessionLifecycle("active"), "running");
  assert.equal(sessionLifecycle("review"), "review");
  assert.equal(sessionLifecycle("succeeded"), "completed");
  assert.equal(sessionLifecycle("idle"), "completed");
  assert.equal(sessionLifecycle("error"), "failed");
  assert.equal(sessionLifecycle("killed"), "failed");
  assert.equal(sessionLifecycle("queued"), "queued");
  assert.equal(sessionLifecycle("something-new"), "queued");
  assert.equal(sessionLifecycle(null), "queued");
});

test("verdictMeta gives each verdict a tone and icon", () => {
  assert.deepEqual(verdictMeta("approved"), { label: "Approved", icon: "ph:seal-check", tone: "success" });
  assert.equal(verdictMeta("changes").tone, "warning");
  assert.equal(verdictMeta("merged").icon, "ph:git-merge");
});

test("needsHuman clears once a verdict lands, else flags review/failed", () => {
  assert.equal(needsHuman("review", null), true);
  assert.equal(needsHuman("failed", null), true);
  assert.equal(needsHuman("running", null), false);
  assert.equal(needsHuman("review", "approved"), false);
});

// ── Summary strip ────────────────────────────────────────────────────────────

test("reviewSummary counts awaiting, approved, changes, and landed-clean", () => {
  const summary = reviewSummary([
    { diff: { additions: 4, deletions: 0 }, lifecycle: "review", verdict: null }, // awaiting + dirty
    { diff: { additions: 0, deletions: 0 }, lifecycle: "completed", verdict: "approved" }, // approved + clean
    { diff: null, lifecycle: "completed", verdict: "merged" }, // approved (merged) + clean
    { diff: { additions: 1, deletions: 1 }, lifecycle: "review", verdict: "changes" }, // changes + dirty
    { diff: { additions: 0, deletions: 0 }, lifecycle: "running", verdict: null }, // clean, not awaiting (running)
  ]);
  assert.deepEqual(summary, { awaiting: 1, approved: 2, changes: 1, landedClean: 3 });
});

// ── Unified-diff parsing (colored body) ──────────────────────────────────────

test("parseDiffLines classifies headers, hunks, and edits", () => {
  const diff = [
    "diff --git a/x.ts b/x.ts",
    "index 111..222 100644",
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -1,2 +1,2 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    "", // trailing newline artifact
  ].join("\n");
  const lines = parseDiffLines(diff);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["meta", "meta", "meta", "meta", "hunk", "ctx", "del", "add"],
  );
  const add = lines.find((l) => l.kind === "add");
  assert.deepEqual({ mark: add?.mark, text: add?.text }, { mark: "+", text: "const b = 3;" });
  const del = lines.find((l) => l.kind === "del");
  assert.equal(del?.mark, "−");
  const ctx = lines.find((l) => l.kind === "ctx");
  assert.equal(ctx?.text, "const a = 1;"); // leading context space stripped
});

test("parseDiffLines handles empties, CRLF, and the no-newline marker", () => {
  assert.deepEqual(parseDiffLines(""), []);
  // CRLF endings are normalized away so Windows diffs render clean.
  const crlf = parseDiffLines("@@ -1 +1 @@\r\n+added\r\n");
  assert.deepEqual(
    crlf.map((l) => l.text),
    ["@@ -1 +1 @@", "added"],
  );
  // Git's "\ No newline at end of file" marker is context, not an edit.
  const marker = parseDiffLines("+last line\n\\ No newline at end of file");
  assert.equal(marker[0].kind, "add");
  assert.equal(marker[1].kind, "ctx");
});

test("working-tree and diff failures use shared retryable room states", () => {
  assert.match(surface, /import[\s\S]*?\bSurfaceLoading\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(surface, /import[\s\S]*?\bSurfaceError\b[\s\S]*?from "\.\/surface-room"/);
  // The file list: loading, then a retryable error that says nothing landed.
  assert.match(
    surface,
    /source\.phase === "loading" \? \(\s*<SurfaceLoading[\s\S]{0,200}?\) : source\.phase === "error" \? \(\s*<SurfaceError[\s\S]{0,300}?onRetry=\{source\.retry\}/,
  );
  assert.match(surface, /Nothing was approved or merged\. Retry/);
  // The open file's patch retries on its own, without refetching the list.
  assert.match(
    surface,
    /source\.openPatch\.phase === "loading" \? \(\s*<SurfaceLoading[\s\S]{0,200}?\) : source\.openPatch\.phase === "error" \? \(\s*<SurfaceError[\s\S]{0,300}?onRetry=\{\(\) => source\.openPath && source\.open\(source\.openPath\)\}/,
  );
});

test("checkpoint failures stay retryable and distinct from valid empty data", () => {
  assert.match(surface, /const \[checkpointError, setCheckpointError\] = useState<string \| null>\(null\)/);
  assert.match(surface, /const loadCheckpoints = useCallback\(async \(\) =>/);
  assert.match(
    surface,
    /checkpointError\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?onRetry=\{loadCheckpoints\}[\s\S]*?\)\s*:\s*checkpoints == null\s*\?/,
  );
  assert.match(surface, /checkpoints\.length === 0[\s\S]*?No checkpoints saved/);
});

test("the announcer owns assertive verdict failures while visible error copy stays passive", () => {
  assert.match(surface, /import \{ useAnnouncer \} from "@\/components\/ui\/live-region"/);
  assert.match(surface, /const \{ announce \} = useAnnouncer\(\)/);
  // Each dispatched verdict announces itself, and says the deck is re-reading
  // GitHub rather than trusting this visit's click.
  assert.match(surface, /announce\(`Approved \$\{prLabel\(selectedPr\)\}\. Re-reading GitHub state\.`\)/);
  assert.match(surface, /announce\(`Requested changes on \$\{prLabel\(selectedPr\)\}\. Re-reading GitHub state\.`\)/);
  assert.match(surface, /announce\(`Merged \$\{prLabel\(selectedPr\)\} \(squash\)/);
  assert.match(surface, /setActionError\(message\);\s*announce\(message, "assertive"\)/);
  // The visible copy stays passive — the announcer already owns the assertion.
  assert.match(surface, /\{actionError \? <span className="rd-error">\{actionError\}<\/span> : null\}/);
  assert.doesNotMatch(surface, /<span role="alert" className="rd-error">/);
});

// ── Review-feedback fixes (hook internals; the helpers are module-private) ───

test("GitHub's `removed` status maps to deleted, not modified", () => {
  // git says "deleted", GitHub says "removed". Falling through to the default
  // painted every deleted file in a pull request as modified.
  assert.match(reviewSource, /removed: "deleted"/);
  assert.match(reviewSource, /copied: "added"/);
  assert.match(reviewSource, /changed: "modified"/);
  assert.match(reviewSource, /unchanged: "modified"/);
  assert.match(reviewSource, /return GITHUB_STATUS\[value\] \?\? "modified"/);
});

test("an author's standing review is their latest by timestamp, not by array order", () => {
  assert.match(prReadiness, /const held = perAuthor\.get\(author\)/);
  assert.match(
    prReadiness,
    /if \(held && \(held\.submittedAt \?\? ""\) > \(candidate\.submittedAt \?\? ""\)\) continue/,
  );
});

test("the bucket reader clears loading on teardown so it cannot stick on", () => {
  // The `.then` skips its own reset when cancelled and the next run early-
  // returns on a fully cached queue, so teardown is the only path that always
  // runs between the two.
  assert.match(
    deckBuckets,
    /return \(\) => \{\s*cancelled = true;[\s\S]{0,200}?setLoading\(false\);\s*\};/,
  );
});

// ── Style coverage ───────────────────────────────────────────────────────────

test("every deck class the markup renders has a rule in the deck's stylesheet", () => {
  // The gap this closes: the redesign replaced the tab strip with a file
  // navigator, a readiness rail, a composer and a merge dialog, and shipped
  // none of their CSS — 113 of 183 classes rendered with no rule at all. No
  // other gate sees it: the drift ratchet counts values rather than coverage,
  // the e2e job mocks its routes, and nothing else asserts a rendered style.
  const classes = new Set<string>();
  for (const source of [surface, navigator]) {
    for (const match of source.matchAll(/className="([^"]*)"/g)) {
      for (const name of match[1].split(/\s+/)) if (name.startsWith("rd-")) classes.add(name);
    }
    for (const match of source.matchAll(/className=\{`([^`]*)`\}/g)) {
      for (const name of match[1].match(/rd-[a-z0-9-]+/g) ?? []) classes.add(name);
    }
  }
  assert.ok(classes.size > 100, `expected the deck to render many classes, saw ${classes.size}`);

  const styled = new Set(
    [...reviewDeckCss.matchAll(/\.(rd-[a-z0-9-]+)/g)].map((match) => match[1]),
  );
  const missing = [...classes].filter((name) => !styled.has(name)).sort();
  assert.deepEqual(missing, [], `deck classes rendered with no CSS rule: ${missing.join(", ")}`);
});

test("the stylesheet carries no rules for markup the deck no longer renders", () => {
  // The retired tab strip's rules outlived it by a whole redesign. Dead CSS
  // reads as coverage on the next audit, so the sweep runs both ways.
  const classes = new Set<string>();
  for (const source of [surface, navigator]) {
    for (const match of source.matchAll(/className="([^"]*)"/g)) {
      for (const name of match[1].split(/\s+/)) if (name.startsWith("rd-")) classes.add(name);
    }
    for (const match of source.matchAll(/className=\{`([^`]*)`\}/g)) {
      for (const name of match[1].match(/rd-[a-z0-9-]+/g) ?? []) classes.add(name);
    }
  }
  const styled = [...new Set([...reviewDeckCss.matchAll(/\.(rd-[a-z0-9-]+)/g)].map((m) => m[1]))];
  const dead = styled.filter((name) => !classes.has(name)).sort();
  assert.deepEqual(dead, [], `stylesheet rules with no markup: ${dead.join(", ")}`);
});

test("the file navigator is styled as a keyboard widget, not a list of buttons", () => {
  // The container owns the tab stop and the focus ring; the cursor marks the
  // active row. Both halves have to exist or the roving model is invisible.
  assert.match(reviewDeckCss, /\.rd-nav-list:focus-visible \{\s*outline: none;\s*\}/);
  assert.match(reviewDeckCss, /\.rd-nav-dir\[data-cursor="true"\],\s*\.rd-nav-file\[data-cursor="true"\]/);
  assert.match(navigator, /tabIndex=\{0\}/);
});
