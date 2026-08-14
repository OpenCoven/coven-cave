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

test("spaced thematic breaks outrank list parsing and commit through their newline", () => {
  for (const marker of ["* * *\n", "- - -\n"] as const) {
    const source = `${marker}Tail`;
    const partition = partitionStreamingMarkdown(source, { turnId: "t", settled: false });

    assert.deepEqual(partition.committedBlocks, [{
      id: `t:0-${marker.length}`,
      kind: "markdown",
      source: marker,
      renderMode: "markdown",
    }]);
    assert.deepEqual(partition.activeBlock, {
      id: `t:${marker.length}-${source.length}`,
      kind: "markdown",
      source: "Tail",
      renderMode: "markdown",
    });
    assert.equal(partition.committedText, marker);
  }

  const starredList = partitionStreamingMarkdown("* item\n* tw", { turnId: "t", settled: false });
  assert.deepEqual(starredList.activeBlock, {
    id: "t:0-list",
    kind: "list",
    ordered: false,
    committedItems: [{ id: "t:0-item-0", source: "* item\n" }],
    activeItem: { id: "t:0-item-1", source: "* tw" },
    source: "* item\n* tw",
  });
});

test("top-level lists may start with one to three spaces and keep stable ids", () => {
  const unorderedSource = "Intro\n\n - one\n - two\n - thre";
  const unordered = partitionStreamingMarkdown(unorderedSource, { turnId: "t", settled: false });
  assert.deepEqual(unordered.committedBlocks, [{
    id: "t:0-7",
    kind: "markdown",
    source: "Intro\n\n",
    renderMode: "markdown",
  }]);
  assert.deepEqual(unordered.activeBlock, {
    id: "t:7-list",
    kind: "list",
    ordered: false,
    committedItems: [
      { id: "t:7-item-0", source: " - one\n" },
      { id: "t:7-item-1", source: " - two\n" },
    ],
    activeItem: { id: "t:7-item-2", source: " - thre" },
    source: " - one\n - two\n - thre",
  });

  const orderedSource = "Lead\n\n 1. one\n 2. two\n 3. thre";
  const ordered = partitionStreamingMarkdown(orderedSource, { turnId: "t", settled: false });
  assert.deepEqual(ordered.committedBlocks, [{
    id: "t:0-6",
    kind: "markdown",
    source: "Lead\n\n",
    renderMode: "markdown",
  }]);
  assert.deepEqual(ordered.activeBlock, {
    id: "t:6-list",
    kind: "list",
    ordered: true,
    committedItems: [
      { id: "t:6-item-0", source: " 1. one\n" },
      { id: "t:6-item-1", source: " 2. two\n" },
    ],
    activeItem: { id: "t:6-item-2", source: " 3. thre" },
    source: " 1. one\n 2. two\n 3. thre",
  });

  for (const source of ["    - item", "    1. item"] as const) {
    const partition = partitionStreamingMarkdown(source, { turnId: "t", settled: false });
    assert.deepEqual(partition.committedBlocks, []);
    assert.deepEqual(partition.activeBlock, {
      id: `t:0-${source.length}`,
      kind: "markdown",
      source,
      renderMode: "plain",
    });
  }
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

test("settled output is exact and preserves stable list identity", () => {
  const source = "# Heading\n\nParagraph\n\n- one\n- two\n\n```ts\nconst x = 1\n```";
  const partition = partitionStreamingMarkdown(source, { turnId: "t", settled: true });
  assert.equal(partition.activeBlock, null);
  assert.equal(partition.committedText, source);
  assert.equal(partition.committedBlocks.map((block) => block.source).join(""), source);
  assert.deepEqual(partition.committedBlocks, [
    {
      id: "t:0-10",
      kind: "markdown",
      source: "# Heading\n",
      renderMode: "markdown",
    },
    {
      id: "t:10-11",
      kind: "markdown",
      source: "\n",
      renderMode: "markdown",
    },
    {
      id: "t:11-22",
      kind: "markdown",
      source: "Paragraph\n\n",
      renderMode: "markdown",
    },
    {
      id: "t:22-list",
      kind: "list",
      ordered: false,
      committedItems: [
        { id: "t:22-item-0", source: "- one\n" },
        { id: "t:22-item-1", source: "- two\n" },
      ],
      source: "- one\n- two\n\n",
    },
    {
      id: "t:35-56",
      kind: "markdown",
      source: "```ts\nconst x = 1\n```",
      renderMode: "markdown",
    },
  ]);
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

test("unterminated whitespace tails do not terminate paragraphs", () => {
  const source = "A paragraph\n  ";
  const partition = partitionStreamingMarkdown(source, { turnId: "t", settled: false });

  assert.deepEqual(partition.committedBlocks, []);
  assert.deepEqual(partition.activeBlock, {
    id: `t:0-${source.length}`,
    kind: "markdown",
    source,
    renderMode: "markdown",
  });
  assert.equal(partition.committedText, "");
});

test("extra blank lines become separate stable blocks instead of rewriting prior blocks", () => {
  const first = partitionStreamingMarkdown("A\n\n", { turnId: "t", settled: false });
  assert.deepEqual(first.committedBlocks, [{
    id: "t:0-3",
    kind: "markdown",
    source: "A\n\n",
    renderMode: "markdown",
  }]);

  const secondSource = "A\n\n\n";
  const second = partitionStreamingMarkdown(secondSource, { turnId: "t", settled: false });
  assert.deepEqual(second.committedBlocks, [
    {
      id: "t:0-3",
      kind: "markdown",
      source: "A\n\n",
      renderMode: "markdown",
    },
    {
      id: "t:3-4",
      kind: "markdown",
      source: "\n",
      renderMode: "markdown",
    },
  ]);
  assert.equal(second.activeBlock, null);
  assert.equal(second.committedText, secondSource);
});

test("four-space thematic lookalikes stay indented code until terminated", () => {
  const source = "    ---";
  const partition = partitionStreamingMarkdown(source, { turnId: "t", settled: false });

  assert.deepEqual(partition.committedBlocks, []);
  assert.deepEqual(partition.activeBlock, {
    id: `t:0-${source.length}`,
    kind: "markdown",
    source,
    renderMode: "plain",
  });
});

test("table delimiter columns must match the header columns", () => {
  const source = "| A | B |\n| --- |\n| 1 | 2 |\n\n";
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

test("fence closing markers must match the opening marker character", () => {
  const backtickSource = "```ts\nconst x = 1\n~~~\n";
  const backtick = partitionStreamingMarkdown(backtickSource, { turnId: "t", settled: false });
  assert.deepEqual(backtick.committedBlocks, []);
  assert.deepEqual(backtick.activeBlock, {
    id: `t:0-${backtickSource.length}`,
    kind: "markdown",
    source: backtickSource,
    renderMode: "plain",
  });

  const tildeSource = "~~~\nconst x = 1\n```\n";
  const tilde = partitionStreamingMarkdown(tildeSource, { turnId: "t", settled: false });
  assert.deepEqual(tilde.committedBlocks, []);
  assert.deepEqual(tilde.activeBlock, {
    id: `t:0-${tildeSource.length}`,
    kind: "markdown",
    source: tildeSource,
    renderMode: "plain",
  });
});

test("settlement preserves stable list container and item ids", () => {
  for (const [source, ordered] of [
    ["- one\n- tw", false],
    ["1. one\n2. tw", true],
  ] as const) {
    const pending = partitionStreamingMarkdown(source, { turnId: "t", settled: false });
    assert.equal(pending.activeBlock?.kind, "list");

    const settled = partitionStreamingMarkdown(source, { turnId: "t", settled: true });
    assert.equal(settled.activeBlock, null);
    assert.equal(settled.committedText, source);
    assert.equal(settled.committedBlocks.map((block) => block.source).join(""), source);
    assert.deepEqual(settled.committedBlocks, [{
      id: "t:0-list",
      kind: "list",
      ordered,
      committedItems: [
        { id: "t:0-item-0", source: ordered ? "1. one\n" : "- one\n" },
        { id: "t:0-item-1", source: ordered ? "2. tw" : "- tw" },
      ],
      source,
    }]);
  }
});

test("incremental nested tails retain active list identity and committed siblings", () => {
  for (const [beforeSource, afterSource, committedSource, activeSource] of [
    ["- one\n- parent", "- one\n- parent\n  - child", "- one\n", "- parent\n  - child"],
    ["1. one\n2. parent", "1. one\n2. parent\n   1. child", "1. one\n", "2. parent\n   1. child"],
    ["  - one\n  - parent", "  - one\n  - parent\n    - child", "  - one\n", "  - parent\n    - child"],
    [" 1. one\n 2. parent", " 1. one\n 2. parent\n    1. child", " 1. one\n", " 2. parent\n    1. child"],
    ["- one\n- parent", "- one\n- parent\n  1. child", "- one\n", "- parent\n  1. child"],
    ["1. one\n2. parent", "1. one\n2. parent\n  - child", "1. one\n", "2. parent\n  - child"],
  ] as const) {
    const before = partitionStreamingMarkdown(beforeSource, { turnId: "t", settled: false });
    const after = partitionStreamingMarkdown(afterSource, { turnId: "t", settled: false });

    if (before.activeBlock?.kind !== "list" || after.activeBlock?.kind !== "list") {
      assert.fail("expected both snapshots to stay in the same active list container");
    }

    assert.equal(after.activeBlock.id, before.activeBlock.id);
    assert.deepEqual(before.activeBlock.committedItems, [{ id: "t:0-item-0", source: committedSource }]);
    assert.deepEqual(after.activeBlock.committedItems, before.activeBlock.committedItems);
    assert.deepEqual(after.activeBlock.activeItem, { id: "t:0-item-1", source: activeSource });
    assert.equal(after.activeBlock.source, afterSource);

    const settled = partitionStreamingMarkdown(afterSource, { turnId: "t", settled: true });
    assert.equal(settled.activeBlock, null);
    assert.equal(settled.committedText, afterSource);
    assert.equal(settled.committedBlocks.map((block) => block.source).join(""), afterSource);
  }
});

test("nested list markers stay ambiguous instead of committing sibling items", () => {
  for (const source of [
    "- parent\n  - child",
    " - parent\n   - child",
    "1. parent\n   1. child",
  ] as const) {
    const partition = partitionStreamingMarkdown(source, { turnId: "t", settled: false });
    assert.deepEqual(partition.committedBlocks, []);
    assert.deepEqual(partition.activeBlock, {
      id: `t:0-${source.length}`,
      kind: "markdown",
      source,
      renderMode: "plain",
    });
  }

  const siblingSource = "- one\n- two\n- thre";
  const sibling = partitionStreamingMarkdown(siblingSource, { turnId: "t", settled: false });
  assert.deepEqual(sibling.activeBlock, {
    id: "t:0-list",
    kind: "list",
    ordered: false,
    committedItems: [
      { id: "t:0-item-0", source: "- one\n" },
      { id: "t:0-item-1", source: "- two\n" },
    ],
    activeItem: { id: "t:0-item-2", source: "- thre" },
    source: siblingSource,
  });
});

test("committed pairs stay stable when a later list tail becomes nested ambiguity", () => {
  const before = partitionStreamingMarkdown("Intro\n\n- one\n- two\n\n- parent", { turnId: "t", settled: false });
  const afterSource = "Intro\n\n- one\n- two\n\n- parent\n  - child";
  const after = partitionStreamingMarkdown(afterSource, { turnId: "t", settled: false });

  assert.deepEqual(flattenPairs(before.committedBlocks), [
    ["t:0-7", "Intro\n\n"],
    ["t:7-list", "- one\n- two\n\n"],
    ["t:7-item-0", "- one\n"],
    ["t:7-item-1", "- two\n"],
  ]);
  assert.deepEqual(flattenPairs(after.committedBlocks), flattenPairs(before.committedBlocks));
  assert.deepEqual(after.activeBlock, {
    id: `t:${"Intro\n\n- one\n- two\n\n".length}-${afterSource.length}`,
    kind: "markdown",
    source: "- parent\n  - child",
    renderMode: "plain",
  });
});

test("backtick fences reject info strings containing backticks", () => {
  const invalidBacktick = "```bad`\ntext\n```\nTail";
  const invalid = partitionStreamingMarkdown(invalidBacktick, { turnId: "t", settled: false });
  assert.deepEqual(invalid.committedBlocks, []);
  assert.deepEqual(invalid.activeBlock, {
    id: `t:0-${invalidBacktick.length}`,
    kind: "markdown",
    source: invalidBacktick,
    renderMode: "plain",
  });

  const validTildeSource = "~~~bad`\ntext\n~~~\nTail";
  const validTilde = partitionStreamingMarkdown(validTildeSource, { turnId: "t", settled: false });
  assert.deepEqual(validTilde.committedBlocks, [{
    id: `t:0-${"~~~bad`\ntext\n~~~\n".length}`,
    kind: "markdown",
    source: "~~~bad`\ntext\n~~~\n",
    renderMode: "markdown",
  }]);
  assert.deepEqual(validTilde.activeBlock, {
    id: `t:${"~~~bad`\ntext\n~~~\n".length}-${validTildeSource.length}`,
    kind: "markdown",
    source: "Tail",
    renderMode: "markdown",
  });
});

test("table parsing honors escaped terminal pipe parity", () => {
  const oddParitySource = "| A | B \\|\n| --- | --- |\n| 1 | 2 \\|\n\nAfter";
  const oddParity = partitionStreamingMarkdown(oddParitySource, { turnId: "t", settled: false });
  assert.deepEqual(oddParity.committedBlocks, [{
    id: `t:0-${"| A | B \\|\n| --- | --- |\n| 1 | 2 \\|\n\n".length}`,
    kind: "markdown",
    source: "| A | B \\|\n| --- | --- |\n| 1 | 2 \\|\n\n",
    renderMode: "markdown",
  }]);
  assert.deepEqual(oddParity.activeBlock, {
    id: `t:${"| A | B \\|\n| --- | --- |\n| 1 | 2 \\|\n\n".length}-${oddParitySource.length}`,
    kind: "markdown",
    source: "After",
    renderMode: "markdown",
  });

  const evenParitySource = "| A | B \\\\|\n| --- | --- |\n| 1 | 2 \\\\|\n\nAfter";
  const evenParity = partitionStreamingMarkdown(evenParitySource, { turnId: "t", settled: false });
  assert.deepEqual(evenParity.committedBlocks, [{
    id: `t:0-${"| A | B \\\\|\n| --- | --- |\n| 1 | 2 \\\\|\n\n".length}`,
    kind: "markdown",
    source: "| A | B \\\\|\n| --- | --- |\n| 1 | 2 \\\\|\n\n",
    renderMode: "markdown",
  }]);
  assert.deepEqual(evenParity.activeBlock, {
    id: `t:${"| A | B \\\\|\n| --- | --- |\n| 1 | 2 \\\\|\n\n".length}-${evenParitySource.length}`,
    kind: "markdown",
    source: "After",
    renderMode: "markdown",
  });
});
