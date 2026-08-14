import assert from "node:assert/strict";
import test from "node:test";

import { partitionStreamingMarkdown, type StreamingContentBlock } from "./streaming-markdown-blocks.ts";

function flattenPairs(blocks: StreamingContentBlock[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const block of blocks) {
    pairs.push([block.id, block.source]);
    if (block.kind === "list") {
      for (const item of block.committedItems) pairs.push([item.id, item.source]);
    }
  }
  return pairs;
}

test("paragraphs/headings commit only at boundaries", () => {
  const paragraph = partitionStreamingMarkdown("A paragraph", { turnId: "t", settled: false });
  assert.deepEqual(paragraph.committedBlocks, []);
  assert.deepEqual(paragraph.activeBlock, {
    id: "t:0-11",
    kind: "markdown",
    source: "A paragraph",
    renderMode: "markdown",
  });
  assert.equal(paragraph.committedText, "");

  const nextParagraph = partitionStreamingMarkdown("A paragraph\n\nNext", { turnId: "t", settled: false });
  assert.deepEqual(nextParagraph.committedBlocks, [{
    id: "t:0-13",
    kind: "markdown",
    source: "A paragraph\n\n",
    renderMode: "markdown",
  }]);
  assert.deepEqual(nextParagraph.activeBlock, {
    id: `t:13-${"A paragraph\n\nNext".length}`,
    kind: "markdown",
    source: "Next",
    renderMode: "markdown",
  });
  assert.equal(nextParagraph.committedText, "A paragraph\n\n");

  const headingSource = "# Heading\nTail";
  const heading = partitionStreamingMarkdown(headingSource, { turnId: "t", settled: false });
  assert.deepEqual(heading.committedBlocks, [{
    id: `t:0-${"# Heading\n".length}`,
    kind: "markdown",
    source: "# Heading\n",
    renderMode: "markdown",
  }]);
  assert.deepEqual(heading.activeBlock, {
    id: `t:${"# Heading\n".length}-${headingSource.length}`,
    kind: "markdown",
    source: "Tail",
    renderMode: "markdown",
  });
  assert.equal(heading.committedText, "# Heading\n");
});

