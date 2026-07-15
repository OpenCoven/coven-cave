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

test("slice: action markers are stripped without a card (W2b renders them)", () => {
  const pieces = sliceGitHubBlocks('do it <coven:github-action kind="merge" repo="a/b" number="7" /> now');
  assert.ok(pieces.every((p) => p.kind === "text"));
  const joined = pieces.map((p) => (p.kind === "text" ? p.text : "")).join("");
  assert.ok(!joined.includes("coven:github-action"));
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
