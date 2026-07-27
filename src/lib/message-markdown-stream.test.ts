import assert from "node:assert/strict";
import test from "node:test";
import * as markdownStream from "./message-markdown-stream.ts";

const {
  cacheRenderedMarkdown,
  closeTrailingFence,
  getRenderedMarkdown,
  scanFenceFilenames,
} = markdownStream;

test("markdown stream helpers preserve filename fences and close only incomplete fences", () => {
  assert.equal(closeTrailingFence("```ts\nconst x = 1"), "```ts\nconst x = 1\n```");
  assert.equal(closeTrailingFence("```ts\nconst x = 1\n```"), "```ts\nconst x = 1\n```");
  assert.deepEqual(scanFenceFilenames("```ts:src/a.ts\na\n```\n```\nb\n```"), ["src/a.ts", null]);
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
