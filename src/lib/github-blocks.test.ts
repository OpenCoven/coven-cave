// Behavioral tests for the GitHub chat-block protocol (design:
// docs/chat-github-integration.md §1; bead cave-fpqx.6).
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyGitHubAction,
  descriptorUrl,
  parseGitHubUrl,
  sliceGitHubBlocks,
  stripGitHubMarkers,
  unfurlUserMessage,
  type GitHubActionKind,
} from "./github-blocks.ts";

// ── parseGitHubUrl ───────────────────────────────────────────────────────────

test("parseGitHubUrl: PR, issue, commit, run, review-thread forms", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/OpenCoven/coven-cave/pull/3160"), {
    kind: "pr",
    repo: "OpenCoven/coven-cave",
    number: 3160,
  });
  assert.deepEqual(parseGitHubUrl("https://github.com/o-w/r.epo/issues/7"), {
    kind: "issue",
    repo: "o-w/r.epo",
    number: 7,
  });
  assert.deepEqual(parseGitHubUrl("https://github.com/a/b/commit/e36aaaf9563"), {
    kind: "commit",
    repo: "a/b",
    sha: "e36aaaf9563",
  });
  assert.deepEqual(parseGitHubUrl("https://github.com/a/b/actions/runs/123456"), {
    kind: "run",
    repo: "a/b",
    runId: 123456,
  });
  assert.deepEqual(parseGitHubUrl("https://github.com/a/b/pull/9#discussion_r5551"), {
    kind: "review-thread",
    repo: "a/b",
    number: 9,
    threadId: "5551",
  });
});

test("parseGitHubUrl: rejects non-matching and mangled URLs", () => {
  assert.equal(parseGitHubUrl("https://github.com/a/b"), null);
  assert.equal(parseGitHubUrl("https://github.com/a/b/pull/abc"), null);
  assert.equal(parseGitHubUrl("https://github.com/a/b/pull/12?diff=split"), null);
  assert.equal(parseGitHubUrl("https://gitlab.com/a/b/pull/12"), null);
  assert.equal(parseGitHubUrl("https://github.com/a/b/commit/xyz"), null);
  // Short shas below 7 chars are rejected.
  assert.equal(parseGitHubUrl("https://github.com/a/b/commit/abc12"), null);
});

test("descriptorUrl round-trips parseGitHubUrl", () => {
  for (const url of [
    "https://github.com/OpenCoven/coven-cave/pull/3160",
    "https://github.com/a/b/issues/7",
    "https://github.com/a/b/commit/e36aaaf",
    "https://github.com/a/b/actions/runs/9",
  ]) {
    const d = parseGitHubUrl(url);
    assert.ok(d, url);
    assert.equal(descriptorUrl(d), url);
  }
});

// ── sliceGitHubBlocks: markers ───────────────────────────────────────────────

test("slice: display marker becomes a card at its position", () => {
  const pieces = sliceGitHubBlocks(
    'Before.\n<coven:github kind="pr" repo="OpenCoven/coven-cave" number="3160" />\nAfter.',
  );
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces[1], {
    kind: "card",
    descriptor: { kind: "pr", repo: "OpenCoven/coven-cave", number: 3160, title: undefined },
  });
  assert.equal(pieces[0].kind, "text");
  assert.match((pieces[0] as { text: string }).text, /Before\./);
  assert.match((pieces[2] as { text: string }).text, /After\./);
});

test("slice: attribute order is free; title attr carries through; no self-close slash ok", () => {
  const pieces = sliceGitHubBlocks('<coven:github number="5" title="Fix the thing" repo="a/b" kind="issue">');
  assert.deepEqual(pieces, [
    { kind: "card", descriptor: { kind: "issue", repo: "a/b", number: 5, title: "Fix the thing" } },
  ]);
});

test("slice: commit and run markers parse their ref attrs", () => {
  const commit = sliceGitHubBlocks('<coven:github kind="commit" repo="a/b" sha="e36aaaf9" />');
  assert.equal(commit[0].kind, "card");
  const run = sliceGitHubBlocks('<coven:github kind="run" repo="a/b" run="42" />');
  assert.equal(run[0].kind, "card");
  assert.deepEqual((run[0] as { descriptor: unknown }).descriptor, {
    kind: "run",
    repo: "a/b",
    runId: 42,
    title: undefined,
  });
});

test("slice: review-thread thread attr must be numeric; non-numeric drops to the PR link", () => {
  const good = sliceGitHubBlocks('<coven:github kind="review-thread" repo="a/b" number="9" thread="5551" />');
  assert.deepEqual((good[0] as { descriptor: unknown }).descriptor, {
    kind: "review-thread",
    repo: "a/b",
    number: 9,
    threadId: "5551",
    title: undefined,
  });
  const bad = sliceGitHubBlocks('<coven:github kind="review-thread" repo="a/b" number="9" thread="abc" />');
  assert.deepEqual((bad[0] as { descriptor: unknown }).descriptor, {
    kind: "review-thread",
    repo: "a/b",
    number: 9,
    threadId: undefined,
    title: undefined,
  });
});