test("fenced code and tables commit only after structural completion", () => {
  const fenceOpen = partitionStreamingMarkdown("```ts\nconst x = 1", { turnId: "t", settled: false });
  assert.deepEqual(fenceOpen.committedBlocks, []);
  assert.deepEqual(fenceOpen.activeBlock, {
    id: `t:0-${"```ts\nconst x = 1".length}`,
    kind: "markdown",
    source: "```ts\nconst x = 1",
    renderMode: "plain",
  });

  const fenceClosedSource = "```ts\nconst x = 1\n```\nTail";
  const fenceClosed = partitionStreamingMarkdown(fenceClosedSource, { turnId: "t", settled: false });
  assert.deepEqual(fenceClosed.committedBlocks, [{
    id: `t:0-${"```ts\nconst x = 1\n```\n".length}`,
    kind: "markdown",
    source: "```ts\nconst x = 1\n```\n",
    renderMode: "markdown",
  }]);
  assert.deepEqual(fenceClosed.activeBlock, {
    id: `t:${"```ts\nconst x = 1\n```\n".length}-${fenceClosedSource.length}`,
    kind: "markdown",
    source: "Tail",
    renderMode: "markdown",
  });

  const tildeShortClose = partitionStreamingMarkdown("~~~~\ncode\n~~~\n", { turnId: "t", settled: false });
  assert.deepEqual(tildeShortClose.committedBlocks, []);
  assert.deepEqual(tildeShortClose.activeBlock, {
    id: `t:0-${"~~~~\ncode\n~~~\n".length}`,
    kind: "markdown",
    source: "~~~~\ncode\n~~~\n",
    renderMode: "plain",
  });

  const tildeClosedSource = "~~~~\ncode\n~~~~\nTail";
  const tildeClosed = partitionStreamingMarkdown(tildeClosedSource, { turnId: "t", settled: false });
  assert.deepEqual(tildeClosed.committedBlocks, [{
    id: `t:0-${"~~~~\ncode\n~~~~\n".length}`,
    kind: "markdown",
    source: "~~~~\ncode\n~~~~\n",
    renderMode: "markdown",
  }]);
  assert.deepEqual(tildeClosed.activeBlock, {
    id: `t:${"~~~~\ncode\n~~~~\n".length}-${tildeClosedSource.length}`,
    kind: "markdown",
    source: "Tail",
    renderMode: "markdown",
  });

  const tableOpen = partitionStreamingMarkdown("| A |\n| - |\n| 1 |", { turnId: "t", settled: false });
  assert.deepEqual(tableOpen.committedBlocks, []);
  assert.deepEqual(tableOpen.activeBlock, {
    id: `t:0-${"| A |\n| - |\n| 1 |".length}`,
    kind: "markdown",
    source: "| A |\n| - |\n| 1 |",
    renderMode: "plain",
  });

  const tableClosedSource = "| A |\n| - |\n| 1 |\n\nAfter";
  const tableClosed = partitionStreamingMarkdown(tableClosedSource, { turnId: "t", settled: false });
  assert.deepEqual(tableClosed.committedBlocks, [{
    id: `t:0-${"| A |\n| - |\n| 1 |\n\n".length}`,
    kind: "markdown",
    source: "| A |\n| - |\n| 1 |\n\n",
    renderMode: "markdown",
  }]);
  assert.deepEqual(tableClosed.activeBlock, {
    id: `t:${"| A |\n| - |\n| 1 |\n\n".length}-${tableClosedSource.length}`,
    kind: "markdown",
    source: "After",
    renderMode: "markdown",
  });
});

test("top-level lists stay stable containers with stable item ids", () => {
  const openListSource = "- one\n- tw";
  const openList = partitionStreamingMarkdown(openListSource, { turnId: "t", settled: false });
  assert.deepEqual(openList.committedBlocks, []);
  assert.deepEqual(openList.activeBlock, {
    id: "t:0-list",
    kind: "list",
    ordered: false,
    committedItems: [{ id: "t:0-item-0", source: "- one\n" }],
    activeItem: { id: "t:0-item-1", source: "- tw" },
    source: openListSource,
  });

  const laterListSource = "- one\n- two\n- three";
  const laterList = partitionStreamingMarkdown(laterListSource, { turnId: "t", settled: false });
  assert.deepEqual(laterList.activeBlock, {
    id: "t:0-list",
    kind: "list",
    ordered: false,
    committedItems: [
      { id: "t:0-item-0", source: "- one\n" },
      { id: "t:0-item-1", source: "- two\n" },
    ],
    activeItem: { id: "t:0-item-2", source: "- three" },
    source: laterListSource,
  });

  const orderedSource = "1. one\n2. tw";
  const ordered = partitionStreamingMarkdown(orderedSource, { turnId: "t", settled: false });
  assert.deepEqual(ordered.activeBlock, {
    id: "t:0-list",
    kind: "list",
    ordered: true,
    committedItems: [{ id: "t:0-item-0", source: "1. one\n" }],
    activeItem: { id: "t:0-item-1", source: "2. tw" },
    source: orderedSource,
  });
});

test("nested or ambiguous containers remain one active markdown block", () => {
  const source = "> Intro\n> - one\n> - two";
  const partition = partitionStreamingMarkdown(source, { turnId: "t", settled: false });
  assert.deepEqual(partition.committedBlocks, []);
  assert.deepEqual(partition.activeBlock, {
    id: `t:0-${source.length}`,
    kind: "markdown",
    source,
    renderMode: "plain",
  });
  assert.equal(partition.committedText, "");
});

