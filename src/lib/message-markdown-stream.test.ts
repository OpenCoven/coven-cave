import assert from "node:assert/strict";
import test from "node:test";
import * as markdownStream from "./message-markdown-stream.ts";

const {
  cacheRenderedMarkdown,
  closeTrailingFence,
  getRenderedMarkdown,
  scanFenceFilenames,
  stabilizeStreamingMarkdown,
} = markdownStream;

test("markdown stream helpers preserve filename fences and close only incomplete fences", () => {
  assert.equal(closeTrailingFence("```ts\nconst x = 1"), "```ts\nconst x = 1\n```");
  assert.equal(closeTrailingFence("```ts\nconst x = 1\n```"), "```ts\nconst x = 1\n```");
  assert.deepEqual(scanFenceFilenames("```ts:src/a.ts\na\n```\n```\nb\n```"), ["src/a.ts", null]);
});

test("streaming markdown closes incomplete inline formatting only for presentation", () => {
  assert.equal(stabilizeStreamingMarkdown("A **bold"), "A **bold**");
  assert.equal(stabilizeStreamingMarkdown("An _italic"), "An _italic_");
  assert.equal(stabilizeStreamingMarkdown("Use `code"), "Use `code`");
  assert.equal(
    stabilizeStreamingMarkdown("Open [the docs](https://example.com"),
    "Open [the docs](https://example.com)",
  );
  assert.equal(stabilizeStreamingMarkdown("* list item"), "* list item");
  assert.equal(stabilizeStreamingMarkdown("threads_dgg"), "threads_dgg");
});

test("streaming markdown closes nested inline delimiters in reverse order", () => {
  assert.equal(stabilizeStreamingMarkdown("A **bold and _soft"), "A **bold and _soft_**");
});

test("streaming markdown removes empty trailing openers instead of exposing markers", () => {
  assert.equal(stabilizeStreamingMarkdown("Waiting **"), "Waiting ");
  assert.equal(stabilizeStreamingMarkdown("Waiting `"), "Waiting ");
  assert.equal(stabilizeStreamingMarkdown("Waiting _"), "Waiting ");
});

test("streaming markdown does not carry incomplete emphasis across paragraphs", () => {
  assert.equal(
    stabilizeStreamingMarkdown("Start *unfinished\n\nNext paragraph"),
    "Start unfinished\n\nNext paragraph",
  );
});

test("rendered markdown cache refreshes recency before eviction", () => {
  cacheRenderedMarkdown("first", "one");
  assert.equal(getRenderedMarkdown("first"), "one");
});

test("settling synchronously rejects a deferred transient render", async () => {
  type RenderGate = {
    issue(): number;
    settle(): void;
    apply(stamp: number): boolean;
  };
  const createRenderGate = (
    markdownStream as typeof markdownStream & {
      createMarkdownRenderGate?: () => RenderGate;
    }
  ).createMarkdownRenderGate;
  assert.equal(
    typeof createRenderGate,
    "function",
    "the stream state machine exposes a render gate",
  );
  if (!createRenderGate) return;

  const gate = createRenderGate();
  const transientStamp = gate.issue();
  let releaseTransient!: (html: string) => void;
  const transient = new Promise<string>((resolve) => {
    releaseTransient = resolve;
  });
  const commits: string[] = [];
  const commitTransient = transient.then((html) => {
    if (gate.apply(transientStamp)) commits.push(html);
  });

  // This mirrors an interrupted pending=true → pending=false render: settle
  // advances, a trailing stream timer issues more work, and the restarted
  // settled render advances the still-uncommitted transition again.
  gate.settle();
  const trailingStamp = gate.issue();
  let releaseTrailing!: (html: string) => void;
  const trailing = new Promise<string>((resolve) => {
    releaseTrailing = resolve;
  });
  const commitTrailing = trailing.then((html) => {
    if (gate.apply(trailingStamp)) commits.push(html);
  });
  gate.settle();

  releaseTransient("obsolete stream snapshot");
  releaseTrailing("late obsolete stream snapshot");
  await Promise.all([commitTransient, commitTrailing]);

  assert.deepEqual(commits, []);
  const settledStamp = gate.issue();
  assert.equal(gate.apply(settledStamp), true);
});

test("a trailing callback keeps the stamp issued before a single settle", async () => {
  const gate = markdownStream.createMarkdownRenderGate();
  const scheduledStamp = gate.issue();
  gate.settle();

  // The callback starts only after settlement, but it carries the stamp from
  // scheduling time and therefore cannot cross the settled barrier.
  await Promise.resolve();
  assert.equal(gate.apply(scheduledStamp), false);
});

test("normalizePseudoLists joins wrapped item lines back onto their marker (lazy continuation)", () => {
  const { normalizePseudoLists } = markdownStream;
  assert.equal(
    normalizePseudoLists("1. **one** — text that\nwraps onto a second line\n2. **two** — more"),
    "1. **one** — text that wraps onto a second line\n2. **two** — more",
  );
  assert.equal(
    normalizePseudoLists("- one — text\nwraps\n- two"),
    "- one — text wraps\n- two",
  );
});

test("normalizePseudoLists converts paren and bold-wrapped numbered markers in real runs", () => {
  const { normalizePseudoLists } = markdownStream;
  assert.equal(
    normalizePseudoLists("Levers:\n1) one\n2) two\n3) three"),
    "Levers:\n1. one\n2. two\n3. three",
  );
  assert.equal(
    normalizePseudoLists("**1. Skills-first** — start here\n**2. Pipeline** — capture"),
    "1. **Skills-first** — start here\n2. **Pipeline** — capture",
  );
  // A lone `1)` line is prose, not a list.
  assert.equal(normalizePseudoLists("Levers:\n1) only item"), "Levers:\n1) only item");
});

test("normalizePseudoLists never rewrites fenced code and stops at block boundaries", () => {
  const { normalizePseudoLists } = markdownStream;
  const fenced = "```txt\n1) not a list\nwrapped\n2) still code\n```";
  assert.equal(normalizePseudoLists(fenced), fenced);
  // Blank lines end a run; paragraphs after the list stay separate.
  assert.equal(
    normalizePseudoLists("1. one\n2. two\n\nA closing paragraph."),
    "1. one\n2. two\n\nA closing paragraph.",
  );
  // Headings and quotes are never swallowed as continuations.
  assert.equal(
    normalizePseudoLists("1. one\n# Heading\n2. two"),
    "1. one\n# Heading\n2. two",
  );
});