test("slice: malformed markers are dropped, never rendered raw", () => {
  for (const bad of [
    '<coven:github kind="pr" repo="not-a-repo" number="1" />', // repo fails barrier
    '<coven:github kind="nope" repo="a/b" number="1" />', // unknown kind
    '<coven:github kind="pr" repo="a/b" number="0" />', // non-positive number
    '<coven:github kind="pr" repo="a/b" number="1a" />', // non-numeric number
    '<coven:github kind="commit" repo="a/b" sha="zzz" />', // bad sha
  ]) {
    const pieces = sliceGitHubBlocks(`x ${bad} y`);
    assert.ok(pieces.every((p) => p.kind === "text"), bad);
    const joined = pieces.map((p) => (p.kind === "text" ? p.text : "")).join("");
    assert.ok(!joined.includes("<coven:github"), `raw tag leaked: ${bad}`);
  }
});

test("slice: action markers become proposal pieces (agents propose, humans dispose)", () => {
  const pieces = sliceGitHubBlocks(
    'do it <coven:github-action kind="merge" repo="a/b" number="7" method="rebase" note="ready" /> now',
  );
  const actions = pieces.filter((p) => p.kind === "action");
  assert.equal(actions.length, 1);
  assert.deepEqual((actions[0] as { action: unknown }).action, {
    kind: "merge",
    repo: "a/b",
    note: "ready",
    body: undefined,
    number: 7,
    method: "rebase",
  });
  const joined = pieces.map((p) => (p.kind === "text" ? p.text : "")).join("");
  assert.ok(!joined.includes("coven:github-action"));
});

test("slice: action attrs validate per kind — malformed proposals drop silently", () => {
  // review without a valid event, dispatch without ref, rerun without run id.
  for (const bad of [
    '<coven:github-action kind="review" repo="a/b" number="7" event="SHIP_IT" />',
    '<coven:github-action kind="dispatch" repo="a/b" workflow="ci.yml" />',
    '<coven:github-action kind="rerun" repo="a/b" />',
    '<coven:github-action kind="merge" repo="not-a-repo" number="7" />',
  ]) {
    const pieces = sliceGitHubBlocks(bad);
    assert.ok(pieces.every((p) => p.kind === "text"), bad);
  }
  // merge method defaults to squash; unknown methods coerce to squash.
  const merged = sliceGitHubBlocks('<coven:github-action kind="merge" repo="a/b" number="7" method="yolo" />');
  assert.equal((merged[0] as { action: { method?: string } }).action.method, "squash");
  // review with a valid verdict parses.
  const rev = sliceGitHubBlocks(
    '<coven:github-action kind="review" repo="a/b" number="7" event="approve" note="lgtm" />',
  );
  assert.equal((rev[0] as { action: { event?: string } }).action.event, "APPROVE");
});

// ── sliceGitHubBlocks: bare-line URL unfurl ──────────────────────────────────