test("settled output is exact, fully committed, and markdown-only", () => {
  const source = "# Heading\n\nParagraph\n\n- one\n- two\n\n```ts\nconst x = 1\n```";
  const partition = partitionStreamingMarkdown(source, { turnId: "t", settled: true });
  assert.equal(partition.activeBlock, null);
  assert.equal(partition.committedText, source);
  assert.equal(partition.committedBlocks.map((block) => block.source).join(""), source);
  assert.ok(partition.committedBlocks.every((block) => block.kind === "markdown"));
  assert.ok(
    partition.committedBlocks.every(
      (block) => block.kind !== "markdown" || block.renderMode === "markdown",
    ),
  );
});

test("committed block history never rewrites an earlier id/source pair", () => {
  const snapshots = [
    "Intro",
    "Intro\n\n- one\n- tw",
    "Intro\n\n- one\n- two\n\n```ts\nconst x = 1",
    "Intro\n\n- one\n- two\n\n```ts\nconst x = 1\n```\nAfter",
  ];

  const seen = new Map<string, string>();
  for (const snapshot of snapshots) {
    const partition = partitionStreamingMarkdown(snapshot, { turnId: "t", settled: false });
    for (const [id, source] of flattenPairs(partition.committedBlocks)) {
      if (seen.has(id)) {
        assert.equal(source, seen.get(id), `snapshot rewrote ${id}`);
      } else {
        seen.set(id, source);
      }
    }
  }

  assert.deepEqual([...seen.entries()], [
    ["t:0-7", "Intro\n\n"],
    ["t:7-list", "- one\n- two\n\n"],
    ["t:7-item-0", "- one\n"],
    ["t:7-item-1", "- two\n"],
    ["t:20-42", "```ts\nconst x = 1\n```\n"],
  ]);
});

test("scanner rules choose plain vs markdown render modes correctly", () => {
  const incompleteTable = partitionStreamingMarkdown("| A |\n| - |", { turnId: "t", settled: false });
  assert.equal(incompleteTable.activeBlock?.kind, "markdown");
  assert.equal(incompleteTable.activeBlock?.renderMode, "plain");

  const incompleteFence = partitionStreamingMarkdown("```\ncode", { turnId: "t", settled: false });
  assert.equal(incompleteFence.activeBlock?.kind, "markdown");
  assert.equal(incompleteFence.activeBlock?.renderMode, "plain");

  const indentedTail = partitionStreamingMarkdown("    code", { turnId: "t", settled: false });
  assert.deepEqual(indentedTail.activeBlock, {
    id: `t:0-${"    code".length}`,
    kind: "markdown",
    source: "    code",
    renderMode: "plain",
  });

  const ambiguousContainer = partitionStreamingMarkdown("> quote\ncontinuation", { turnId: "t", settled: false });
  assert.equal(ambiguousContainer.activeBlock?.kind, "markdown");
  assert.equal(ambiguousContainer.activeBlock?.renderMode, "plain");

  const safeParagraph = partitionStreamingMarkdown("Safe paragraph", { turnId: "t", settled: false });
  assert.equal(safeParagraph.activeBlock?.kind, "markdown");
  assert.equal(safeParagraph.activeBlock?.renderMode, "markdown");

  const safeHeading = partitionStreamingMarkdown("## Safe heading", { turnId: "t", settled: false });
  assert.equal(safeHeading.activeBlock?.kind, "markdown");
  assert.equal(safeHeading.activeBlock?.renderMode, "markdown");

  const settledAmbiguous = partitionStreamingMarkdown("> quote\n> tail", { turnId: "t", settled: true });
  assert.equal(settledAmbiguous.activeBlock, null);
  assert.ok(settledAmbiguous.committedBlocks.every((block) => block.kind === "markdown"));
  assert.ok(settledAmbiguous.committedBlocks.every((block) => block.kind !== "markdown" || block.renderMode === "markdown"));
});