test("slice: a URL alone on its line unfurls; inline mentions stay text", () => {
  const pieces = sliceGitHubBlocks(
    "See https://github.com/a/b/pull/1 inline.\nhttps://github.com/a/b/pull/2\ntail",
  );
  const cards = pieces.filter((p) => p.kind === "card");
  assert.equal(cards.length, 1);
  assert.deepEqual((cards[0] as { descriptor: { number?: number } }).descriptor.number, 2);
  const text = pieces
    .filter((p) => p.kind === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");
  // Exact-line check (not substring): the inline mention keeps its whole line.
  assert.ok(
    text.split("\n").some((l) => l === "See https://github.com/a/b/pull/1 inline."),
    "inline URL kept as text",
  );
});

test("slice: plain text passes through as a single unchanged piece", () => {
  const text = "no github here\njust prose";
  assert.deepEqual(sliceGitHubBlocks(text), [{ kind: "text", text }]);
});

test("slice: bare-line URLs inside code fences are NOT unfurled", () => {
  const text = "```sh\nopen https://x\nhttps://github.com/a/b/pull/2\n```\nhttps://github.com/a/b/pull/3";
  const pieces = sliceGitHubBlocks(text);
  const cards = pieces.filter((p) => p.kind === "card");
  assert.equal(cards.length, 1);
  assert.equal((cards[0] as { descriptor: { number?: number } }).descriptor.number, 3);
  const joined = pieces.map((p) => (p.kind === "text" ? (p as { text: string }).text : "")).join("\n");
  // Exact-line check (not substring): the fenced URL line survives verbatim.
  assert.ok(
    joined.split("\n").some((l) => l === "https://github.com/a/b/pull/2"),
    "fenced URL stays in the fence",
  );
});

// ── stripGitHubMarkers (streaming path) ──────────────────────────────────────

test("strip: removes complete display and action markers", () => {
  const out = stripGitHubMarkers(
    'a <coven:github kind="pr" repo="a/b" number="1" /> b <coven:github-action kind="merge" repo="a/b" number="1" /> c',
  );
  assert.equal(out, "a  b  c");
});

test("strip: hides a partial marker at the stream tail", () => {
  assert.equal(stripGitHubMarkers("text <coven:github kind=\"pr"), "text ");
  assert.equal(stripGitHubMarkers("text <coven:githu"), "text ");
  assert.equal(stripGitHubMarkers("text <coven:github-action kind=\"me"), "text ");
});

test("strip: leaves non-marker text and URLs alone", () => {
  const text = "see https://github.com/a/b/pull/1 and <coven:next-paths>";
  assert.equal(stripGitHubMarkers(text), text);
});

// ── unfurlUserMessage ────────────────────────────────────────────────────────

test("unfurl: user message bare-line URLs, deduped, inline ignored", () => {
  const refs = unfurlUserMessage(
    "check this\nhttps://github.com/a/b/issues/3\nhttps://github.com/a/b/issues/3\nand https://github.com/a/b/issues/4 inline",
  );
  assert.equal(refs.length, 1);
  assert.deepEqual(refs[0], { kind: "issue", repo: "a/b", number: 3 });
});

test("unfurl: empty and github-free messages return []", () => {
  assert.deepEqual(unfurlUserMessage(""), []);
  assert.deepEqual(unfurlUserMessage("hello world"), []);
});

// ── classifyGitHubAction (design §3 tiers, pinned) ───────────────────────────

test("classify: tier table matches the design", () => {
  const fire: GitHubActionKind[] = ["comment", "reply", "resolve", "unresolve", "issue-create", "issue-state"];
  const confirm: GitHubActionKind[] = ["merge", "review", "rerun", "dispatch"];
  for (const k of fire) assert.equal(classifyGitHubAction(k), "fire", k);
  for (const k of confirm) assert.equal(classifyGitHubAction(k), "confirm", k);
});

test("slice: quoted title containing '>' stays atomic (no early tag close)", () => {
  const pieces = sliceGitHubBlocks('<coven:github kind="issue" repo="a/b" number="5" title="fix a > b" />');
  assert.deepEqual(pieces, [
    { kind: "card", descriptor: { kind: "issue", repo: "a/b", number: 5, title: "fix a > b" } },
  ]);
});

// ── Review-fix pins (cave-m0r6, cave-jqke) ───────────────────────────────────

test("strip: partial tail with '>' inside an open quoted attr stays hidden", () => {
  assert.equal(
    stripGitHubMarkers('Working on <coven:github kind="pr" repo="o/r" number="7" title="fix: a -> b'),
    "Working on ",
  );
});

test("slice/strip: fenced markers are example text — literal, no cards, fence intact", () => {
  const text = 'Example:\n```xml\n<coven:github-action kind="merge" repo="o/r" number="7" />\n```\ndone';
  const pieces = sliceGitHubBlocks(text);
  assert.ok(pieces.every((p) => p.kind === "text"), "no card/action pieces from fenced markers");
  const joined = pieces.map((p) => (p.kind === "text" ? p.text : "")).join("");
  assert.ok(joined.includes('<coven:github-action kind="merge"'), "fenced marker stays literal");
  assert.equal(stripGitHubMarkers(text), text, "strip leaves fenced markers alone");
  // Unclosed trailing fence protects through the text end (streaming).
  const streaming = 'look:\n```\n<coven:github kind="pr" repo="o/r" number="7" />';
  assert.equal(stripGitHubMarkers(streaming), streaming);
});

test("action attrs: issue-state requires an explicit state; resolve accepts a thread id", () => {
  // No state → malformed, dropped (never 'default to close').
  const noState = sliceGitHubBlocks('<coven:github-action kind="issue-state" repo="a/b" number="7" />');
  assert.ok(noState.every((p) => p.kind === "text"));
  const open = sliceGitHubBlocks('<coven:github-action kind="issue-state" repo="a/b" number="7" state="open" />');
  assert.equal((open[0] as { action: { state?: string } }).action.state, "open");
  const resolve = sliceGitHubBlocks('<coven:github-action kind="resolve" repo="a/b" number="7" thread="5551" />');
  assert.equal((resolve[0] as { action: { threadId?: string } }).action.threadId, "5551");
  // Non-numeric thread ids drop to undefined (the card then refuses to fire).
  const badThread = sliceGitHubBlocks('<coven:github-action kind="resolve" repo="a/b" number="7" thread="abc" />');
  assert.equal((badThread[0] as { action: { threadId?: string } }).action.threadId, undefined);
});
