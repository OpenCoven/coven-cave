// Behavioral tests for streaming Markdown block partitioning (Task 2 of the
// calm-streaming-chat plan). Partitions a *complete accumulated snapshot* of
// streamed Markdown into stable committed blocks plus at most one trailing
// active block, so a renderer can keep committed blocks frozen (no
// re-render/flash) while only the active tail repaints as new bytes arrive.
//
// Every test calls partitionStreamingMarkdown with the FULL text seen so far
// (never a delta) — that is the contract under test.
import assert from "node:assert/strict";
import test from "node:test";
import {
  partitionStreamingMarkdown,
  type StreamingContentBlock,
  type StreamingListBlock,
  type StreamingMarkdownBlock,
} from "./streaming-markdown-blocks.ts";

const TURN = "t";

function md(block: StreamingContentBlock | null): StreamingMarkdownBlock {
  assert.ok(block, "expected a block");
  assert.equal(block.kind, "markdown");
  return block as StreamingMarkdownBlock;
}

function list(block: StreamingContentBlock | null): StreamingListBlock {
  assert.ok(block, "expected a block");
  assert.equal(block.kind, "list");
  return block as StreamingListBlock;
}

function sourcesOf(blocks: StreamingContentBlock[]): string {
  return blocks.map((b) => b.source).join("");
}

function assertExactCoverage(
  result: ReturnType<typeof partitionStreamingMarkdown>,
  source: string,
): void {
  const blocks = result.activeBlock
    ? [...result.committedBlocks, result.activeBlock]
    : result.committedBlocks;
  assert.equal(sourcesOf(blocks), source);
  for (const block of blocks) {
    if (block.kind !== "list") continue;
    const items = block.activeItem
      ? [...block.committedItems, block.activeItem]
      : block.committedItems;
    assert.equal(
      items.map((item) => item.source).join(""),
      block.source,
      `list items do not exactly cover ${JSON.stringify(block.source)}`,
    );
  }
}

function committedPairs(
  result: ReturnType<typeof partitionStreamingMarkdown>,
): Map<string, string> {
  const pairs = new Map<string, string>();
  const addItems = (block: StreamingListBlock) => {
    for (const item of block.committedItems) pairs.set(item.id, item.source);
  };

  for (const block of result.committedBlocks) {
    pairs.set(block.id, block.source);
    if (block.kind === "list") addItems(block);
  }
  if (result.activeBlock?.kind === "list") addItems(result.activeBlock);
  return pairs;
}

function assertCommittedFrameHistory(frames: string[]): void {
  const seen = new Map<string, string>();
  for (const frame of frames) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    const current = committedPairs(result);
    for (const [id, source] of seen) {
      assert.equal(
        current.get(id),
        source,
        `committed pair ${id} disappeared or changed at ${JSON.stringify(frame)}`,
      );
    }
    for (const [id, source] of current) seen.set(id, source);
  }
}

function characterFrames(source: string): string[] {
  return Array.from({ length: source.length }, (_, index) => source.slice(0, index + 1));
}

// ── empty source ─────────────────────────────────────────────────────────

test("empty source: no blocks, null active, empty committedText", () => {
  const result = partitionStreamingMarkdown("", { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  assert.equal(result.activeBlock, null);
  assert.equal(result.committedText, "");
});

// ── paragraph ────────────────────────────────────────────────────────────

test("paragraph: growing single paragraph is the active block", () => {
  const result = partitionStreamingMarkdown("A paragraph", { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  assert.equal(result.committedText, "");
  const active = md(result.activeBlock);
  assert.equal(active.source, "A paragraph");
  assert.equal(active.renderMode, "markdown");
  assert.equal(active.id, `${TURN}:0-active`);
});

test("paragraph: safe active prose uses markdown while structural prefixes stay plain", () => {
  for (const source of ["Plain prose", "Plain prose\n", "Plain prose\ncontinued"]) {
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assert.equal(md(result.activeBlock).renderMode, "markdown");
  }

  for (const source of [
    "Plain prose\n#",
    "Plain prose\n``",
    "Plain prose\n-",
    "Plain prose\n_ _",
    "Plain prose\n1.",
    "| possible | header |",
  ]) {
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assert.equal(md(result.activeBlock).renderMode, "plain");
  }
});

test("paragraph: blank line commits the paragraph exactly, leaves next word active", () => {
  const source = "A paragraph\n\nNext";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 1);
  const committed = md(result.committedBlocks[0]);
  assert.equal(committed.source, "A paragraph\n\n");
  assert.equal(committed.id, `${TURN}:0-13`);
  assert.equal(committed.renderMode, "markdown");
  assert.equal(result.committedText, "A paragraph\n\n");
  const active = md(result.activeBlock);
  assert.equal(active.source, "Next");
  assert.equal(active.id, `${TURN}:13-active`);
  assert.equal(sourcesOf([...result.committedBlocks, result.activeBlock!]), source);
});

test("markdown ids: growing active paragraph keeps its start identity then finalizes its range", () => {
  const headingSource = "# H\n";
  const frames = [
    `${headingSource}T`,
    `${headingSource}Tail`,
    `${headingSource}Tail grows`,
  ];
  const headingId = `${TURN}:0-${headingSource.length}`;

  for (const frame of frames) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.equal(result.committedBlocks[0]?.id, headingId);
    assert.equal(md(result.activeBlock).id, `${TURN}:${headingSource.length}-active`);
  }

  const committedSource = "Tail grows\n\n";
  const committed = partitionStreamingMarkdown(`${headingSource}${committedSource}`, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(
    committed.committedBlocks.map((block) => [block.id, block.source]),
    [
      [headingId, headingSource],
      [
        `${TURN}:${headingSource.length}-${headingSource.length + committedSource.length}`,
        committedSource,
      ],
    ],
  );
  assert.equal(committed.activeBlock, null);
});

test("markdown ids: growing fences and tables keep one active identity until commitment", () => {
  const cases = [
    {
      frames: ["```", "```ts\n", "```ts\ncode"],
      committedSource: "```ts\ncode\n```\n",
    },
    {
      frames: ["| h |", "| h |\n| --- |\n", "| h |\n| --- |\n| body |"],
      committedSource: "| h |\n| --- |\n| body |\n\n",
    },
  ];

  for (const { frames, committedSource } of cases) {
    for (const frame of frames) {
      const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
      assert.equal(md(result.activeBlock).id, `${TURN}:0-active`);
    }

    const committed = partitionStreamingMarkdown(committedSource, {
      turnId: TURN,
      settled: false,
    });
    assert.equal(committed.activeBlock, null);
    assert.equal(md(committed.committedBlocks[0]).id, `${TURN}:0-${committedSource.length}`);
  }
});

test("markdown ids: ambiguous active tails keep their start identity and finalize on settlement", () => {
  for (const frame of ["Prose\n#", "Prose\n##"]) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.equal(md(result.activeBlock).id, `${TURN}:0-active`);
  }

  const source = "Prose\n##";
  const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
  assert.equal(settled.activeBlock, null);
  assert.equal(md(settled.committedBlocks[0]).id, `${TURN}:0-${source.length}`);
});

test("heading: commits through its terminating newline, leaves tail active", () => {
  const source = "# Heading\nTail";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 1);
  const heading = md(result.committedBlocks[0]);
  assert.equal(heading.source, "# Heading\n");
  assert.equal(heading.renderMode, "markdown");
  const active = md(result.activeBlock);
  assert.equal(active.source, "Tail");
  assert.equal(sourcesOf([...result.committedBlocks, result.activeBlock!]), source);
});

test("paragraph: unmistakable heading interrupts at the preceding newline", () => {
  const source = "Prose\n# Heading\nTail";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(
    result.committedBlocks.map((block) => block.source),
    ["Prose\n", "# Heading\n"],
  );
  assert.equal(md(result.activeBlock).source, "Tail");
  assert.equal(sourcesOf([...result.committedBlocks, result.activeBlock!]), source);
});

test("paragraph: an incomplete fence interrupts as its own active plain block", () => {
  const source = "Prose\n```ts\nconst x = 1\n";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), ["Prose\n"]);
  const active = md(result.activeBlock);
  assert.equal(active.source, "```ts\nconst x = 1\n");
  assert.equal(active.renderMode, "plain");
  assert.equal(sourcesOf([...result.committedBlocks, active]), source);
});

test("paragraph: a top-level list interrupts as its own active container", () => {
  const source = "Prose\n- item";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), ["Prose\n"]);
  const active = list(result.activeBlock);
  assert.equal(active.source, "- item");
  assert.equal(sourcesOf([...result.committedBlocks, active]), source);
});

test("paragraph: only eligible nonblank list items interrupt", () => {
  for (const [source, renderMode] of [
    ["Paragraph\n2. item", "markdown"],
    ["Paragraph\n-", "plain"],
    ["Paragraph\n- ", "plain"],
    ["Paragraph\n+ \n", "markdown"],
    ["Paragraph\n1. \n", "markdown"],
  ] as const) {
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assert.equal(md(result.activeBlock).renderMode, renderMode);
    assertExactCoverage(result, source);
  }

  for (const source of ["Paragraph\n1. item", "Paragraph\n- item"]) {
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks.map((block) => block.source), ["Paragraph\n"]);
    assert.equal(list(result.activeBlock).source, source.slice("Paragraph\n".length));
    assertExactCoverage(result, source);
  }
});

test("paragraph: list-marker precedence excludes pipe-bearing lines from table lookahead", () => {
  const cases = [
    {
      source: "Paragraph\n2. | h |\n| --- |\n| body |",
      expectedKind: "markdown",
    },
    {
      source: "Paragraph\n1. | h |\n| --- |\n| body |",
      expectedKind: "list",
    },
    {
      source: "Paragraph\n- | h |\n| --- |\n| body |",
      expectedKind: "list",
    },
  ] as const;

  for (const { source, expectedKind } of cases) {
    const frames = characterFrames(source);
    assertCommittedFrameHistory(frames);
    for (const frame of frames) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }

    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    if (expectedKind === "markdown") {
      assert.deepEqual(result.committedBlocks, []);
      assert.equal(md(result.activeBlock).source, source);
      assert.equal(md(result.activeBlock).renderMode, "plain");
      continue;
    }

    assert.deepEqual(result.committedBlocks.map((block) => block.source), ["Paragraph\n"]);
    assert.equal(list(result.activeBlock).source, source.slice("Paragraph\n".length));
  }
});

test("paragraph: ordered interruption waits for irreversible nonblank item content", () => {
  const frames = [
    "Paragraph\n1",
    "Paragraph\n1.",
    "Paragraph\n1. ",
    "Paragraph\n1. i",
    "Paragraph\n1. item",
  ];

  assertCommittedFrameHistory(frames);
  for (const frame of frames.slice(0, 3)) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, frame);
  }

  for (const frame of frames.slice(3)) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks.map((block) => block.source), ["Paragraph\n"]);
    assert.equal(list(result.activeBlock).source, frame.slice("Paragraph\n".length));
  }
});

test("list: ordered blocks may start at any supported number at a block boundary", () => {
  const source = "2. item";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  assert.equal(list(result.activeBlock).source, source);
  assert.equal(list(result.activeBlock).ordered, true);
  assert.equal(list(result.activeBlock).start, 2);
});

test("paragraph: incomplete ambiguous starters do not mint revocable commits", () => {
  for (const source of ["Prose\n#", "Prose\n---", "Prose\n| h |\n| - |"]) {
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assert.equal(md(result.activeBlock).renderMode, "plain");
  }
});

test("paragraph: a bodyless table candidate cannot commit preceding prose", () => {
  const source = "Prose\n| h |\n| --- |\n";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, source);
  assert.equal(md(result.activeBlock).renderMode, "plain");
});

test("list: incomplete ambiguous following starter does not commit the container", () => {
  const source = "- one\n#";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, source);
  assert.equal(md(result.activeBlock).renderMode, "plain");
});

// ── fenced code ──────────────────────────────────────────────────────────

test("fence: unclosed fence is one active plain block", () => {
  const source = "```ts\nconst x = 1\n";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = md(result.activeBlock);
  assert.equal(active.source, source);
  assert.equal(active.renderMode, "plain");
});

test("fence: closed fence commits through its closing newline", () => {
  const source = "```ts\nconst x = 1\n```\nAfter";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 1);
  const fence = md(result.committedBlocks[0]);
  assert.equal(fence.source, "```ts\nconst x = 1\n```\n");
  assert.equal(fence.renderMode, "markdown");
  const active = md(result.activeBlock);
  assert.equal(active.source, "After");
  assert.equal(sourcesOf([...result.committedBlocks, result.activeBlock!]), source);
});

test("fence: tilde fence closes with matching tilde marker", () => {
  const source = "~~~ts\nconst x = 1\n~~~\nAfter";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const fence = md(result.committedBlocks[0]);
  assert.equal(fence.source, "~~~ts\nconst x = 1\n~~~\n");
  assert.equal(fence.renderMode, "markdown");
});

test("fence: mismatched closer char (backtick opener, tilde closer) never closes", () => {
  const source = "```ts\nconst x = 1\n~~~\n";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = md(result.activeBlock);
  assert.equal(active.source, source);
  assert.equal(active.renderMode, "plain");
});

test("fence: a shorter closer (fewer backticks than opener) does not close", () => {
  const source = "````ts\ncode\n```\nmore\n````\nAfter";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 1);
  const fence = md(result.committedBlocks[0]);
  assert.equal(fence.source, "````ts\ncode\n```\nmore\n````\n");
  assert.equal(fence.renderMode, "markdown");
});

test("fence: a wider closer (more backticks than opener) does close", () => {
  const source = "```ts\ncode\n````\nAfter";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const fence = md(result.committedBlocks[0]);
  assert.equal(fence.source, "```ts\ncode\n````\n");
});

for (const marker of ["`", "~"] as const) {
  for (const closerWidth of [3, 4, 5]) {
    test(`fence: ${marker} opener width 4 with closer width ${closerWidth}`, () => {
      const opener = marker.repeat(4);
      const closer = marker.repeat(closerWidth);
      const source = `${opener}ts\ncode\n${closer}\nAfter`;
      const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

      if (closerWidth < 4) {
        assert.deepEqual(result.committedBlocks, []);
        const active = md(result.activeBlock);
        assert.equal(active.source, source);
        assert.equal(active.renderMode, "plain");
        return;
      }

      assert.equal(md(result.committedBlocks[0]).source, `${opener}ts\ncode\n${closer}\n`);
      assert.equal(md(result.activeBlock).source, "After");
    });
  }
}

test("fence: a matching closer with no trailing newline yet stays active (streaming)", () => {
  const source = "```ts\nconst x = 1\n```";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = md(result.activeBlock);
  assert.equal(active.source, source);
  assert.equal(active.renderMode, "plain");
});

test("fence: a matching closer with no trailing newline commits verbatim at settlement", () => {
  const source = "```ts\nconst x = 1\n```";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
  assert.equal(result.activeBlock, null);
  assert.equal(result.committedBlocks.length, 1);
  const fence = md(result.committedBlocks[0]);
  assert.equal(fence.source, source);
  assert.equal(fence.renderMode, "markdown");
  assert.equal(result.committedText, source);
});

test("fence: a backtick in a backtick opener info string rejects the opener", () => {
  const source = "```a`b\nTail";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, source);
  assert.equal(md(result.activeBlock).renderMode, "markdown");
  assertExactCoverage(result, source);
});

test("fence: an unterminated backtick opener cannot commit a paragraph before its info is valid", () => {
  const source = "Before\n```lang`invalid\nTail";
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  for (const frame of frames.slice("Before\n```".length - 1)) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.deepEqual(
      result.committedBlocks,
      [],
      `premature commit at ${JSON.stringify(frame)}`,
    );
    assert.equal(md(result.activeBlock).source, frame);
    assertExactCoverage(result, frame);
  }
});

test("fence: valid backtick and tilde openers retain their existing behavior", () => {
  const backtick = partitionStreamingMarkdown("Before\n```ts\ncode", {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(backtick.committedBlocks.map((block) => block.source), ["Before\n"]);
  assert.equal(md(backtick.activeBlock).source, "```ts\ncode");
  assert.equal(md(backtick.activeBlock).renderMode, "plain");

  const tildeSource = "Before\n~~~a`b\ncode\n~~~\nTail";
  const tilde = partitionStreamingMarkdown(tildeSource, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(tilde.committedBlocks.map((block) => block.source), [
    "Before\n",
    "~~~a`b\ncode\n~~~\n",
  ]);
  assert.equal(md(tilde.activeBlock).source, "Tail");
  assertExactCoverage(tilde, tildeSource);
});

// ── HTML blocks ──────────────────────────────────────────────────────────

for (const tag of ["script", "pre", "style", "textarea"] as const) {
  test(`HTML: ${tag} blocks stay active across blanks and close on their matching tag`, () => {
    const open = `<${tag}>\r\nfirst\r\n\r\nsecond`;
    const streaming = partitionStreamingMarkdown(open, { turnId: TURN, settled: false });
    assert.deepEqual(streaming.committedBlocks, []);
    assert.equal(md(streaming.activeBlock).source, open);
    assert.equal(md(streaming.activeBlock).renderMode, "plain");

    const html = `${open}\r\n</${tag}> trailing\r\n`;
    const source = `${html}After`;
    const closed = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(closed.committedBlocks.map((block) => block.source), [html]);
    assert.equal(md(closed.committedBlocks[0]).renderMode, "markdown");
    assert.equal(md(closed.activeBlock).source, "After");
    assertExactCoverage(closed, source);
  });
}

for (const [name, opener, closer] of [
  ["comment", "<!--", "-->"],
  ["processing instruction", "<?target", "?>"],
  ["CDATA", "<![CDATA[", "]]>"],
] as const) {
  test(`HTML: ${name} blocks require their explicit terminator`, () => {
    const open = `${opener}\nfirst\n\nsecond`;
    const streaming = partitionStreamingMarkdown(open, { turnId: TURN, settled: false });
    assert.deepEqual(streaming.committedBlocks, []);
    assert.equal(md(streaming.activeBlock).source, open);
    assert.equal(md(streaming.activeBlock).renderMode, "plain");

    const html = `${open}\n${closer} trailing\n`;
    const source = `${html}After`;
    const closed = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(closed.committedBlocks.map((block) => block.source), [html]);
    assert.equal(md(closed.activeBlock).source, "After");
    assertExactCoverage(closed, source);
  });
}

test("HTML: declarations terminate at the first closing angle bracket", () => {
  const html = "<!DOCTYPE html>\r\n";
  const source = `${html}After`;
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks.map((block) => block.source), [html]);
  assert.equal(md(result.committedBlocks[0]).renderMode, "markdown");
  assert.equal(md(result.activeBlock).source, "After");
  assertExactCoverage(result, source);
});

for (const opener of ["<div class=\"shell\">", "</section>"] as const) {
  test(`HTML: common block tag ${JSON.stringify(opener)} ends at a blank line`, () => {
    const html = `${opener}\r\ninside\r\n\r\n`;
    const source = `${html}After`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks.map((block) => block.source), [html]);
    assert.equal(md(result.committedBlocks[0]).renderMode, "markdown");
    assert.equal(md(result.activeBlock).source, "After");
    assertExactCoverage(result, source);
  });
}

test("HTML: supported block tags interrupt paragraphs while indented and custom tags do not", () => {
  const blockHtml = "Paragraph\n<div>\ninside\n\nAfter";
  const blockResult = partitionStreamingMarkdown(blockHtml, { turnId: TURN, settled: false });
  assert.deepEqual(blockResult.committedBlocks.map((block) => block.source), [
    "Paragraph\n",
    "<div>\ninside\n\n",
  ]);
  assert.equal(md(blockResult.activeBlock).source, "After");
  assertExactCoverage(blockResult, blockHtml);

  const indented = " \t<script>\ninside\n</script>\n\nAfter";
  const indentedResult = partitionStreamingMarkdown(indented, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(indentedResult.committedBlocks.map((block) => block.source), [
    " \t<script>\ninside\n</script>\n\n",
  ]);
  assert.equal(md(indentedResult.activeBlock).source, "After");
  assertExactCoverage(indentedResult, indented);

  const custom = "Paragraph\n<widget>\ninside\n\nAfter";
  const customResult = partitionStreamingMarkdown(custom, { turnId: TURN, settled: false });
  assert.deepEqual(customResult.committedBlocks.map((block) => block.source), [
    "Paragraph\n<widget>\ninside\n\n",
  ]);
  assert.equal(md(customResult.activeBlock).source, "After");
  assertExactCoverage(customResult, custom);
});

test("HTML: explicit terminators without a newline remain active until settlement", () => {
  const source = "<!-- complete -->";
  const streaming = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(streaming.committedBlocks, []);
  assert.equal(md(streaming.activeBlock).source, source);
  assert.equal(md(streaming.activeBlock).renderMode, "plain");

  const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
  assert.equal(settled.activeBlock, null);
  assert.deepEqual(settled.committedBlocks.map((block) => block.source), [source]);
  assert.equal(md(settled.committedBlocks[0]).renderMode, "markdown");
});

test("HTML: literal brackets and backticks cannot leak into reference analysis", () => {
  const html = "<div>\n` [inside]\n\n";
  const dependent = "[outside]\n\n[outside]: /url";
  const source = `${html}${dependent}`;
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks.map((block) => block.source), [html]);
  assert.equal(md(result.activeBlock).source, dependent);
  assertExactCoverage(result, source);
});

test("HTML: character-prefix growth never revokes a committed source/id pair", () => {
  const source = "Paragraph\n<script>\nfirst\n\nsecond\n</script>\nAfter";
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  for (const frame of frames) {
    assertExactCoverage(
      partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      frame,
    );
  }

  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), [
    "Paragraph\n",
    "<script>\nfirst\n\nsecond\n</script>\n",
  ]);
  assert.equal(md(result.activeBlock).source, "After");
});

// ── table ────────────────────────────────────────────────────────────────

test("table: header + delimiter with no body row yet stays one active plain block", () => {
  const source = "| a | b |\n| - | - |\n";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = md(result.activeBlock);
  assert.equal(active.source, source);
  assert.equal(active.renderMode, "plain");
});

test("table: header + delimiter + body row stays active until the blank terminator", () => {
  const source = "| a | b |\n| - | - |\n| 1 | 2 |\n";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = md(result.activeBlock);
  assert.equal(active.source, source);
  assert.equal(active.renderMode, "plain");
});

test("table: blank terminator after a body row commits the exact table", () => {
  const source = "| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 1);
  const table = md(result.committedBlocks[0]);
  assert.equal(table.source, "| a | b |\n| - | - |\n| 1 | 2 |\n\n");
  assert.equal(table.renderMode, "markdown");
  const active = md(result.activeBlock);
  assert.equal(active.source, "After");
  assert.equal(sourcesOf([...result.committedBlocks, result.activeBlock!]), source);
});

test("table: bodyless header and delimiter stay one active plain tail across a blank", () => {
  const source = "| a | b |\n| - | - |\n\n";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = md(result.activeBlock);
  assert.equal(active.source, source);
  assert.equal(active.renderMode, "plain");
});

test("table: header and delimiter must have the same syntactic cell count", () => {
  for (const source of [
    "Before\n| a | b |\n| --- |\n| one |\n",
    "Before\n| a \\| b | c |\n| --- | --- | --- |\n| one | two | three |\n",
    "Before\n| `a|b` | c |\n| --- | --- | --- |\n| one | two | three |\n",
  ]) {
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(
      result.committedBlocks,
      [],
      `mismatched table interrupted its paragraph for ${JSON.stringify(source)}`,
    );
    assert.equal(md(result.activeBlock).source, source);
    assert.equal(md(result.activeBlock).renderMode, "plain");
    assertExactCoverage(result, source);
    assertCommittedFrameHistory(characterFrames(source));
  }
});

test("table: escaped and code-span pipes do not add cells", () => {
  for (const header of [
    "| a \\| b | c |",
    "| `a|b` | c |",
    "| ``a`|b`` | c |",
    "| `a|b\\` | c |",
  ]) {
    const table = `${header}\n| :--- | ---: |\n| one | two |\n\n`;
    const prefix = "Before\n";
    const source = `${prefix}${table}After`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix, table]);
    assert.equal(md(result.committedBlocks[1]).renderMode, "markdown");
    assert.equal(md(result.activeBlock).source, "After");
    assertExactCoverage(result, source);
    assertCommittedFrameHistory(characterFrames(source));
  }
});

test("table lookahead: the reported unmatched body backtick never revokes a prose commit", () => {
  const prefix = "Prose\n| h |\n| --- |\n";
  const frames = [
    `${prefix}\`foo |`,
    `${prefix}\`foo |\``,
    `${prefix}\`foo |\`\n`,
    `${prefix}\`foo |\`\n\n`,
  ];

  for (const frame of frames) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.deepEqual(
      result.committedBlocks,
      [],
      `code-only body pipe provided table proof at ${JSON.stringify(frame)}`,
    );
    assert.equal(md(result.activeBlock).source, frame);
    assertExactCoverage(result, frame);
  }
  assertCommittedFrameHistory(frames);
});

for (const [name, bodyRow, provesTable] of [
  ["paired single backticks", "`code |` | body", true],
  ["paired double backticks", "``code |`` | body", true],
  ["unpaired single backtick", "`code | body", false],
  ["unpaired double backticks", "``code | body", false],
  ["escaped pipe plus outside separator", "escaped \\| text | body", true],
  ["escaped pipe only", "escaped \\| body", false],
] as const) {
  test(`table lookahead: ${name} waits for a terminated body row`, () => {
    const prose = "Prose\n";
    const tablePrefix = "| h |\n| --- |\n";
    const appendable = `${prose}${tablePrefix}${bodyRow}`;
    const terminated = `${appendable}\n`;
    const blankTerminated = `${terminated}\n`;
    const frames = [...characterFrames(appendable), terminated, blankTerminated];

    for (const frame of characterFrames(appendable)) {
      const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
      assert.deepEqual(
        result.committedBlocks,
        [],
        `appendable body row provided table proof at ${JSON.stringify(frame)}`,
      );
      assertExactCoverage(result, frame);
    }

    const withBodyNewline = partitionStreamingMarkdown(terminated, {
      turnId: TURN,
      settled: false,
    });
    if (provesTable) {
      assert.deepEqual(withBodyNewline.committedBlocks.map((block) => block.source), [prose]);
      assert.equal(md(withBodyNewline.activeBlock).source, `${tablePrefix}${bodyRow}\n`);
      assert.equal(md(withBodyNewline.activeBlock).renderMode, "plain");

      const complete = partitionStreamingMarkdown(blankTerminated, {
        turnId: TURN,
        settled: false,
      });
      assert.deepEqual(complete.committedBlocks.map((block) => block.source), [
        prose,
        `${tablePrefix}${bodyRow}\n\n`,
      ]);
      assert.equal(complete.activeBlock, null);
    } else {
      assert.deepEqual(withBodyNewline.committedBlocks, []);
      assert.equal(md(withBodyNewline.activeBlock).source, terminated);
      const complete = partitionStreamingMarkdown(blankTerminated, {
        turnId: TURN,
        settled: false,
      });
      assert.deepEqual(complete.committedBlocks, []);
      assert.equal(md(complete.activeBlock).source, blankTerminated);
    }

    assertCommittedFrameHistory(frames);
  });
}

test("list table lookahead: body proof waits for LF before committing the list", () => {
  const listSource = "- item\n";
  const tablePrefix = "| h |\n---\n";
  const bodyRow = "`code |` | body";
  const appendable = `${listSource}${tablePrefix}${bodyRow}`;
  const terminated = `${appendable}\n`;
  const complete = `${terminated}\n`;
  const frames = [...characterFrames(appendable), terminated, complete];

  for (const frame of characterFrames(appendable)) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.deepEqual(
      result.committedBlocks,
      [],
      `appendable body row committed the list at ${JSON.stringify(frame)}`,
    );
    assertExactCoverage(result, frame);
  }

  const withBodyNewline = partitionStreamingMarkdown(terminated, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(withBodyNewline.committedBlocks.map((block) => block.source), [listSource]);
  assert.equal(md(withBodyNewline.activeBlock).source, `${tablePrefix}${bodyRow}\n`);

  const blankTerminated = partitionStreamingMarkdown(complete, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(blankTerminated.committedBlocks.map((block) => block.source), [
    listSource,
    `${tablePrefix}${bodyRow}\n\n`,
  ]);
  assert.equal(blankTerminated.activeBlock, null);
  assertCommittedFrameHistory(frames);
});

test("paragraph table lookahead: CRLF terminates body proof without terminating the table", () => {
  const prose = "Prose\r\n";
  const tablePrefix = "| h |\r\n| --- |\r\n";
  const bodyRow = "left | right";
  const appendable = `${prose}${tablePrefix}${bodyRow}`;
  const bodyTerminated = `${appendable}\r\n`;
  const tableTerminated = `${bodyTerminated}\r\n`;

  const growing = partitionStreamingMarkdown(appendable, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(growing.committedBlocks, []);
  assert.equal(md(growing.activeBlock).source, appendable);

  const proven = partitionStreamingMarkdown(bodyTerminated, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(proven.committedBlocks.map((block) => block.source), [prose]);
  assert.equal(md(proven.activeBlock).source, `${tablePrefix}${bodyRow}\r\n`);
  assert.equal(md(proven.activeBlock).renderMode, "plain");

  const complete = partitionStreamingMarkdown(tableTerminated, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(complete.committedBlocks.map((block) => block.source), [
    prose,
    `${tablePrefix}${bodyRow}\r\n\r\n`,
  ]);
  assert.equal(complete.activeBlock, null);
  assertCommittedFrameHistory([
    ...characterFrames(appendable),
    bodyTerminated,
    tableTerminated,
  ]);
});

for (const indent of ["    ", "\t"]) {
  test(`table: ${JSON.stringify(indent)}-indented delimiter remains paragraph continuation across character history`, () => {
    const source = `| A |\n${indent}| --- |`;
    const frames = Array.from({ length: source.length }, (_, index) => source.slice(0, index + 1));

    assertCommittedFrameHistory(frames);

    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assert.equal(md(result.activeBlock).renderMode, "plain");
  });
}

test("table: an ordinary top-level table remains stable across character history", () => {
  const source = "| A |\n| --- |\n| one |\n\nAfter";
  const frames = Array.from({ length: source.length }, (_, index) => source.slice(0, index + 1));

  assertCommittedFrameHistory(frames);

  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), [
    "| A |\n| --- |\n| one |\n\n",
  ]);
  assert.equal(md(result.activeBlock).source, "After");
});

test("table: proven container starters cannot become headers", () => {
  const blockquote = "> | h |\n---\n| body |\n\nAfter";
  const quoted = partitionStreamingMarkdown(blockquote, { turnId: TURN, settled: false });
  assert.deepEqual(quoted.committedBlocks, []);
  assert.equal(md(quoted.activeBlock).source, blockquote);

  const heading = "# | h |\n---\n| body |\n\nAfter";
  const headed = partitionStreamingMarkdown(heading, { turnId: TURN, settled: false });
  assert.deepEqual(headed.committedBlocks.map((block) => block.source), [
    "# | h |\n",
    "---\n",
    "| body |\n\n",
  ]);
  assert.equal(md(headed.activeBlock).source, "After");

  const fence = "``` | h |\n---\n| body |\n\nAfter";
  const fenced = partitionStreamingMarkdown(fence, { turnId: TURN, settled: false });
  assert.deepEqual(fenced.committedBlocks, []);
  assert.equal(md(fenced.activeBlock).source, fence);

  const indented = "    | h |\n---\n| body |\n\nAfter";
  const code = partitionStreamingMarkdown(indented, { turnId: TURN, settled: false });
  assert.deepEqual(code.committedBlocks.map((block) => block.source), [
    "    | h |\n---\n| body |\n\n",
  ]);
  assert.equal(md(code.activeBlock).source, "After");

  const ordinary = "| h |\n---\n| body |\n\n";
  const result = partitionStreamingMarkdown(ordinary, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), [ordinary]);
  assert.equal(result.activeBlock, null);
});

test("table: an embedded pipe-less thematic delimiter yields to Setext ownership", () => {
  const heading = "Prose\n| A |\n---\n";
  const source = `${heading}| body |\n\n`;

  assertCommittedFrameHistory(characterFrames(source));
  for (const frame of characterFrames(source)) {
    assertExactCoverage(
      partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      frame,
    );
  }

  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), [
    heading,
    "| body |\n\n",
  ]);
  assert.equal(md(result.committedBlocks[0]).renderMode, "markdown");
  assert.equal(result.activeBlock, null);
});

test("table: an embedded pipe-less alignment delimiter remains paragraph-owned", () => {
  const source = "Prose\n| A |\n:---:\n| body |\n\n";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks.map((block) => block.source), [source]);
  assert.equal(result.activeBlock, null);
  assertExactCoverage(result, source);
  assertCommittedFrameHistory(characterFrames(source));
});

test("table: document and blank boundaries still admit pipe-less one-column tables", () => {
  const table = "| A |\n---\n| body |\n\n";
  const atDocumentStart = partitionStreamingMarkdown(table, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(atDocumentStart.committedBlocks.map((block) => block.source), [table]);
  assert.equal(atDocumentStart.activeBlock, null);

  const prefix = "Prose\n\n";
  const afterBlank = partitionStreamingMarkdown(`${prefix}${table}`, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(afterBlank.committedBlocks.map((block) => block.source), [
    prefix,
    table,
  ]);
  assert.equal(afterBlank.activeBlock, null);
  assertExactCoverage(afterBlank, `${prefix}${table}`);
});

test("table: an embedded pipe-delimited table keeps table precedence", () => {
  const prefix = "Prose\n";
  const table = "| A |\n| --- |\n| body |\n\n";
  const source = `${prefix}${table}`;
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix, table]);
  assert.equal(result.activeBlock, null);
  assertExactCoverage(result, source);
});

for (const [name, header, delimiter, bodyRow] of [
  ["one-column thematic form", "| A |", "---", "| body |"],
  ["pipe-delimited form", "| A |", "| --- |", "| body |"],
  ["one-column alignment form", "| A |", ":---:", "| body |"],
  ["pipe-delimited alignments", "| A | B |", "| :--- | ---: |", "| one | two |"],
] as const) {
  test(`table frame history: ${name} commits only after body proof and a blank`, () => {
    const body = `${header}\n${delimiter}\n${bodyRow}\n`;
    const complete = `${body}\n`;
    const frames = Array.from(
      { length: complete.length },
      (_, index) => complete.slice(0, index + 1),
    );

    for (const frame of frames.slice(0, -1)) {
      const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
      assert.deepEqual(
        result.committedBlocks,
        [],
        `committed before the terminating blank at ${JSON.stringify(frame)}`,
      );
      assert.equal(md(result.activeBlock).source, frame);
      assert.equal(md(result.activeBlock).renderMode, "plain");
    }

    const committed = partitionStreamingMarkdown(complete, { turnId: TURN, settled: false });
    assert.deepEqual(committed.committedBlocks.map((block) => block.source), [complete]);
    assert.equal(committed.activeBlock, null);

    const laterFrames = [complete, `${complete}After`, `${complete}After\n`, `${complete}After\n\n`];
    assertCommittedFrameHistory([...frames, ...laterFrames]);
    const stablePair = committedPairs(committed);
    for (const frame of laterFrames) {
      const current = committedPairs(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      );
      for (const [id, source] of stablePair) assert.equal(current.get(id), source);
    }
  });

  test(`table settlement: bodyless ${name} stays active across a blank`, () => {
    const source = `${header}\n${delimiter}\n\n`;
    const streaming = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(streaming.committedBlocks, []);
    assert.equal(md(streaming.activeBlock).source, source);
    assert.equal(md(streaming.activeBlock).renderMode, "plain");

    const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
    assert.equal(settled.activeBlock, null);
    assert.deepEqual(settled.committedBlocks.map((block) => block.source), [source]);
    assert.equal(md(settled.committedBlocks[0]).renderMode, "markdown");
  });
}

// ── lists ────────────────────────────────────────────────────────────────

for (const [name, firstMarker, secondMarker] of [
  ["hyphen", "-", "-"],
  ["asterisk", "*", "*"],
  ["plus", "+", "+"],
  ["ordered dot", "1.", "2."],
  ["ordered parenthesis", "1)", "2)"],
] as const) {
  test(`list: newline-terminated ${name} marker is an empty committed item before a peer`, () => {
    const firstItem = `${firstMarker}\n`;
    const secondItem = `${secondMarker} item`;
    const source = `${firstItem}${secondItem}`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks, []);
    const active = list(result.activeBlock);
    assert.equal(active.ordered, name.startsWith("ordered"));
    assert.deepEqual(active.committedItems, [
      { id: `${TURN}:0-item-0`, source: firstItem },
    ]);
    assert.deepEqual(active.activeItem, {
      id: `${TURN}:0-item-1`,
      source: secondItem,
    });
    assertExactCoverage(result, source);
  });

  test(`list: unterminated ${name} marker remains provisional`, () => {
    const result = partitionStreamingMarkdown(firstMarker, {
      turnId: TURN,
      settled: false,
    });

    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, firstMarker);
    assert.equal(md(result.activeBlock).renderMode, "plain");
    assertExactCoverage(result, firstMarker);
  });
}

for (const [name, firstMarker, secondMarker] of [
  ["unordered", "-", "-"],
  ["ordered dot", "1.", "2."],
  ["ordered parenthesis", "1)", "2)"],
] as const) {
  test(`list: ${name} empty items preserve CRLF bytes exactly`, () => {
    const firstItem = `${firstMarker}\r\n`;
    const secondItem = `${secondMarker} item`;
    const source = `${firstItem}${secondItem}`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    const active = list(result.activeBlock);

    assert.deepEqual(active.committedItems, [
      { id: `${TURN}:0-item-0`, source: firstItem },
    ]);
    assert.deepEqual(active.activeItem, {
      id: `${TURN}:0-item-1`,
      source: secondItem,
    });
    assert.equal(active.source, source);
    assertExactCoverage(result, source);
  });
}

test("list: an empty peer remains valid inside an existing list container", () => {
  const source = "- first\n-\n- tail";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const active = list(result.activeBlock);

  assert.deepEqual(active.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- first\n" },
    { id: `${TURN}:0-item-1`, source: "-\n" },
  ]);
  assert.deepEqual(active.activeItem, {
    id: `${TURN}:0-item-2`,
    source: "- tail",
  });
  assertExactCoverage(result, source);
});

test("paragraph: empty list markers do not interrupt paragraph context", () => {
  for (const marker of ["*", "+", "1.", "1)"]) {
    const source = `Paragraph\n${marker}\nTail`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assertExactCoverage(result, source);
  }

  const setextSource = "Paragraph\n-\nTail";
  const setext = partitionStreamingMarkdown(setextSource, {
    turnId: TURN,
    settled: false,
  });
  assert.ok(setext.committedBlocks.every((block) => block.kind !== "list"));
  assert.ok(setext.activeBlock?.kind !== "list");
  assertExactCoverage(setext, setextSource);
});

test("list: empty-marker character prefixes never revoke committed pairs", () => {
  for (const source of [
    "-\n- item",
    "*\n* item",
    "+\n+ item",
    "1.\n2. item",
    "1)\n2) item",
    "- first\n-\n- tail",
  ]) {
    const frames = characterFrames(source);
    assertCommittedFrameHistory(frames);
    for (const frame of frames) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }
  }
});

test("list: partial trailing item is active, exact shape/id/items", () => {
  const source = "- one\n- tw";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = list(result.activeBlock);
  assert.equal(active.id, `${TURN}:0-list`);
  assert.equal(active.ordered, false);
  assert.equal(active.source, source);
  assert.deepEqual(active.committedItems, [{ id: `${TURN}:0-item-0`, source: "- one\n" }]);
  assert.deepEqual(active.activeItem, { id: `${TURN}:0-item-1`, source: "- tw" });
});

test("list: growth retains the list id and the newly-stable committed items", () => {
  const grown = "- one\n- two\n- three";
  const result = partitionStreamingMarkdown(grown, { turnId: TURN, settled: false });
  const active = list(result.activeBlock);
  assert.equal(active.id, `${TURN}:0-list`);
  assert.deepEqual(active.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- one\n" },
    { id: `${TURN}:0-item-1`, source: "- two\n" },
  ]);
  assert.deepEqual(active.activeItem, { id: `${TURN}:0-item-2`, source: "- three" });
});

test("list: later loose-looking continuation cannot change a committed peer item", () => {
  const firstFrame = "- one\n- two";
  const first = list(partitionStreamingMarkdown(firstFrame, {
    turnId: TURN,
    settled: false,
  }).activeBlock);
  const committed = first.committedItems[0];
  assert.deepEqual(committed, { id: `${TURN}:0-item-0`, source: "- one\n" });

  const grownSource = `${firstFrame}\n\n  continuation`;
  const grown = list(partitionStreamingMarkdown(grownSource, {
    turnId: TURN,
    settled: false,
  }).activeBlock);
  assert.deepEqual(grown.committedItems[0], committed);
  assert.deepEqual(grown.activeItem, {
    id: `${TURN}:0-item-1`,
    source: "- two\n\n  continuation",
  });
  assertExactCoverage(
    partitionStreamingMarkdown(grownSource, { turnId: TURN, settled: false }),
    grownSource,
  );
});

for (const [name, source, expectedItems] of [
  ["hyphen", "- one\n- two\n- three", ["- one\n", "- two\n", "- three"]],
  ["asterisk", "* one\n* two\n* three", ["* one\n", "* two\n", "* three"]],
  ["plus", "+ one\n+ two\n+ three", ["+ one\n", "+ two\n", "+ three"]],
  ["ordered", "1. one\n2. two\n1. three", ["1. one\n", "2. two\n", "1. three"]],
] as const) {
  test(`list: ${name} next-marker prefixes preserve every committed item pair`, () => {
    const secondLineEnd = source.indexOf("\n", source.indexOf("\n") + 1);
    const frames = Array.from(
      { length: source.length - secondLineEnd + 1 },
      (_, index) => source.slice(0, secondLineEnd + index),
    );
    const first = list(partitionStreamingMarkdown(frames[0], {
      turnId: TURN,
      settled: false,
    }).activeBlock);
    const stableListId = first.id;
    const seenItems = new Map(first.committedItems.map((item) => [item.id, item.source]));
    const secondLineStart = source.indexOf("\n") + 1;
    assert.deepEqual([...seenItems], [[`${TURN}:0-item-0`, expectedItems[0]]]);

    for (const frame of frames) {
      const active = list(partitionStreamingMarkdown(frame, {
        turnId: TURN,
        settled: false,
      }).activeBlock);
      assert.equal(active.id, stableListId);
      assert.equal(active.source, frame);
      const currentItems = new Map(active.committedItems.map((item) => [item.id, item.source]));
      for (const [id, itemSource] of seenItems) {
        assert.equal(
          currentItems.get(id),
          itemSource,
          `committed item ${id} changed at ${JSON.stringify(frame)}`,
        );
      }
      for (const [id, itemSource] of currentItems) seenItems.set(id, itemSource);
      if (active.committedItems.length === 1) {
        assert.deepEqual(active.activeItem, {
          id: `${TURN}:0-item-1`,
          source: frame.slice(secondLineStart),
        });
      }
    }

    const complete = list(partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: false,
    }).activeBlock);
    assert.deepEqual(complete.committedItems, [
      { id: `${TURN}:0-item-0`, source: expectedItems[0] },
      { id: `${TURN}:0-item-1`, source: expectedItems[1] },
    ]);
    assert.deepEqual(complete.activeItem, {
      id: `${TURN}:0-item-2`,
      source: expectedItems[2],
    });
  });
}

for (const [name, firstMarker, peerMarker] of [
  ["hyphen", "-", "-"],
  ["asterisk", "*", "*"],
  ["plus", "+", "+"],
  ["ordered", "1.", "2."],
] as const) {
  test(`list: ${name} empty peer owns later continuation before table lookahead`, () => {
    const firstItemSource = `${firstMarker} one\n| h |\n`;
    const secondItemSource = `${peerMarker} \n|`;
    const source = `${firstItemSource}${secondItemSource}`;
    const seenItems = new Map<string, string>();

    for (const frame of characterFrames(source)) {
      const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
      const currentItems = committedPairs(result);
      for (const [id, itemSource] of seenItems) {
        assert.equal(
          currentItems.get(id),
          itemSource,
          `committed item ${id} changed at ${JSON.stringify(frame)}`,
        );
      }
      for (const [id, itemSource] of currentItems) seenItems.set(id, itemSource);
      assertExactCoverage(result, frame);
    }

    assert.equal(seenItems.get(`${TURN}:0-item-0`), firstItemSource);

    const streaming = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    const active = list(streaming.activeBlock);
    assert.deepEqual(active.committedItems, [
      { id: `${TURN}:0-item-0`, source: firstItemSource },
    ]);
    assert.deepEqual(active.activeItem, {
      id: `${TURN}:0-item-1`,
      source: secondItemSource,
    });

    const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
    assert.equal(settled.activeBlock, null);
    assert.deepEqual(settled.committedBlocks, [
      {
        id: `${TURN}:0-list`,
        kind: "list",
        ordered: name === "ordered",
        ...(name === "ordered" ? { start: 1 } : {}),
        committedItems: [
          { id: `${TURN}:0-item-0`, source: firstItemSource },
          { id: `${TURN}:0-item-1`, source: secondItemSource },
        ],
        activeItem: undefined,
        source,
      },
    ]);
    assert.equal(settled.committedText, source);
    assertExactCoverage(settled, source);
  });
}

for (const [name, firstMarker, peerMarker] of [
  ["hyphen", "-", "-"],
  ["asterisk", "*", "*"],
  ["plus", "+", "+"],
  ["ordered", "1.", "2."],
] as const) {
  test(`list: ${name} pipe-bearing peer owns table-body position`, () => {
    const firstItemSource = `${firstMarker} one\n| h |\n| --- |\n`;
    const secondItemSource = `${peerMarker} |`;
    const source = `${firstItemSource}${secondItemSource}`;

    assertCommittedFrameHistory(characterFrames(source));
    for (const frame of characterFrames(source)) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }

    const streaming = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    const active = list(streaming.activeBlock);
    assert.deepEqual(active.committedItems, [
      { id: `${TURN}:0-item-0`, source: firstItemSource },
    ]);
    assert.deepEqual(active.activeItem, {
      id: `${TURN}:0-item-1`,
      source: secondItemSource,
    });

    const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
    assert.equal(settled.activeBlock, null);
    const settledList = list(settled.committedBlocks[0]);
    assert.deepEqual(settledList.committedItems, [
      { id: `${TURN}:0-item-0`, source: firstItemSource },
      { id: `${TURN}:0-item-1`, source: secondItemSource },
    ]);
    assert.equal(settledList.source, source);
    assert.equal(settled.committedText, source);
    assertExactCoverage(settled, source);
  });
}

test("list: a thematic-looking continuation does not prematurely commit its container", () => {
  const prefix = "- one\n- two";
  const source = `${prefix}\n- - -\nTail`;
  const frames = Array.from(
    { length: source.length - prefix.length + 1 },
    (_, index) => source.slice(0, prefix.length + index),
  );
  const firstItem = { id: `${TURN}:0-item-0`, source: "- one\n" };

  for (const frame of frames) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.equal(committedPairs(result).get(firstItem.id), firstItem.source);
    assert.equal(
      sourcesOf(result.activeBlock ? [...result.committedBlocks, result.activeBlock] : result.committedBlocks),
      frame,
    );
    assert.deepEqual(result.committedBlocks, []);
    const active = list(result.activeBlock);
    assert.deepEqual(active.activeItem, {
      id: `${TURN}:0-item-1`,
      source: frame.slice(source.indexOf("\n") + 1),
    });
    assertExactCoverage(result, frame);
  }

  const complete = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const active = list(complete.activeBlock);
  assert.deepEqual(active.committedItems, [firstItem]);
  assert.deepEqual(active.activeItem, {
    id: `${TURN}:0-item-1`,
    source: "- two\n- - -\nTail",
  });
});

test("list: a provisional marker that becomes ambiguous content keeps prior items", () => {
  const frames = ["- one\n- two", "- one\n- two\n-", "- one\n- two\n--", "- one\n- two\n-- prose"];
  const firstItem = { id: `${TURN}:0-item-0`, source: "- one\n" };

  for (const frame of frames) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.equal(committedPairs(result).get(firstItem.id), firstItem.source);
    const active = list(result.activeBlock);
    assert.equal(active.id, `${TURN}:0-list`);
    assert.equal(active.source, frame);
    assert.deepEqual(active.activeItem, {
      id: `${TURN}:0-item-1`,
      source: frame.slice("- one\n".length),
    });
  }
});

test("list: ordered list keeps stable positional item ids", () => {
  const source = "1. one\n2. two\n3. thr";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const active = list(result.activeBlock);
  assert.equal(active.ordered, true);
  assert.deepEqual(active.committedItems, [
    { id: `${TURN}:0-item-0`, source: "1. one\n" },
    { id: `${TURN}:0-item-1`, source: "2. two\n" },
  ]);
  assert.deepEqual(active.activeItem, { id: `${TURN}:0-item-2`, source: "3. thr" });
});

test("list: a continuation remains in the prior item when a later peer arrives", () => {
  const firstSource = "- one\n  continuation\n- two";
  const first = list(partitionStreamingMarkdown(firstSource, {
    turnId: TURN,
    settled: false,
  }).activeBlock);
  assert.deepEqual(first.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- one\n  continuation\n" },
  ]);
  assert.deepEqual(first.activeItem, {
    id: `${TURN}:0-item-1`,
    source: "- two",
  });

  const grownSource = `${firstSource}\n  more\n- three`;
  const grownResult = partitionStreamingMarkdown(grownSource, {
    turnId: TURN,
    settled: false,
  });
  const grown = list(grownResult.activeBlock);
  assert.equal(grown.id, first.id);
  assert.deepEqual(grown.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- one\n  continuation\n" },
    { id: `${TURN}:0-item-1`, source: "- two\n  more\n" },
  ]);
  assert.deepEqual(grown.activeItem, {
    id: `${TURN}:0-item-2`,
    source: "- three",
  });
  assertExactCoverage(grownResult, grownSource);
});

test("list: ordered peers remain discoverable after continuation lines", () => {
  const source = "1. one\n   continuation\n2. two\n   more\n3. three";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const active = list(result.activeBlock);
  assert.equal(active.ordered, true);
  assert.deepEqual(active.committedItems, [
    { id: `${TURN}:0-item-0`, source: "1. one\n   continuation\n" },
    { id: `${TURN}:0-item-1`, source: "2. two\n   more\n" },
  ]);
  assert.deepEqual(active.activeItem, {
    id: `${TURN}:0-item-2`,
    source: "3. three",
  });
  assertExactCoverage(result, source);
});

for (const [name, source, firstListSource, secondListSource, splitPrefix] of [
  [
    "unordered to ordered",
    "- one\n- two\n1. ordered",
    "- one\n- two\n",
    "1. ordered",
    "- one\n- two\n1. ",
  ],
  [
    "ordered to unordered",
    "1. one\n2. two\n- unordered",
    "1. one\n2. two\n",
    "- unordered",
    "1. one\n2. two\n- u",
  ],
] as const) {
  test(`list: a proven same-indent ${name} marker starts a new stable list`, () => {
    const frames = characterFrames(source);
    assertCommittedFrameHistory(frames);
    for (const frame of frames) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }

    const beforeSplit = source.slice(0, splitPrefix.length - 1);
    const provisional = partitionStreamingMarkdown(beforeSplit, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(provisional.committedBlocks, []);

    const split = partitionStreamingMarkdown(splitPrefix, {
      turnId: TURN,
      settled: false,
    });
    assert.equal(list(split.committedBlocks[0]).source, firstListSource);
    assert.equal(list(split.activeBlock).source, splitPrefix.slice(firstListSource.length));

    const final = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.equal(final.committedBlocks.length, 1);
    const committedList = list(final.committedBlocks[0]);
    assert.equal(committedList.source, firstListSource);
    const firstItemEnd = firstListSource.indexOf("\n") + 1;
    assert.deepEqual(
      committedList.committedItems.map((item) => item.source),
      [
        firstListSource.slice(0, firstItemEnd),
        firstListSource.slice(firstItemEnd),
      ],
    );
    const activeList = list(final.activeBlock);
    assert.equal(activeList.source, secondListSource);
    assert.notEqual(activeList.ordered, committedList.ordered);
    assertExactCoverage(final, source);
  });
}

for (const {
  name,
  source,
  firstSource,
  secondSource,
  firstStart,
  secondStart,
} of [
  {
    name: "unordered bullet",
    source: "- one\n* two",
    firstSource: "- one\n",
    secondSource: "* two",
    firstStart: undefined,
    secondStart: undefined,
  },
  {
    name: "ordered delimiter",
    source: "1. one\n7) seven",
    firstSource: "1. one\n",
    secondSource: "7) seven",
    firstStart: 1,
    secondStart: 7,
  },
] as const) {
  test(`list: a different ${name} starts a new source-stable container`, () => {
    assertCommittedFrameHistory(characterFrames(source));
    for (const frame of characterFrames(source)) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }

    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.equal(result.committedBlocks.length, 1);
    const first = list(result.committedBlocks[0]);
    const second = list(result.activeBlock);
    assert.equal(first.id, `${TURN}:0-list`);
    assert.equal(first.source, firstSource);
    assert.equal(first.start, firstStart);
    assert.deepEqual(first.committedItems, [
      { id: `${TURN}:0-item-0`, source: firstSource },
    ]);
    assert.equal(second.id, `${TURN}:${firstSource.length}-list`);
    assert.equal(second.source, secondSource);
    assert.equal(second.start, secondStart);
    assert.deepEqual(second.activeItem, {
      id: `${TURN}:${firstSource.length}-item-0`,
      source: secondSource,
    });
  });
}

test("list: ordered peers share a delimiter while preserving the first marker start", () => {
  const source = "1. one\n7. seven";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const active = list(result.activeBlock);

  assert.deepEqual(result.committedBlocks, []);
  assert.equal(active.id, `${TURN}:0-list`);
  assert.equal(active.start, 1);
  assert.deepEqual(active.committedItems, [
    { id: `${TURN}:0-item-0`, source: "1. one\n" },
  ]);
  assert.deepEqual(active.activeItem, {
    id: `${TURN}:0-item-1`,
    source: "7. seven",
  });
  assertExactCoverage(result, source);
  assertCommittedFrameHistory(characterFrames(source));
});

test("list: nested lines remain in the prior top-level item when a peer arrives", () => {
  const source = "- one\n  - nested\n    detail\n  | --- |\n- two";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const active = list(result.activeBlock);
  assert.deepEqual(active.committedItems, [
    {
      id: `${TURN}:0-item-0`,
      source: "- one\n  - nested\n    detail\n  | --- |\n",
    },
  ]);
  assert.deepEqual(active.activeItem, {
    id: `${TURN}:0-item-1`,
    source: "- two",
  });
  assertExactCoverage(result, source);
});

test("list: indented block markers remain owned by the current item", () => {
  const source = "- one\n  > nested quote\n  # nested heading\n  ```nested\n- two";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const active = list(result.activeBlock);
  assert.deepEqual(active.committedItems, [
    {
      id: `${TURN}:0-item-0`,
      source: "- one\n  > nested quote\n  # nested heading\n  ```nested\n",
    },
  ]);
  assert.deepEqual(active.activeItem, {
    id: `${TURN}:0-item-1`,
    source: "- two",
  });
  assertExactCoverage(result, source);
});

test("list: a valid indented table sequence remains nested item content", () => {
  const source = "- one\n  | h |\n  | --- |\n  | body |\n- two";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = list(result.activeBlock);
  assert.deepEqual(active.committedItems, [
    {
      id: `${TURN}:0-item-0`,
      source: "- one\n  | h |\n  | --- |\n  | body |\n",
    },
  ]);
  assert.deepEqual(active.activeItem, {
    id: `${TURN}:0-item-1`,
    source: "- two",
  });
  assertExactCoverage(result, source);
});

test("list: proven top-level container terminators precede table lookahead", () => {
  const source = "- one\n> | h |\n---\n=";
  const frames = characterFrames(source);
  assertCommittedFrameHistory(frames);
  for (const frame of frames) {
    assertExactCoverage(
      partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      frame,
    );
  }

  for (const frame of ["- one\n> | h |\n---\n", source]) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks.map((block) => block.source), ["- one\n"]);
    assert.equal(md(result.activeBlock).source, frame.slice("- one\n".length));
  }
});

test("list: heading and fence headers terminate, while indented lookalikes stay nested", () => {
  for (const source of [
    "- one\n# | h |\n---\n=",
    "- one\n``` | h |\n---\n=",
  ]) {
    assertCommittedFrameHistory(characterFrames(source));
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.equal(result.committedBlocks[0]?.source, "- one\n");
    assertExactCoverage(result, source);
  }

  const nested = "- one\n    | h |\n---\n=";
  assertCommittedFrameHistory(characterFrames(nested));
  const result = partitionStreamingMarkdown(nested, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, nested);
  assertExactCoverage(result, nested);
});

for (const [name, source, expectedItems] of [
  [
    "unordered",
    "- one\n- | h |\n| --- |\n| body |\n\nTail",
    ["- one\n", "- | h |\n| --- |\n| body |\n"],
  ],
  [
    "ordered",
    "1. one\n2. | h |\n| --- |\n| body |\n\nTail",
    ["1. one\n", "2. | h |\n| --- |\n| body |\n"],
  ],
] as const) {
  test(`list: ${name} pipe-bearing peer takes precedence over table lookahead`, () => {
    const frames = characterFrames(source);
    assertCommittedFrameHistory(frames);
    for (const frame of frames) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }

    const streaming = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    const committedList = list(streaming.committedBlocks[0]);
    assert.deepEqual(committedList.committedItems.map((item) => item.source), expectedItems);
    assert.equal(md(streaming.committedBlocks[1]).source, "\n");
    assert.equal(md(streaming.activeBlock).source, "Tail");

    const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
    const settledList = list(settled.committedBlocks[0]);
    assert.deepEqual(settledList.committedItems.map((item) => item.source), expectedItems);
    assert.equal(settledList.activeItem, undefined);
    assertExactCoverage(settled, source);
  });
}

for (const [name, source] of [
  ["unordered", "- | h |\n| --- |\n| body |\n\nTail"],
  ["ordered", "2. | h |\n| --- |\n| body |\n\nTail"],
] as const) {
  test(`list: initial ${name} pipe-bearing item takes precedence over table lookahead`, () => {
    const frames = characterFrames(source);
    assertCommittedFrameHistory(frames);
    for (const frame of frames) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }

    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    const committedList = list(result.committedBlocks[0]);
    assert.deepEqual(committedList.committedItems.map((item) => item.source), [
      source.slice(0, source.indexOf("\n\n") + 1),
    ]);
    assert.equal(md(result.committedBlocks[1]).source, "\n");
    assert.equal(md(result.activeBlock).source, "Tail");
    assertExactCoverage(result, source);
  });
}

test("list: indented pipe continuations stay with a pipe-bearing peer item", () => {
  const source = "- one\n- | h |\n  | --- |\n  | body |\n- tail";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
  const block = list(result.committedBlocks[0]);

  assert.deepEqual(block.committedItems.map((item) => item.source), [
    "- one\n",
    "- | h |\n  | --- |\n  | body |\n",
    "- tail",
  ]);
  assert.equal(block.activeItem, undefined);
  assertExactCoverage(result, source);
});

test("list: table-like continuation without a blank stays ambiguous", () => {
  for (const source of [
    "- one\n| --- |",
    "- one\n| --- |\nTail",
    "- one\n| h |\n| --- |",
  ]) {
    const streaming = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(streaming.committedBlocks, []);
    assert.equal(md(streaming.activeBlock).source, source);
    assert.equal(md(streaming.activeBlock).renderMode, "plain");

    const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
    assert.equal(settled.activeBlock, null);
    assert.equal(md(settled.committedBlocks[0]).source, source);
    assert.equal(md(settled.committedBlocks[0]).renderMode, "markdown");
  }
});

test("list: a proven top-level table starts at its header and follows the table blank rule", () => {
  const listSource = "- one\n- two\n";
  const tableGrowing = "| h |\n| --- |\n| body |\n";
  const growingSource = `${listSource}${tableGrowing}`;
  const completeTable = `${tableGrowing}\n`;
  const source = `${listSource}${completeTable}Tail`;
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  for (const frame of frames) {
    assertExactCoverage(
      partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      frame,
    );
  }

  const bodyless = partitionStreamingMarkdown(`${listSource}| h |\n| --- |\n`, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(bodyless.committedBlocks, []);
  assert.equal(list(bodyless.activeBlock).source, `${listSource}| h |\n| --- |\n`);

  const growing = partitionStreamingMarkdown(growingSource, {
    turnId: TURN,
    settled: false,
  });
  const committedList = list(growing.committedBlocks[0]);
  assert.equal(committedList.source, listSource);
  assert.deepEqual(committedList.committedItems.map((item) => item.source), [
    "- one\n",
    "- two\n",
  ]);
  const activeTable = md(growing.activeBlock);
  assert.equal(activeTable.source, tableGrowing);
  assert.equal(activeTable.id, `${TURN}:${listSource.length}-active`);
  assert.equal(activeTable.renderMode, "plain");

  const final = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(final.committedBlocks.map((block) => block.source), [
    listSource,
    completeTable,
  ]);
  assert.equal(
    md(final.committedBlocks[1]).id,
    `${TURN}:${listSource.length}-${listSource.length + completeTable.length}`,
  );
  assert.equal(md(final.activeBlock).source, "Tail");
  assertExactCoverage(final, source);
});

test("list: an appendable prospective table body cannot mint a revocable list commit", () => {
  const source = "- one\n| h |\n---\n# body | cell";
  const seen = new Map<string, string>();
  let committedText = "";

  for (const frame of characterFrames(source)) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    const current = committedPairs(result);
    for (const [id, itemSource] of seen) {
      assert.equal(
        current.get(id),
        itemSource,
        `committed pair ${id} disappeared or changed at ${JSON.stringify(frame)}`,
      );
    }
    for (const [id, itemSource] of current) seen.set(id, itemSource);
    assert.ok(
      result.committedText.startsWith(committedText),
      `committedText shrank or changed at ${JSON.stringify(frame)}`,
    );
    committedText = result.committedText;
    assertExactCoverage(result, frame);
  }
});

test("list: a prospective body splits permanently only after its terminating newline", () => {
  const listSource = "- one\n";
  const tableSource = "| h |\n---\n# body | cell";
  const bodyPrefix = `${listSource}| h |\n---\n`;

  for (const frame of characterFrames("# body | cell")) {
    const result = partitionStreamingMarkdown(`${bodyPrefix}${frame}`, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, `${bodyPrefix}${frame}`);
  }

  const growing = partitionStreamingMarkdown(`${listSource}${tableSource}\n`, {
    turnId: TURN,
    settled: false,
  });
  assert.equal(list(growing.committedBlocks[0]).source, listSource);
  assert.equal(md(growing.activeBlock).source, `${tableSource}\n`);

  const completeTable = `${tableSource}\n\n`;
  const complete = partitionStreamingMarkdown(`${listSource}${completeTable}`, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(complete.committedBlocks.map((block) => block.source), [
    listSource,
    completeTable,
  ]);
  assert.equal(list(complete.committedBlocks[0]).id, `${TURN}:0-list`);
  assert.equal(
    md(complete.committedBlocks[1]).id,
    `${TURN}:${listSource.length}-${listSource.length + completeTable.length}`,
  );
  assert.equal(complete.committedText, `${listSource}${completeTable}`);
  assert.equal(complete.activeBlock, null);
});

test("list: prior committed items survive a provisional table body and later split", () => {
  const listSource = "- one\n- two\n";
  const tablePrefix = "| h |\n---\n";
  const source = `${listSource}${tablePrefix}# body | cell\n`;
  const firstItem = { id: `${TURN}:0-item-0`, source: "- one\n" };

  assertCommittedFrameHistory(characterFrames(source));
  const provisional = partitionStreamingMarkdown(`${listSource}${tablePrefix}# body`, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(provisional.committedBlocks, []);
  assert.deepEqual(list(provisional.activeBlock).committedItems, [firstItem]);

  const split = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const committedList = list(split.committedBlocks[0]);
  assert.equal(committedList.source, listSource);
  assert.deepEqual(committedList.committedItems, [
    firstItem,
    { id: `${TURN}:0-item-1`, source: "- two\n" },
  ]);
  assert.equal(md(split.activeBlock).source, `${tablePrefix}# body | cell\n`);
  assertExactCoverage(split, source);
});

test("list: a terminated invalid prospective body irreversibly disproves the table", () => {
  const provisional = "- one\n| h |\n---\n# invalid";
  const terminated = `${provisional}\n`;
  const source = `${terminated}Later | unrelated`;

  const beforeNewline = partitionStreamingMarkdown(provisional, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(beforeNewline.committedBlocks, []);
  assert.equal(md(beforeNewline.activeBlock).source, provisional);

  assertCommittedFrameHistory(characterFrames(source));
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), [
    "- one\n| h |\n---\n",
    "# invalid\n",
  ]);
  assert.equal(list(result.committedBlocks[0]).id, `${TURN}:0-list`);
  assert.equal(md(result.activeBlock).source, "Later | unrelated");
  assert.equal(result.committedText, terminated);
  assertExactCoverage(result, source);
});

test("ordered list: a pipe-delimited prospective table body stays provisional then splits", () => {
  const listSource = "1. one\n";
  const tableSource = "| h |\n| --- |\n# body | cell\n";
  const source = `${listSource}${tableSource}`;

  assertCommittedFrameHistory(characterFrames(source));
  const provisional = partitionStreamingMarkdown(`${listSource}| h |\n| --- |\n# body`, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(provisional.committedBlocks, []);
  assert.equal(md(provisional.activeBlock).source, `${listSource}| h |\n| --- |\n# body`);

  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const committedList = list(result.committedBlocks[0]);
  assert.equal(committedList.ordered, true);
  assert.equal(committedList.id, `${TURN}:0-list`);
  assert.equal(committedList.source, listSource);
  assert.equal(md(result.activeBlock).source, tableSource);
  assertExactCoverage(result, source);
});

for (const delimiter of ["---", ":---:", "| --- |"] as const) {
  test(`list: header plus ${delimiter} delimiter without a body stays active plain`, () => {
    const source = `- one\n| h |\n${delimiter}\n`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assert.equal(md(result.activeBlock).renderMode, "plain");
    assert.equal(result.committedText, "");
  });
}

test("list: table-like continuation preserves already committed item pairs", () => {
  const source = "- one\n- two\n| --- |\n| still item two |";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = list(result.activeBlock);
  assert.deepEqual(active.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- one\n" },
  ]);
  assert.deepEqual(active.activeItem, {
    id: `${TURN}:0-item-1`,
    source: "- two\n| --- |\n| still item two |",
  });
  assertExactCoverage(result, source);
});

test("list: a blank boundary permits a separate valid top-level table", () => {
  const source = "- one\n- two\n\n| h |\n| --- |\n| body |\n\nTail";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), [
    "- one\n- two\n",
    "\n",
    "| h |\n| --- |\n| body |\n\n",
  ]);
  const committedList = list(result.committedBlocks[0]);
  assert.deepEqual(committedList.committedItems.map((item) => item.source), [
    "- one\n",
    "- two\n",
  ]);
  assert.equal(md(result.activeBlock).source, "Tail");
  assertExactCoverage(result, source);
});

test("list: blank line after the final item commits the whole list, no active item", () => {
  const source = "- one\n- two\n\nAfter";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 2); // list, then the blank-run block
  const committedList = list(result.committedBlocks[0]);
  assert.equal(committedList.id, `${TURN}:0-list`);
  assert.equal(committedList.activeItem, undefined);
  assert.deepEqual(committedList.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- one\n" },
    { id: `${TURN}:0-item-1`, source: "- two\n" },
  ]);
  const active = md(result.activeBlock);
  assert.equal(active.source, "After");
  assert.equal(sourcesOf([...result.committedBlocks, result.activeBlock!]), source);
});

test("list: a top-level peer after a nested marker starts a new item", () => {
  const source = "- one\n  - nested\n- two";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = list(result.activeBlock);
  assert.deepEqual(active.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- one\n  - nested\n" },
  ]);
  assert.deepEqual(active.activeItem, {
    id: `${TURN}:0-item-1`,
    source: "- two",
  });
  assertExactCoverage(result, source);
});

for (const [name, source, expectedFinalItem] of [
  [
    "unordered without a terminal newline",
    "- one\n- two\n  continuation\n  - nested",
    "- two\n  continuation\n  - nested",
  ],
  [
    "ordered with a trailing blank",
    "1. one\n2. two\n   continuation\n\n   1. nested\n\n",
    "2. two\n   continuation\n\n   1. nested\n\n",
  ],
] as const) {
  test(`list settlement: ${name} commits the complete ambiguous final item`, () => {
    const streaming = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    const activeList = list(streaming.activeBlock);
    assert.ok(activeList.activeItem);

    const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
    assert.equal(settled.activeBlock, null);
    assert.equal(settled.committedBlocks.length, 1);
    const settledList = list(settled.committedBlocks[0]);
    assert.equal(settledList.activeItem, undefined);
    assert.deepEqual(settledList.committedItems.map((item) => item.source), [
      source.slice(0, source.indexOf("\n") + 1),
      expectedFinalItem,
    ]);
    assert.equal(
      settledList.committedItems.map((item) => item.source).join(""),
      settledList.source,
    );
    assert.equal(
      settledList.committedItems.at(-1)?.id,
      activeList.activeItem?.id,
    );
  });
}

// ── nested quote/list ambiguity ──────────────────────────────────────────

test("blockquote+list mixture remains one active plain source, never split", () => {
  const source = "> Intro\n> - one\n> - two";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = md(result.activeBlock);
  assert.equal(active.source, source);
  assert.equal(active.renderMode, "plain");
});

test("a peer after nested content and an internal blank remains in one list container", () => {
  const source = "- one\n  - nested\n\n- two";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = list(result.activeBlock);
  assert.deepEqual(active.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- one\n  - nested\n\n" },
  ]);
  assert.deepEqual(active.activeItem, {
    id: `${TURN}:0-item-1`,
    source: "- two",
  });
  assertExactCoverage(result, source);

  const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
  assert.equal(settled.activeBlock, null);
  assert.equal(settled.committedBlocks.length, 1);
  const settledList = list(settled.committedBlocks[0]);
  assert.deepEqual(settledList.committedItems.map((item) => item.source), [
    "- one\n  - nested\n\n",
    "- two",
  ]);
  assertExactCoverage(settled, source);
});

test("ambiguous quoted list stays one active plain block across internal blanks", () => {
  const source = "> Intro\n> - one\n\n> - two";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = md(result.activeBlock);
  assert.equal(active.source, source);
  assert.equal(active.renderMode, "plain");
});

// ── blockquote ───────────────────────────────────────────────────────────

test("blockquote: commits only at the blank terminator", () => {
  const streaming = partitionStreamingMarkdown("> Quoted line", { turnId: TURN, settled: false });
  assert.deepEqual(streaming.committedBlocks, []);
  assert.equal(md(streaming.activeBlock).source, "> Quoted line");

  const source = "> Quoted line\n> more\n\nAfter";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 1);
  const quote = md(result.committedBlocks[0]);
  assert.equal(quote.source, "> Quoted line\n> more\n\n");
  const active = md(result.activeBlock);
  assert.equal(active.source, "After");
  assert.equal(sourcesOf([...result.committedBlocks, result.activeBlock!]), source);
});

test("blockquote: a newline without a blank terminator remains active plain", () => {
  const source = "> Quoted line\n";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = md(result.activeBlock);
  assert.equal(active.source, source);
  assert.equal(active.renderMode, "plain");
});

// ── indented code ────────────────────────────────────────────────────────

test("paragraph: an indented line without a blank boundary remains paragraph markdown", () => {
  const source = "Paragraph\n    indented";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result, {
    committedBlocks: [],
    activeBlock: {
      id: `${TURN}:0-active`,
      kind: "markdown",
      source,
      renderMode: "markdown",
    },
    committedText: "",
  });
});

test("paragraph: indented continuation commits only at its blank boundary", () => {
  const paragraph = "Paragraph\n    indented";
  const committedSource = `${paragraph}\n\n`;
  const source = `${committedSource}    code`;
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  for (const frame of frames) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assertExactCoverage(result, frame);
    if (frame.length < committedSource.length) {
      assert.deepEqual(
        result.committedBlocks,
        [],
        `committed before the paragraph blank boundary at ${JSON.stringify(frame)}`,
      );
    }
  }

  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), [committedSource]);
  assert.equal(md(result.committedBlocks[0]).id, `${TURN}:0-${committedSource.length}`);
  const activeCode = md(result.activeBlock);
  assert.equal(activeCode.source, "    code");
  assert.equal(activeCode.id, `${TURN}:${committedSource.length}-active`);
  assert.equal(activeCode.renderMode, "plain");
});

test("indented code: active while growing, plain, then commits at the blank terminator", () => {
  const growing = "    const x = 1";
  const streaming = partitionStreamingMarkdown(growing, { turnId: TURN, settled: false });
  assert.deepEqual(streaming.committedBlocks, []);
  const activeGrowing = md(streaming.activeBlock);
  assert.equal(activeGrowing.source, growing);
  assert.equal(activeGrowing.renderMode, "plain");

  const source = "    const x = 1\n    const y = 2\n\nAfter";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 1);
  const code = md(result.committedBlocks[0]);
  assert.equal(code.source, "    const x = 1\n    const y = 2\n\n");
  assert.equal(code.renderMode, "markdown");
  const active = md(result.activeBlock);
  assert.equal(active.source, "After");
  assert.equal(sourcesOf([...result.committedBlocks, result.activeBlock!]), source);
});

test("indented code: following text without a blank keeps the whole tail active plain", () => {
  const source = "    const x = 1\nAfter";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = md(result.activeBlock);
  assert.equal(active.source, source);
  assert.equal(active.renderMode, "plain");
});

test("indented code: continuation commits only through a later terminating blank", () => {
  const ambiguous = "    const x = 1\nAfter";
  const complete = `${ambiguous}\n\n`;
  const source = `${complete}Tail`;
  const frames = Array.from({ length: source.length }, (_, index) => source.slice(0, index + 1));

  assertCommittedFrameHistory(frames);
  for (const frame of frames) {
    assertExactCoverage(
      partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      frame,
    );
  }
  for (const frame of frames.slice(0, complete.length - 1)) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.deepEqual(
      result.committedBlocks,
      [],
      `committed indented prefix before blank at ${JSON.stringify(frame)}`,
    );
  }

  const terminated = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(terminated.committedBlocks.map((block) => block.source), [complete]);
  assert.equal(md(terminated.committedBlocks[0]).renderMode, "markdown");
  assert.equal(md(terminated.activeBlock).source, "Tail");

  const settled = partitionStreamingMarkdown(ambiguous, { turnId: TURN, settled: true });
  assert.deepEqual(settled.committedBlocks.map((block) => block.source), [ambiguous]);
  assert.equal(md(settled.committedBlocks[0]).renderMode, "markdown");
});

for (const codeLine of ["    ---", "    ***", "\t---", "\t***"]) {
  test(`indented code: ${JSON.stringify(codeLine)} takes precedence over a thematic break`, () => {
    const streaming = partitionStreamingMarkdown(codeLine, { turnId: TURN, settled: false });
    assert.deepEqual(streaming.committedBlocks, []);
    assert.equal(md(streaming.activeBlock).source, codeLine);
    assert.equal(md(streaming.activeBlock).renderMode, "plain");

    const source = `${codeLine}\n\nAfter`;
    const terminated = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.equal(md(terminated.committedBlocks[0]).source, `${codeLine}\n\n`);
    assert.equal(md(terminated.committedBlocks[0]).renderMode, "markdown");
    assert.equal(md(terminated.activeBlock).source, "After");
    assert.equal(sourcesOf([...terminated.committedBlocks, terminated.activeBlock!]), source);

    const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
    assert.equal(sourcesOf(settled.committedBlocks), source);
    assert.equal(settled.committedText, source);
  });
}

test("indented code: tabs advance to four-column stops after leading spaces", () => {
  for (const codeLine of [
    " \t---",
    "  \t# heading",
    "   \t- item",
    " \t| --- |",
    " \t<div>",
  ]) {
    const streaming = partitionStreamingMarkdown(codeLine, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(streaming.committedBlocks, []);
    assert.equal(md(streaming.activeBlock).source, codeLine);
    assert.equal(
      md(streaming.activeBlock).renderMode,
      "plain",
      `${JSON.stringify(codeLine)} was not classified as indented code`,
    );

    const code = `${codeLine}\r\n\r\n`;
    const source = `${code}After`;
    const terminated = partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(terminated.committedBlocks.map((block) => block.source), [code]);
    assert.equal(md(terminated.committedBlocks[0]).renderMode, "markdown");
    assert.equal(md(terminated.activeBlock).source, "After");
    assertExactCoverage(terminated, source);
  }
});

// ── thematic break vs list ambiguity ────────────────────────────────────

test("thematic break: a spaced hyphen rule is a thematic break, not a list", () => {
  const source = "- - -\nAfter";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 1);
  const rule = md(result.committedBlocks[0]);
  assert.equal(rule.source, "- - -\n");
  const active = md(result.activeBlock);
  assert.equal(active.source, "After");
});

test("thematic break: a standalone rule commits normally", () => {
  const standalone = partitionStreamingMarkdown("---\n", { turnId: TURN, settled: false });
  assert.deepEqual(standalone.committedBlocks.map((block) => block.source), ["---\n"]);
  assert.equal(standalone.activeBlock, null);
});

for (const underline of ["---", "==="]) {
  test(`setext heading: ${underline} stays whole until the underline newline`, () => {
    const partial = `Paragraph\n${underline}`;
    const complete = `${partial}\n`;
    const partialResult = partitionStreamingMarkdown(partial, { turnId: TURN, settled: false });
    assert.deepEqual(partialResult.committedBlocks, []);
    assert.equal(md(partialResult.activeBlock).source, partial);
    assert.equal(md(partialResult.activeBlock).renderMode, "plain");

    const completeResult = partitionStreamingMarkdown(complete, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(completeResult.committedBlocks.map((block) => block.source), [complete]);
    const heading = md(completeResult.committedBlocks[0]);
    assert.equal(heading.id, `${TURN}:0-${complete.length}`);
    assert.equal(heading.renderMode, "markdown");
    assert.equal(completeResult.activeBlock, null);

    const settled = partitionStreamingMarkdown(partial, { turnId: TURN, settled: true });
    assert.deepEqual(settled.committedBlocks.map((block) => block.source), [partial]);
    assert.equal(md(settled.committedBlocks[0]).renderMode, "markdown");
    const frames = [
      ...Array.from({ length: complete.length }, (_, index) => complete.slice(0, index + 1)),
      `${complete}After`,
    ];
    assertCommittedFrameHistory(frames);
    for (const frame of frames) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }
  });
}

test("setext heading: a pipe header keeps table precedence", () => {
  const candidate = "| A |\n---\n";
  const active = partitionStreamingMarkdown(candidate, { turnId: TURN, settled: false });
  assert.deepEqual(active.committedBlocks, []);
  assert.equal(md(active.activeBlock).source, candidate);
  assert.equal(md(active.activeBlock).renderMode, "plain");

  const table = `${candidate}| body |\n\n`;
  const committed = partitionStreamingMarkdown(table, { turnId: TURN, settled: false });
  assert.deepEqual(committed.committedBlocks.map((block) => block.source), [table]);
  assert.equal(committed.activeBlock, null);
});

test("thematic break: a plain hyphen list item is not mistaken for a rule", () => {
  const source = "- item one";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  const active = list(result.activeBlock);
  assert.equal(active.committedItems.length, 0);
  assert.ok(active.activeItem);
  assert.equal(active.activeItem!.source, source);
});

for (const marker of ["-", "*", "_"] as const) {
  test(`frame history: provisional ${marker} marker lines cannot interrupt until classification is stable`, () => {
    const frames = [
      `Prose\n${marker} ${marker} `,
      `Prose\n${marker} ${marker} ${marker}`,
      `Prose\n${marker} ${marker} ${marker}\n`,
    ];

    const provisional = partitionStreamingMarkdown(frames[0], { turnId: TURN, settled: false });
    assert.deepEqual(provisional.committedBlocks, []);
    assert.equal(md(provisional.activeBlock).source, frames[0]);

    const complete = partitionStreamingMarkdown(frames[2], { turnId: TURN, settled: false });
    assert.deepEqual(
      complete.committedBlocks.map((block) => block.source),
      ["Prose\n", `${marker} ${marker} ${marker}\n`],
    );
    assert.equal(complete.activeBlock, null);

    assertCommittedFrameHistory(frames);
  });
}

test("frame history: irreversible list content still commits the preceding paragraph", () => {
  const source = "Prose\n- item";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), ["Prose\n"]);
  assert.equal(list(result.activeBlock).source, "- item");
});

test("frame history: a provisional next item cannot revoke an earlier committed list item", () => {
  const frames = ["- item\n- - ", "- item\n- - -", "- item\n- - -\n"];
  const provisional = partitionStreamingMarkdown(frames[0], { turnId: TURN, settled: false });
  assert.deepEqual(committedPairs(provisional), new Map());
  assert.equal(md(provisional.activeBlock).source, frames[0]);

  assertCommittedFrameHistory(frames);
});

test("frame history: a Setext heading commits only with its terminating newline", () => {
  const growing = partitionStreamingMarkdown("Prose\n---", { turnId: TURN, settled: false });
  assert.deepEqual(growing.committedBlocks, []);
  assert.equal(md(growing.activeBlock).source, "Prose\n---");

  const complete = partitionStreamingMarkdown("Prose\n---\n", { turnId: TURN, settled: false });
  assert.deepEqual(complete.committedBlocks.map((block) => block.source), ["Prose\n---\n"]);
  assert.equal(complete.activeBlock, null);
});

// ── CRLF / byte preservation ─────────────────────────────────────────────

test("CRLF bytes are preserved verbatim, never normalized", () => {
  const source = "A paragraph\r\n\r\nNext";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 1);
  const committed = md(result.committedBlocks[0]);
  assert.equal(committed.source, "A paragraph\r\n\r\n");
  const active = md(result.activeBlock);
  assert.equal(active.source, "Next");
  assert.equal(sourcesOf([...result.committedBlocks, result.activeBlock!]), source);
});

test("mixed CRLF boundaries preserve exact coverage before and after settlement", () => {
  const source = "Prose\r\n# Heading\r\n```ts\r\ncode\r\n";
  const streaming = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(
    streaming.committedBlocks.map((block) => block.source),
    ["Prose\r\n", "# Heading\r\n"],
  );
  const active = md(streaming.activeBlock);
  assert.equal(active.source, "```ts\r\ncode\r\n");
  assert.equal(active.renderMode, "plain");
  assert.equal(sourcesOf([...streaming.committedBlocks, active]), source);

  const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
  assert.equal(settled.activeBlock, null);
  assert.equal(sourcesOf(settled.committedBlocks), source);
  assert.equal(settled.committedText, source);
  assert.ok(
    settled.committedBlocks.every(
      (block) => block.kind !== "markdown" || block.renderMode === "markdown",
    ),
  );
});

test("unterminated CR stays provisional until LF proves a CRLF list line", () => {
  for (const frame of ["- one\n- two\r", "- one\n- two\r."]) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks, []);
    const active = list(result.activeBlock);
    assert.deepEqual(active.committedItems, [
      { id: `${TURN}:0-item-0`, source: "- one\n" },
    ]);
    assert.deepEqual(active.activeItem, {
      id: `${TURN}:0-item-1`,
      source: frame.slice("- one\n".length),
    });
    assertExactCoverage(result, frame);
  }

  const completedLine = "- one\n- two\r\n";
  const completed = partitionStreamingMarkdown(completedLine, {
    turnId: TURN,
    settled: false,
  });
  const completedList = list(completed.activeBlock);
  assert.deepEqual(completedList.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- one\n" },
  ]);
  assert.deepEqual(completedList.activeItem, {
    id: `${TURN}:0-item-1`,
    source: "- two\r\n",
  });
  assertExactCoverage(completed, completedLine);

  const grownSource = `${completedLine}- three`;
  const grown = partitionStreamingMarkdown(grownSource, { turnId: TURN, settled: false });
  const grownList = list(grown.activeBlock);
  assert.deepEqual(grownList.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- one\n" },
    { id: `${TURN}:0-item-1`, source: "- two\r\n" },
  ]);
  assert.deepEqual(grownList.activeItem, {
    id: `${TURN}:0-item-2`,
    source: "- three",
  });
  assertExactCoverage(grown, grownSource);
});

test("trailing CR preserves same-family empty peers already proven by their prefix", () => {
  for (const [name, firstItem, peer] of [
    ["plus", "+ one\n", "+ "],
    ["ordered", "1. one\n", "2. "],
  ] as const) {
    for (const suffix of ["\r", "\r\n", "\rx"]) {
      const source = `${firstItem}${peer}${suffix}`;
      const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
      const active = list(result.activeBlock);

      assert.deepEqual(
        active.committedItems,
        [{ id: `${TURN}:0-item-0`, source: firstItem }],
        name,
      );
      assert.deepEqual(active.activeItem, {
        id: `${TURN}:0-item-1`,
        source: `${peer}${suffix}`,
      });
      assertExactCoverage(result, source);
    }

    for (const source of [`${firstItem}${peer}\r\n`, `${firstItem}${peer}\rx`]) {
      assertCommittedFrameHistory(characterFrames(source));
    }
  }
});

test("trailing CR preserves a proven boundary between different list families", () => {
  for (const [name, firstItem, peer, ordered] of [
    ["unordered to ordered", "- one\n", "1. ", true],
    ["hyphen to plus", "- one\n", "+ ", false],
    ["ordered dot to parenthesis", "1. one\n", "2) ", true],
  ] as const) {
    for (const suffix of ["\r", "\r\n", "\rx"]) {
      const source = `${firstItem}${peer}${suffix}`;
      const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

      assert.equal(result.committedBlocks.length, 1, name);
      assert.equal(list(result.committedBlocks[0]).source, firstItem);
      const active = list(result.activeBlock);
      assert.equal(active.ordered, ordered);
      assert.deepEqual(active.committedItems, []);
      assert.deepEqual(active.activeItem, {
        id: `${TURN}:${firstItem.length}-item-0`,
        source: `${peer}${suffix}`,
      });
      assertExactCoverage(result, source);
    }

    for (const source of [`${firstItem}${peer}\r\n`, `${firstItem}${peer}\rx`]) {
      assertCommittedFrameHistory(characterFrames(source));
    }
  }
});

test("trailing CR remains provisional across every supported block classifier", () => {
  const tails = [
    ["paragraph", "Prose\ncontinuation\r"],
    ["ordered item", "Prose\n1. \r"],
    ["unordered item", "Prose\n- \r"],
    ["heading", "Prose\n#\r"],
    ["fence closer", "```\ncode\n```\r"],
    ["table blank terminator", "| h |\n---\n| body |\n\r"],
    ["thematic break", "Prose\n---\r"],
    ["blank line", "Prose\n\r"],
  ] as const;

  for (const [name, tail] of tails) {
    const provisional = partitionStreamingMarkdown(tail, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(
      provisional.committedBlocks,
      [],
      `${name} committed while its CR could still become CRLF`,
    );
    assertExactCoverage(provisional, tail);

    for (const source of [`${tail}\n`, `${tail}x`]) {
      const frames = characterFrames(source);
      assertCommittedFrameHistory(frames);
      for (const frame of frames) {
        assertExactCoverage(
          partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
          frame,
        );
      }
    }
  }
});

test("paragraph list interruption distinguishes trailing CRLF from literal CR", () => {
  for (const marker of ["1. ", "- "]) {
    const provisionalSource = `Prose\n${marker}\r`;
    const provisional = partitionStreamingMarkdown(provisionalSource, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(provisional.committedBlocks, []);
    assert.equal(md(provisional.activeBlock).source, provisionalSource);

    const crlfSource = `${provisionalSource}\n`;
    const crlf = partitionStreamingMarkdown(crlfSource, { turnId: TURN, settled: false });
    assert.ok(
      crlf.committedBlocks.every((block) => block.source !== "Prose\n"),
      "CRLF must not leave a paragraph commit minted from the provisional CR",
    );
    assertExactCoverage(crlf, crlfSource);

    const literalSource = `${provisionalSource}x`;
    const literal = partitionStreamingMarkdown(literalSource, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(literal.committedBlocks.map((block) => block.source), ["Prose\n"]);
    assert.equal(list(literal.activeBlock).source, `${marker}\rx`);
    assertCommittedFrameHistory(characterFrames(crlfSource));
    assertCommittedFrameHistory(characterFrames(literalSource));
  }
});

test("standalone CR becomes syntax only when LF proves a CRLF terminator", () => {
  const corpus = [
    "- one\n- \r\n",
    "---\r\nTail",
    "```\ncode\n```\r\nTail",
    "| h |\n| --- |\r\n| body |\n\nTail",
    "Prose\n#\r\nTail",
    "Prose\n\r\nTail",
  ];

  for (const source of corpus) {
    const frames = characterFrames(source);
    assertCommittedFrameHistory(frames);
    for (const frame of frames) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }
  }

  const standaloneRule = partitionStreamingMarkdown("---\r", {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(standaloneRule.committedBlocks, []);
  assert.equal(md(standaloneRule.activeBlock).renderMode, "markdown");
  assert.deepEqual(
    partitionStreamingMarkdown("---\r\n", {
      turnId: TURN,
      settled: false,
    }).committedBlocks.map((block) => block.source),
    ["---\r\n"],
  );

  const standaloneHeading = partitionStreamingMarkdown("Prose\n#\r", {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(standaloneHeading.committedBlocks, []);
  assert.equal(md(standaloneHeading.activeBlock).source, "Prose\n#\r");
  assert.deepEqual(
    partitionStreamingMarkdown("Prose\n#\r\n", {
      turnId: TURN,
      settled: false,
    }).committedBlocks.map((block) => block.source),
    ["Prose\n", "#\r\n"],
  );

  const standaloneBlank = partitionStreamingMarkdown("Prose\n\r", {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(standaloneBlank.committedBlocks, []);
  assert.equal(md(standaloneBlank.activeBlock).source, "Prose\n\r");
  assert.deepEqual(
    partitionStreamingMarkdown("Prose\n\r\n", {
      turnId: TURN,
      settled: false,
    }).committedBlocks.map((block) => block.source),
    ["Prose\n\r\n"],
  );
});

test("literal standalone CR cannot act as structural trailing whitespace", () => {
  const invalidRule = "---\r \n";
  const rule = partitionStreamingMarkdown(invalidRule, { turnId: TURN, settled: false });
  assert.deepEqual(rule.committedBlocks, []);
  assert.equal(md(rule.activeBlock).source, invalidRule);
  assertExactCoverage(rule, invalidRule);

  const invalidFence = "```\ncode\n```\r \n";
  const fence = partitionStreamingMarkdown(invalidFence, { turnId: TURN, settled: false });
  assert.deepEqual(fence.committedBlocks, []);
  assert.equal(md(fence.activeBlock).source, invalidFence);
  assertExactCoverage(fence, invalidFence);

  const invalidTable =
    "- one\n- two\n| h |\n| --- |\r \n| body |\n\n";
  const table = partitionStreamingMarkdown(invalidTable, { turnId: TURN, settled: false });
  assert.deepEqual(table.committedBlocks, []);
  assert.equal(list(table.activeBlock).source, invalidTable);
  assertExactCoverage(table, invalidTable);
});

test("standalone CR remains literal before heading, blockquote, fence, and code prefixes", () => {
  for (const source of [
    "Prose\n\r# Heading",
    "Prose\n\r> quote",
  ]) {
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assertExactCoverage(result, source);
  }

  for (const source of ["\r```", "\r    code"]) {
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.equal(md(result.activeBlock).renderMode, "markdown");
    assertExactCoverage(result, source);
  }

  for (const source of ["```", "    code"]) {
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.equal(md(result.activeBlock).renderMode, "plain");
    assertExactCoverage(result, source);
  }
});

test("ASCII spaces and tabs remain valid Markdown structural whitespace", () => {
  for (const source of ["- one", "-\tone", "1. one", "1.\tone"]) {
    assert.equal(
      list(partitionStreamingMarkdown(source, {
        turnId: TURN,
        settled: false,
      }).activeBlock).source,
      source,
    );
  }

  for (const source of ["- - -\n", "-\t-\t-\t\n"]) {
    assert.deepEqual(
      partitionStreamingMarkdown(source, {
        turnId: TURN,
        settled: false,
      }).committedBlocks.map((block) => block.source),
      [source],
    );
  }

  const fence = "```\ncode\n```\t \n";
  assert.deepEqual(
    partitionStreamingMarkdown(fence, {
      turnId: TURN,
      settled: false,
    }).committedBlocks.map((block) => block.source),
    [fence],
  );

  const table = "| h |\n|\t---\t|\n| body |\n\n";
  assert.deepEqual(
    partitionStreamingMarkdown(table, {
      turnId: TURN,
      settled: false,
    }).committedBlocks.map((block) => block.source),
    [table],
  );

  for (const source of ["# Heading\n", "#\tHeading\n", " \t\n"]) {
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.equal(sourcesOf(result.committedBlocks), source);
    assertExactCoverage(result, source);
  }
});

test("CRLF classifier corpus preserves every committed pair and exact source byte", () => {
  const source =
    "- item one\r\n" +
    "- item two\r\n" +
    "# Heading\r\n" +
    "```ts\r\n" +
    "code\r\n" +
    "```\r\n" +
    "| name | value |\r\n" +
    "| --- | :---: |\r\n" +
    "| one | two |\r\n" +
    "\r\n" +
    "Paragraph\r\n" +
    "\r\n" +
    "- - -\r\n" +
    "Tail\rstandalone";
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  for (const frame of frames) {
    assertExactCoverage(
      partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      frame,
    );
  }

  const final = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const committedList = list(final.committedBlocks[0]);
  assert.deepEqual(committedList.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- item one\r\n" },
    { id: `${TURN}:0-item-1`, source: "- item two\r\n" },
  ]);
  assert.equal(sourcesOf([...final.committedBlocks, final.activeBlock!]), source);
});

// ── leading/trailing blank lines, adjacency ─────────────────────────────

test("leading and trailing blank lines concatenate exactly with adjacent blocks", () => {
  const source = "\n\n# Heading\nTail\n\n\n";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(sourcesOf(result.committedBlocks), result.committedText);
  const full = result.activeBlock
    ? sourcesOf([...result.committedBlocks, result.activeBlock])
    : sourcesOf(result.committedBlocks);
  assert.equal(full, source);
});

test("no duplicate or gap bytes across many adjacent block types", () => {
  const source =
    "# Title\n\nIntro paragraph.\n\n> A quote\n> continues\n\n- one\n- two\n\n```js\ncode()\n```\n\nTail";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const full = result.activeBlock
    ? sourcesOf([...result.committedBlocks, result.activeBlock])
    : sourcesOf(result.committedBlocks);
  assert.equal(full, source);
  assert.equal(sourcesOf(result.committedBlocks), result.committedText);
});

// ── document-scoped reference links ──────────────────────────────────────

test("references: a use before its definition keeps the dependent document tail active", () => {
  const source = "[foo]\n\nBody\n\n[foo]: /url\n";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, source);
  assert.equal(md(result.activeBlock).renderMode, "markdown");
  assertExactCoverage(result, source);
});

test("references: a definition before its use keeps the dependent document tail active", () => {
  const source = "[foo]: /url\n\nBody\n\n[foo]";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, source);
  assert.equal(md(result.activeBlock).renderMode, "markdown");
  assertExactCoverage(result, source);
});

for (const [name, use] of [
  ["full link", "[text][label]"],
  ["collapsed link", "[label][]"],
  ["shortcut link", "[label]"],
  ["full image", "![alt][label]"],
  ["collapsed image", "![label][]"],
  ["shortcut image", "![label]"],
] as const) {
  test(`references: ${name} keeps its region and following source active`, () => {
    const source = `${use}\n\nFollowing`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assert.equal(md(result.activeBlock).renderMode, "markdown");
    assertExactCoverage(result, source);
  });
}

test("references: independent blocks before the first reference region stay committed", () => {
  const prefix = "Earlier\n\n";
  const dependent = "[foo]\n\nFollowing\n\n[foo]: /url";
  const source = `${prefix}${dependent}`;
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix]);
  assert.equal(result.committedText, prefix);
  assert.equal(md(result.activeBlock).source, dependent);
  assert.equal(md(result.activeBlock).id, `${TURN}:${prefix.length}-active`);
  assert.equal(md(result.activeBlock).renderMode, "markdown");
  assertExactCoverage(result, source);
});

test("references: escaped and code-literal brackets do not create a dependency hold", () => {
  for (const prefix of [
    "\\[escaped]\n\n",
    "`[inline]` and ``[double]``\n\n",
    "```[info]\n[fenced]\n[fenced]: /url\n```\n",
    "    [indented]\n    [indented]: /url\n\n",
  ]) {
    const source = `${prefix}Tail`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(
      result.committedBlocks.map((block) => block.source),
      [prefix],
      `unexpected dependency hold for ${JSON.stringify(prefix)}`,
    );
    assert.equal(md(result.activeBlock).source, "Tail");
    assertExactCoverage(result, source);
  }
});

test("references: an escaped opening backtick leaves its reference visible", () => {
  const source = "\\`[ref]`\n\nLater\n\n[ref]: /url";
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  for (const frame of frames) {
    assertExactCoverage(
      partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      frame,
    );
  }

  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, source);
  assert.equal(md(result.activeBlock).renderMode, "markdown");
  assertExactCoverage(result, source);
});

test("references: only odd backslash runs escape an opening backtick", () => {
  for (const backslashCount of [1, 2, 3, 4]) {
    const literal = `${"\\".repeat(backslashCount)}\`[ref]\`\n\n`;
    const beforeDefinition = `${literal}Tail\n\n`;
    const definition = "[ref]: /url";
    const source = `${beforeDefinition}${definition}`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    if (backslashCount % 2 === 1) {
      assert.deepEqual(
        result.committedBlocks,
        [],
        `${backslashCount} backslashes should escape the opener`,
      );
      assert.equal(md(result.activeBlock).source, source);
    } else {
      assert.equal(
        result.committedText,
        beforeDefinition,
        `${backslashCount} backslashes should leave the opener active`,
      );
      assert.equal(md(result.activeBlock).source, definition);
    }
    assertExactCoverage(result, source);
  }
});

test("references: inline code cannot close across a blank-line paragraph boundary", () => {
  for (const delimiter of ["`", "``", "```"]) {
    const prefix = "Earlier\n\n";
    const dependent =
      `Paragraph ${delimiter}[inside]\n\n` +
      `continued${delimiter} [outside]\n\n[outside]: /url`;
    const source = `${prefix}${dependent}`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(
      result.committedBlocks.map((block) => block.source),
      [prefix],
      `delimiter width ${delimiter.length} crossed a blank line`,
    );
    assert.equal(md(result.activeBlock).source, dependent);
    assertExactCoverage(result, source);
  }
});

test("references: inline code cannot close across an interrupting block starter", () => {
  const cases = [
    ["ATX heading", "# Heading\ncontinued` [outside]\n"],
    ["eligible list", "- item\n  continued` [outside]\n"],
    ["fence", "~~~\n[fenced]\n~~~\ncontinued` [outside]\n"],
    ["blockquote", "> quote\ncontinued` [outside]\n"],
    ["thematic break", "***\ncontinued` [outside]\n"],
    ["Setext underline", "---\ncontinued` [outside]\n"],
    ["HTML block", "<script>\n[html]\n</script>\ncontinued` [outside]\n"],
  ] as const;

  for (const [name, interruptedTail] of cases) {
    const prefix = "Earlier\n\n";
    const dependent =
      `Paragraph \`[inside]\n${interruptedTail}\n[outside]: /url`;
    const source = `${prefix}${dependent}`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(
      result.committedBlocks.map((block) => block.source),
      [prefix],
      `${name} did not stop the code span`,
    );
    assert.equal(md(result.activeBlock).source, dependent);
    assertExactCoverage(result, source);
  }
});

test("references: closed multiline code spans stay local and close through backslashes", () => {
  for (const delimiter of ["`", "``", "```"]) {
    const literal = `Inline ${delimiter}first line\n[inside]\\${delimiter}\n\n`;
    const ignoredSource = `${literal}Tail`;
    const ignored = partitionStreamingMarkdown(ignoredSource, {
      turnId: TURN,
      settled: false,
    });

    assert.deepEqual(ignored.committedBlocks.map((block) => block.source), [literal]);
    assert.equal(md(ignored.activeBlock).source, "Tail");
    assertExactCoverage(ignored, ignoredSource);

    const prefix = "Earlier\n\n";
    const dependent =
      `Inline ${delimiter}first line\n[inside]\\${delimiter}[outside]\n\n` +
      "Tail\n\n[outside]: /url";
    const source = `${prefix}${dependent}`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix]);
    assert.equal(md(result.activeBlock).source, dependent);
    assertExactCoverage(result, source);
  }
});

test("references: an unmatched opener does not consume a later independent code span", () => {
  const literal = "`unmatched opener\n``[inside]``\n\n";
  const ignoredSource = `${literal}Tail`;
  const ignored = partitionStreamingMarkdown(ignoredSource, {
    turnId: TURN,
    settled: false,
  });

  assert.deepEqual(ignored.committedBlocks.map((block) => block.source), [literal]);
  assert.equal(md(ignored.activeBlock).source, "Tail");
  assertExactCoverage(ignored, ignoredSource);

  const dependent = "`[outside]\n``[inside]``\n\nTail\n\n[outside]: /url";
  const result = partitionStreamingMarkdown(dependent, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, dependent);
  assertExactCoverage(result, dependent);
});

test("references: multiline inline code spans exclude reference-like bytes at original offsets", () => {
  for (const delimiter of ["`", "``"]) {
    const literal = `${delimiter}first line\n[inside]${delimiter}\n\n`;
    const source = `${literal}Tail`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks.map((block) => block.source), [literal]);
    assert.equal(result.committedText, literal);
    assert.equal(md(result.activeBlock).source, "Tail");
    assertExactCoverage(result, source);
  }
});

test("references: unmatched inline-code delimiters are literal", () => {
  for (const source of [
    "`[inside]\n\nTail\n\n[inside]: /url",
    "``[inside]\n\nTail\n\n[inside]: /url",
    "`[inside]``\n\nTail\n\n[inside]: /url",
    "``[inside]`\n\nTail\n\n[inside]: /url",
  ]) {
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assert.equal(md(result.activeBlock).renderMode, "markdown");
    assertExactCoverage(result, source);
    assertCommittedFrameHistory(characterFrames(source));
  }
});

test("references: matching delimiter runs remain code spans when they close at EOF", () => {
  for (const delimiter of ["`", "``", "```"]) {
    const closedAtEof = `${delimiter}[inside]${delimiter}`;
    const closedFrame = partitionStreamingMarkdown(closedAtEof, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(closedFrame.committedBlocks, []);
    assert.equal(md(closedFrame.activeBlock).source, closedAtEof);

    const prefix = `${closedAtEof}\n\n`;
    const source = `${prefix}Tail\n\n[inside]: /url`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(
      result.committedBlocks.map((block) => block.source),
      [prefix, "Tail\n\n"],
    );
    assert.equal(md(result.activeBlock).source, "[inside]: /url");
    assertExactCoverage(result, source);
    assertCommittedFrameHistory(characterFrames(source));
  }
});

test("references: a reference immediately after a multiline code-span close is recognized", () => {
  for (const delimiter of ["`", "``"]) {
    const prefix = "Earlier\n\n";
    const dependent = `${delimiter}first line\ncontinued${delimiter}[outside]\n\nTail`;
    const source = `${prefix}${dependent}`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix]);
    assert.equal(md(result.activeBlock).source, dependent);
    assertExactCoverage(result, source);
  }
});

test("references: code-span brackets do not terminate an enclosing inline link label", () => {
  for (const inlineLink of ["[`inside]`](url)", "[``inside]``](url)"]) {
    const literal = `${inlineLink}\n\n`;
    const source = `${literal}Tail`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks.map((block) => block.source), [literal]);
    assert.equal(md(result.activeBlock).source, "Tail");
    assertExactCoverage(result, source);
  }
});

test("references: syntactically valid inline destinations and titles suppress shortcut holds", () => {
  for (const inlineLink of [
    "[foo](bare)",
    "[foo](bare\\!punctuation)",
    "[foo](bare\\)punctuation)",
    "[foo](nested(and(deeper)))",
    "[foo](<angle destination>)",
    "[foo](destination \"quoted title\")",
    "[foo](destination 'single title')",
    "[foo](destination (paren title))",
  ]) {
    const prefix = `${inlineLink}\n\n`;
    const source = `${prefix}Tail`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(
      result.committedBlocks.map((block) => block.source),
      [prefix],
      `valid inline link held ${JSON.stringify(inlineLink)}`,
    );
    assert.equal(md(result.activeBlock).source, "Tail");
    assertExactCoverage(result, source);
  }
});

test("references: an inline-link label retains a nested image reference dependency", () => {
  const firstItem = "- first\n";
  const dependent =
    "- [![alt][img]](/url)\n\nFollowing\n\n[img]: /asset";
  const source = `${firstItem}${dependent}`;
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks.map((block) => block.source), [firstItem]);
  assert.equal(md(result.activeBlock).source, dependent);
  assert.equal(md(result.activeBlock).renderMode, "markdown");
  assert.equal(result.committedText, firstItem);
  assertExactCoverage(result, source);
  assertCommittedFrameHistory(characterFrames(source));
});

for (const [name, nested] of [
  ["collapsed", "[inner][]"],
  ["shortcut", "[inner]"],
] as const) {
  test(`references: an inline-link label retains a nested ${name} dependency`, () => {
    const prefix = "Earlier\n\n";
    const dependent =
      `[outer ${nested} label](/url)\n\nFollowing\n\n[inner]: /asset`;
    const source = `${prefix}${dependent}`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix]);
    assert.equal(md(result.activeBlock).source, dependent);
    assertExactCoverage(result, source);
  });
}

test("references: nested inline links without references remain independent", () => {
  const prefix = "[outer [inner](/inner)](/outer)\n\n";
  const source = `${prefix}Tail`;
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix]);
  assert.equal(md(result.activeBlock).source, "Tail");
  assertExactCoverage(result, source);
});

test("references: nested references hold paragraph definitions before and after their use", () => {
  for (const dependent of [
    "[![alt][img]](/url)\n\nFollowing\n\n[img]: /asset",
    "[img]: /asset\n\n[![alt][img]](/url)\n\nFollowing",
  ]) {
    const prefix = "Earlier\n\n";
    const source = `${prefix}${dependent}`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix]);
    assert.equal(md(result.activeBlock).source, dependent);
    assertExactCoverage(result, source);
  }
});

test("references: escapes and code spans inside inline-link labels remain literal", () => {
  const prefix = "[outer \\[escaped\\] and `[code]`](/url)\n\n";
  const source = `${prefix}Tail`;
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix]);
  assert.equal(md(result.activeBlock).source, "Tail");
  assertExactCoverage(result, source);
});

test("references: deeply nested inline labels are processed without recursive growth", () => {
  const depth = 12_000;
  const prefix = `${"[".repeat(depth)}leaf${"](/url)".repeat(depth)}\n\n`;
  const source = `${prefix}Tail`;
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix]);
  assert.equal(md(result.activeBlock).source, "Tail");
  assertExactCoverage(result, source);
});

test("references: invalid inline suffixes leave their labels shortcut-dependent", () => {
  for (const invalid of [
    "[foo](bare space)",
    "[foo](bare\\ space)",
    "[foo](bare\\\tspace)",
    "[foo](bare\\\nspace)",
    "[foo](bare\\\u0001control)",
    "[foo](bare\\\u007fcontrol)",
    "[foo](<bad<angle>)",
    "[foo](<unterminated)",
    "[foo](destination \"unterminated)",
    "[foo](destination \"title\" garbage)",
    "[foo](nested(unbalanced)",
  ]) {
    const prefix = "Earlier\n\n";
    const dependent = `${invalid}\n\nLater\n\n[foo]: /url`;
    const source = `${prefix}${dependent}`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(
      result.committedBlocks.map((block) => block.source),
      [prefix],
      `invalid inline suffix hid ${JSON.stringify(invalid)}`,
    );
    assert.equal(md(result.activeBlock).source, dependent);
    assertExactCoverage(result, source);
    assertCommittedFrameHistory(characterFrames(source));
  }
});

for (const [name, use] of [
  ["shortcut", "[label]"],
  ["full", "[text][label]"],
] as const) {
  test(`references: ordinary list ${name} use holds its item and following document tail`, () => {
    const firstItem = "- first\n";
    const dependent = `- ${use}\n\nFollowing\n\n[label]: /url`;
    const source = `${firstItem}${dependent}`;
    const streaming = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.equal(streaming.committedBlocks.length, 1);
    const committedList = list(streaming.committedBlocks[0]);
    assert.equal(committedList.id, `${TURN}:0-list`);
    assert.equal(committedList.source, firstItem);
    assert.deepEqual(committedList.committedItems, [
      { id: `${TURN}:0-item-0`, source: firstItem },
    ]);
    assert.equal(committedList.activeItem, undefined);
    assert.equal(md(streaming.activeBlock).source, dependent);
    assert.equal(md(streaming.activeBlock).id, `${TURN}:${firstItem.length}-active`);
    assert.equal(md(streaming.activeBlock).renderMode, "markdown");
    assertExactCoverage(streaming, source);
    assertCommittedFrameHistory(characterFrames(source));

    const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
    assert.equal(settled.activeBlock, null);
    assert.equal(settled.committedText, source);
    assert.deepEqual(settled.committedBlocks.map((block) => block.source), [
      firstItem,
      dependent,
    ]);
    assert.deepEqual(list(settled.committedBlocks[0]), committedList);
    assert.equal(md(settled.committedBlocks[1]).renderMode, "markdown");
    assertExactCoverage(settled, source);
  });
}

test("references: list marker padding boundary distinguishes prose from residual code", () => {
  for (let spaces = 1; spaces <= 6; spaces++) {
    const item = `-${" ".repeat(spaces)}[label]: /url\n\n`;
    const source = `${item}Tail`;
    const result = partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: false,
    });

    if (spaces <= 4) {
      assert.deepEqual(result.committedBlocks, [], `${spaces} spaces`);
      assert.equal(md(result.activeBlock).source, source, `${spaces} spaces`);
    } else {
      assert.equal(result.committedText, item, `${spaces} spaces`);
      assert.equal(sourcesOf(result.committedBlocks), item, `${spaces} spaces`);
      const committedList = list(result.committedBlocks[0]);
      assert.equal(committedList.source, item.slice(0, -1), `${spaces} spaces`);
      assert.deepEqual(committedList.committedItems, [
        { id: `${TURN}:0-item-0`, source: item.slice(0, -1) },
      ]);
      assert.equal(md(result.activeBlock).source, "Tail", `${spaces} spaces`);
    }
    assertExactCoverage(result, source);
    assertCommittedFrameHistory(characterFrames(source));
  }
});

for (const [name, item] of [
  ["bullet marker", "-     [literal]"],
  ["ordered marker", "1.     [literal]"],
  ["tab plus spaces", "-\t  [literal]"],
  ["ordered tab plus spaces", "10.\t    [literal]"],
] as const) {
  test(`references: same-line residual indentation is code for ${name}`, () => {
    const prefix = `${item}\n\n`;
    const source = `${prefix}Tail`;
    const result = partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: false,
    });

    assert.equal(result.committedText, prefix);
    assert.equal(sourcesOf(result.committedBlocks), prefix);
    assert.equal(md(result.activeBlock).source, "Tail");
    assertExactCoverage(result, source);
    assertCommittedFrameHistory(characterFrames(source));
  });
}

for (const [name, item] of [
  ["bullet tab", "-\t[label]: /url"],
  ["mixed bullet padding", "- \t[label]: /url"],
  ["ordered tab", "10.\t[label]: /url"],
  ["ordered four-space padding", "10.    [label]: /url"],
] as const) {
  test(`references: normal tab-stop list padding remains prose for ${name}`, () => {
    const source = `${item}\n\nTail`;
    const result = partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: false,
    });

    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assertExactCoverage(result, source);
    assertCommittedFrameHistory(characterFrames(source));
  });
}

test("references: a definition in ordinary list prose holds through its later use", () => {
  const firstItem = "- first\n";
  const dependent = "- [label]: /url\n\nFollowing\n\n[label]";
  const source = `${firstItem}${dependent}`;
  const streaming = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  const committedList = list(streaming.committedBlocks[0]);
  assert.equal(committedList.source, firstItem);
  assert.deepEqual(committedList.committedItems, [
    { id: `${TURN}:0-item-0`, source: firstItem },
  ]);
  assert.equal(committedList.activeItem, undefined);
  assert.equal(md(streaming.activeBlock).source, dependent);
  assertExactCoverage(streaming, source);
  assertCommittedFrameHistory(characterFrames(source));

  const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
  assert.equal(settled.activeBlock, null);
  assert.equal(settled.committedText, source);
  assert.deepEqual(settled.committedBlocks.map((block) => block.source), [
    firstItem,
    dependent,
  ]);
  assert.deepEqual(list(settled.committedBlocks[0]), committedList);
  assert.equal(md(settled.committedBlocks[1]).renderMode, "markdown");
  assertExactCoverage(settled, source);
});

for (const {
  name,
  firstItem,
  dependent,
  start,
} of [
  {
    name: "unordered use before definition",
    firstItem: "- first\n",
    dependent: "- [second]\n\nFollowing\n\n[second]: /url",
    start: undefined,
  },
  {
    name: "ordered use before definition",
    firstItem: "1. first\n",
    dependent: "2. [second]\n\nFollowing\n\n[second]: /url",
    start: 1,
  },
  {
    name: "unordered definition before use",
    firstItem: "- first\n",
    dependent: "- [second]: /url\n\nFollowing\n\n[second]",
    start: undefined,
  },
  {
    name: "ordered definition before use",
    firstItem: "1. first\n",
    dependent: "2. [second]: /url\n\nFollowing\n\n[second]",
    start: 1,
  },
] as const) {
  test(`references: ${name} isolates the dependent list suffix as Markdown`, () => {
    const source = `${firstItem}${dependent}`;
    const frames = characterFrames(source);
    assertCommittedFrameHistory(frames);
    for (const frame of frames) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }

    const streaming = partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: false,
    });
    assert.equal(streaming.committedBlocks.length, 1);
    const prior = list(streaming.committedBlocks[0]);
    assert.equal(prior.id, `${TURN}:0-list`);
    assert.equal(prior.source, firstItem);
    assert.equal(prior.start, start);
    assert.deepEqual(prior.committedItems, [
      { id: `${TURN}:0-item-0`, source: firstItem },
    ]);
    assert.equal(prior.activeItem, undefined);

    const active = md(streaming.activeBlock);
    assert.equal(active.id, `${TURN}:${firstItem.length}-active`);
    assert.equal(active.source, dependent);
    assert.equal(active.renderMode, "markdown");
    assert.ok(active.source.includes("\n\nFollowing\n\n"));
    assert.equal(streaming.committedText, firstItem);

    const settled = partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: true,
    });
    assert.equal(settled.activeBlock, null);
    assert.deepEqual(settled.committedBlocks.map((block) => block.source), [
      firstItem,
      dependent,
    ]);
    assert.deepEqual(list(settled.committedBlocks[0]), prior);
    const resolved = md(settled.committedBlocks[1]);
    assert.equal(resolved.id, `${TURN}:${firstItem.length}-${source.length}`);
    assert.equal(resolved.renderMode, "markdown");
    assert.equal(settled.committedText, source);
    assertExactCoverage(settled, source);
  });
}

test("references: a dependency in the first list item keeps the whole tail as Markdown", () => {
  for (const source of [
    "- [first]\n\nFollowing\n\n[first]: /url",
    "7. [first]: /url\n\nFollowing\n\n[first]",
  ]) {
    const streaming = partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(streaming.committedBlocks, []);
    assert.equal(md(streaming.activeBlock).source, source);
    assert.equal(md(streaming.activeBlock).renderMode, "markdown");
    assertExactCoverage(streaming, source);

    const settled = partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: true,
    });
    assert.equal(settled.activeBlock, null);
    assert.equal(settled.committedBlocks.length, 1);
    assert.equal(md(settled.committedBlocks[0]).source, source);
    assert.equal(settled.committedText, source);
  }
});

test("references: nested backtick and tilde list fences keep brackets literal", () => {
  for (const fence of ["```", "~~~"]) {
    const literal =
      `- first\n- code\n  ${fence}\n  [literal]\n  [literal]: /url\n  ${fence}\n\n`;
    const source = `${literal}Tail`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.equal(result.committedText, literal);
    assert.equal(sourcesOf(result.committedBlocks), literal);
    assert.equal(list(result.committedBlocks[0]).source, literal.slice(0, -1));
    assert.equal(md(result.activeBlock).source, "Tail");
    assertExactCoverage(result, source);
  }
});

test("references: a list-item fence closes before following continuation prose", () => {
  const fenceOnly = "- ```\n  [literal]\n  ```\n\n";
  const ignored = partitionStreamingMarkdown(`${fenceOnly}Tail`, {
    turnId: TURN,
    settled: false,
  });
  assert.equal(ignored.committedText, fenceOnly);
  assert.equal(md(ignored.activeBlock).source, "Tail");
  assertExactCoverage(ignored, `${fenceOnly}Tail`);

  const source =
    "- ```\n  [literal]\n  ```\n  [prose]\n\n[prose]: /url";
  const streaming = partitionStreamingMarkdown(source, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(streaming.committedBlocks, []);
  assert.equal(md(streaming.activeBlock).source, source);
  assert.equal(md(streaming.activeBlock).renderMode, "markdown");
  assertExactCoverage(streaming, source);
  assertCommittedFrameHistory(characterFrames(source));

  const settled = partitionStreamingMarkdown(source, {
    turnId: TURN,
    settled: true,
  });
  assert.equal(settled.activeBlock, null);
  assert.equal(settled.committedText, source);
  assert.equal(md(settled.committedBlocks[0]).source, source);
  assert.equal(md(settled.committedBlocks[0]).renderMode, "markdown");
  assertExactCoverage(settled, source);
});

test("references: a wider tilde list fence ignores shorter and different-character runs", () => {
  const fence =
    "- ~~~~\n" +
    "  [literal]\n" +
    "  ~~~\n" +
    "  [still literal]\n" +
    "  ````\n" +
    "  [also literal]\n" +
    "  ~~~~~\n";
  const ignored = partitionStreamingMarkdown(`${fence}\nTail`, {
    turnId: TURN,
    settled: false,
  });
  assert.equal(ignored.committedText, `${fence}\n`);
  assert.equal(md(ignored.activeBlock).source, "Tail");
  assertExactCoverage(ignored, `${fence}\nTail`);

  const dependent = "  [outside]\n\n[outside]: /url";
  const source = `${fence}${dependent}`;
  const streaming = partitionStreamingMarkdown(source, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(streaming.committedBlocks, []);
  assert.equal(md(streaming.activeBlock).source, source);
  assert.equal(md(streaming.activeBlock).renderMode, "markdown");
  assertExactCoverage(streaming, source);
});

test("references: ordered and quoted list-item fences close at their container boundary", () => {
  const ordered = "1. ```\n   [literal]\n   ```\n   [outside]\n\n[outside]: /url";
  const orderedResult = partitionStreamingMarkdown(ordered, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(orderedResult.committedBlocks, []);
  assert.equal(md(orderedResult.activeBlock).source, ordered);
  assert.equal(md(orderedResult.activeBlock).renderMode, "markdown");
  assertExactCoverage(orderedResult, ordered);

  const widePrefix = "10. ```\n    [literal]\n    ```\n\n";
  const wideDependent = "[outside]\n\n[outside]: /url";
  const wideSource = `${widePrefix}${wideDependent}`;
  const wideResult = partitionStreamingMarkdown(wideSource, {
    turnId: TURN,
    settled: false,
  });
  assert.equal(wideResult.committedText, widePrefix);
  assert.equal(md(wideResult.activeBlock).source, wideDependent);
  assertExactCoverage(wideResult, wideSource);

  for (const source of [
    "> ```\n> [literal]\n> ```\n> [outside]\n\n[outside]: /url",
    "> - ```\n>   [literal]\n>   ```\n>   [outside]\n\n[outside]: /url",
  ]) {
    const result = partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assertExactCoverage(result, source);
    assertCommittedFrameHistory(characterFrames(source));
  }
});

test("references: an unclosed list-item fence protects every later byte", () => {
  const protectedPrefix = "- ```\n  [inside]\n\n[later]\n\n";
  const source = `${protectedPrefix}Tail [later]: /url`;
  const result = partitionStreamingMarkdown(source, {
    turnId: TURN,
    settled: false,
  });

  assert.equal(result.committedText, protectedPrefix);
  assert.equal(md(result.activeBlock).source, "Tail [later]: /url");
  assertExactCoverage(result, source);
});

test("references: multiline inline code remains excluded after local fences are masked", () => {
  const prefix = "- ```\n  [fenced]\n  ```\n\n";
  const inline = "`first line\n[inline]`\n\n";
  const dependent = "[outside]\n\n[outside]: /url";
  const source = `${prefix}${inline}${dependent}`;
  const result = partitionStreamingMarkdown(source, {
    turnId: TURN,
    settled: false,
  });

  assert.equal(result.committedText, `${prefix}${inline}`);
  assert.equal(md(result.activeBlock).source, dependent);
  assertExactCoverage(result, source);
});

test("references: residual list code backticks cannot hide following prose", () => {
  for (const indentation of ["     ", "      ", "\t  "]) {
    for (const code of ["`", "`matched`"]) {
      const source = `-${indentation}${code}\n  [outside]\n\n[outside]: /url`;
      const frames = characterFrames(source);

      assertCommittedFrameHistory(frames);
      for (const frame of frames) {
        assertExactCoverage(
          partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
          frame,
        );
      }

      const result = partitionStreamingMarkdown(source, {
        turnId: TURN,
        settled: false,
      });
      assert.deepEqual(result.committedBlocks, []);
      assert.equal(md(result.activeBlock).source, source);
      assert.equal(md(result.activeBlock).renderMode, "markdown");
    }
  }
});

test("references: top-level and nested indented code backticks end before prose", () => {
  for (const source of [
    "    `\n[outside]\n\n[outside]: /url",
    "\t`matched`\r\n[outside]\r\n\r\n[outside]: /url",
    "- outer\n  -     `\n    [outside]\n\n[outside]: /url",
    "- outer\r\n\t-\t  `matched`\r\n\t  [outside]\r\n\r\n[outside]: /url",
  ]) {
    const frames = characterFrames(source);
    assertCommittedFrameHistory(frames);
    for (const frame of frames) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }

    const result = partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: false,
    });
    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assert.equal(md(result.activeBlock).renderMode, "markdown");
  }
});

test("references: brackets and backticks inside indented code remain literal", () => {
  for (const literal of [
    "    `[inside]\n\n",
    "\t`[inside]`\r\n\r\n",
    "-     `[inside]\n\n",
    "-      `[inside]`\n\n",
    "- outer\n  -\t      `[inside]\n\n",
  ]) {
    const source = `${literal}Tail`;
    const frames = characterFrames(source);

    assertCommittedFrameHistory(frames);
    for (const frame of frames) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }

    const result = partitionStreamingMarkdown(source, {
      turnId: TURN,
      settled: false,
    });
    assert.equal(result.committedText, literal);
    assert.equal(sourcesOf(result.committedBlocks), literal);
    assert.equal(md(result.activeBlock).source, "Tail");
  }
});

test("references: ordered starts above one inside a paragraph do not open tilde fences", () => {
  const prefix = "Earlier\n\n";
  const dependent = "Paragraph\n2. ~~~\n[outside]\n\n[outside]: /url";
  const source = `${prefix}${dependent}`;
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  for (const frame of frames) {
    assertExactCoverage(
      partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      frame,
    );
  }

  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix]);
  assert.equal(result.committedText, prefix);
  assert.equal(md(result.activeBlock).source, dependent);
});

test("references: paragraph-owned backticks use multiline inline-code ranges", () => {
  const prefix = "Earlier\n\n";
  const inline = "Paragraph\n2. ```ts\n[inside]```\n\n";
  const dependent = "[outside]\n\n[outside]: /url";
  const source = `${prefix}${inline}${dependent}`;
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  for (const frame of frames) {
    assertExactCoverage(
      partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      frame,
    );
  }

  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix, inline]);
  assert.equal(result.committedText, `${prefix}${inline}`);
  assert.equal(md(result.activeBlock).source, dependent);
});

test("references: paragraph-interrupting and boundary list fences stay excluded", () => {
  const cases = [
    "Paragraph\n1. ~~~\n   [literal]\n   [literal]: /url\n   ~~~\n\n",
    "Paragraph\n- ~~~\n  [literal]\n  [literal]: /url\n  ~~~\n\n",
    "Paragraph\n\n2. ~~~\n   [literal]\n   [literal]: /url\n   ~~~\n\n",
  ];

  for (const literal of cases) {
    const source = `${literal}Tail`;
    const frames = characterFrames(source);
    assertCommittedFrameHistory(frames);
    for (const frame of frames) {
      assertExactCoverage(
        partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
        frame,
      );
    }

    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.equal(result.committedText, literal);
    assert.equal(md(result.activeBlock).source, "Tail");
  }
});

test("references: nested ordered fences remain owned by an existing list", () => {
  const literal =
    "- first\n  2. ~~~\n     [literal]\n     [literal]: /url\n     ~~~\n\n";
  const source = `${literal}Tail`;
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  for (const frame of frames) {
    assertExactCoverage(
      partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      frame,
    );
  }

  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedText, literal);
  assert.equal(list(result.committedBlocks[0]).source, literal.slice(0, -1));
  assert.equal(md(result.activeBlock).source, "Tail");
});

for (const {
  name,
  firstItem,
  dependentItem,
} of [
  {
    name: "bullet with four absolute spaces",
    firstItem: "- first\n",
    dependentItem: "- code\n    [ref]\n",
  },
  {
    name: "wide ordered marker",
    firstItem: "1. first\n",
    dependentItem: "10. code\n    [ref]\n",
  },
  {
    name: "tab-indented marker content",
    firstItem: "-\tfirst\n",
    dependentItem: "-\tcode\n\t[ref]\n",
  },
  {
    name: "code-sized indentation before any blank",
    firstItem: "- first\n",
    dependentItem: "- code\n      [ref]\n",
  },
  {
    name: "insufficient relative code indentation after a blank",
    firstItem: "- first\n",
    dependentItem: "- code\n\n    [ref]\n",
  },
] as const) {
  test(`references: list paragraph continuation recognizes ${name}`, () => {
    const dependent = `${dependentItem}\nFollowing\n\n[ref]: /url`;
    const source = `${firstItem}${dependent}`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.equal(result.committedBlocks.length, 1);
    const prior = list(result.committedBlocks[0]);
    assert.equal(prior.source, firstItem);
    assert.deepEqual(prior.committedItems, [
      { id: `${TURN}:0-item-0`, source: firstItem },
    ]);
    assert.equal(md(result.activeBlock).source, dependent);
    assert.equal(md(result.activeBlock).renderMode, "markdown");
    assertExactCoverage(result, source);
    assertCommittedFrameHistory(characterFrames(source));
  });
}

test("references: paragraph continuation after initial indented code triggers a dependency hold", () => {
  const source = "    code\nparagraph\n    [ref]\n\nTail\n\n[ref]: /url";

  assertCommittedFrameHistory(characterFrames(source));
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, source);
  assert.equal(md(result.activeBlock).renderMode, "markdown");
  assertExactCoverage(result, source);
});

test("references: nested list indentation uses the innermost item for dependency holds", () => {
  const source = "- outer\n  - nested\n\n      [ref]\n\nTail\n\n[ref]: /url";

  assertCommittedFrameHistory(characterFrames(source));
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, source);
  assert.equal(md(result.activeBlock).renderMode, "markdown");
  assertExactCoverage(result, source);
});

test("references: indented-code transitions preserve CRLF and tab-stop columns", () => {
  const source = "\tcode\r\nparagraph\r\n\t[ref]\r\n\r\nTail\r\n\r\n[ref]: /url";

  assertCommittedFrameHistory(characterFrames(source));
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, source);
  assertExactCoverage(result, source);
});

test("references: a blank after paragraph continuation permits new indented code", () => {
  for (const literal of [
    "    code\nparagraph\n\n    [literal]\n\n",
    "\tcode\r\nparagraph\r\n\r\n\t[literal]\r\n\r\n",
  ]) {
    const source = `${literal}Tail`;

    assertCommittedFrameHistory(characterFrames(source));
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.equal(result.committedText, literal);
    assert.equal(sourcesOf(result.committedBlocks), literal);
    assert.equal(md(result.activeBlock).source, "Tail");
    assertExactCoverage(result, source);
  }
});

test("references: residual marker padding does not inflate continuation code indentation", () => {
  const literal =
    "-     first literal\n\n" +
    "      [second literal]\n" +
    "      [second literal]: /url\n\n";
  const source = `${literal}Tail`;

  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.equal(result.committedText, literal);
  assert.equal(sourcesOf(result.committedBlocks), literal);
  assert.equal(md(result.activeBlock).source, "Tail");
  assertExactCoverage(result, source);
  assertCommittedFrameHistory(characterFrames(source));
});

for (const [name, source] of [
  [
    "tab-indented CRLF markers",
    "- outer\r\n\t- nested\r\n\r\n\t\t[ref]\r\n\r\nTail\r\n\r\n[ref]: /url",
  ],
  [
    "ordered nested markers",
    "- outer\n  10. nested\n\n        [ref]\n\nTail\n\n[ref]: /url",
  ],
] as const) {
  test(`references: innermost list content indentation handles ${name}`, () => {
    assertCommittedFrameHistory(characterFrames(source));
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.deepEqual(result.committedBlocks, []);
    assert.equal(md(result.activeBlock).source, source);
    assert.equal(md(result.activeBlock).renderMode, "markdown");
    assertExactCoverage(result, source);
  });
}

test("references: a nested peer replaces the prior item indentation state", () => {
  const source =
    "- outer\n  - narrow\n  10. wide\n\n        [ref]\n\nTail\n\n[ref]: /url";

  assertCommittedFrameHistory(characterFrames(source));
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, source);
  assertExactCoverage(result, source);
});

test("references: an outer peer pops nested indentation state", () => {
  const literal = "- outer\n  10. nested\n- peer\n\n      [literal]\n\n";
  const source = `${literal}Tail`;

  assertCommittedFrameHistory(characterFrames(source));
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.equal(result.committedText, literal);
  assert.equal(sourcesOf(result.committedBlocks), literal);
  assert.equal(md(result.activeBlock).source, "Tail");
  assertExactCoverage(result, source);
});

test("references: outdented continuation prose pops to its owning list item", () => {
  const literal =
    "- outer\n  10. nested\n\n  outer paragraph\n\n      [literal]\n\n";
  const source = `${literal}Tail`;

  assertCommittedFrameHistory(characterFrames(source));
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.equal(result.committedText, literal);
  assert.equal(sourcesOf(result.committedBlocks), literal);
  assert.equal(md(result.activeBlock).source, "Tail");
  assertExactCoverage(result, source);
});

test("references: sufficient indentation after a nested blank remains literal code", () => {
  for (const literal of [
    "- outer\n  - nested\n\n        [literal]\n\n",
    "- outer\r\n\t- nested\r\n\r\n\t\t  [literal]\r\n\r\n",
  ]) {
    const source = `${literal}Tail`;

    assertCommittedFrameHistory(characterFrames(source));
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.equal(result.committedText, literal);
    assert.equal(sourcesOf(result.committedBlocks), literal);
    assert.equal(md(result.activeBlock).source, "Tail");
    assertExactCoverage(result, source);
  }
});

test("references: deeply nested list indentation is analyzed iteratively and linearly", () => {
  const depth = 2_000;
  const independent = Array.from(
    { length: depth },
    (_, index) => `${"  ".repeat(index)}- item\n`,
  ).join("");
  const dependent = "- [ref]\n\nTail\n\n[ref]: /url";
  const source = `${independent}${dependent}`;
  const diagnostics = {
    referenceAnalysisOperations: 0,
    referenceCodeRangeBuilds: 0,
  };
  const result = partitionStreamingMarkdown(source, {
    turnId: TURN,
    settled: false,
    referenceAnalysisDiagnostics: diagnostics,
  });

  assert.equal(result.committedBlocks.length, 1);
  assert.equal(list(result.committedBlocks[0]).source, independent);
  assert.equal(md(result.activeBlock).source, dependent);
  assert.equal(diagnostics.referenceCodeRangeBuilds, 1);
  const lineCount = depth + 5;
  assert.ok(
    diagnostics.referenceAnalysisOperations <= lineCount * 10,
    `reference analysis used ${diagnostics.referenceAnalysisOperations} operations for ${lineCount} deeply nested lines`,
  );
  assertExactCoverage(result, source);
});

for (const {
  name,
  firstItem,
  codeItem,
  codeIndent,
} of [
  {
    name: "bullet marker",
    firstItem: "- first\n",
    codeItem: "- code\n",
    codeIndent: "      ",
  },
  {
    name: "wide ordered marker",
    firstItem: "1. first\n",
    codeItem: "10. code\n",
    codeIndent: "        ",
  },
  {
    name: "tab-expanded marker",
    firstItem: "-\tfirst\n",
    codeItem: "-\tcode\n",
    codeIndent: "\t\t",
  },
] as const) {
  test(`references: relative indented code after a blank ignores brackets for a ${name}`, () => {
    const literal =
      `${firstItem}${codeItem}\n` +
      `${codeIndent}[literal]\n` +
      `${codeIndent}[literal]: /url\n\n`;
    const source = `${literal}Tail`;
    const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

    assert.equal(result.committedText, literal);
    assert.equal(sourcesOf(result.committedBlocks), literal);
    assert.equal(list(result.committedBlocks[0]).source, literal.slice(0, -1));
    assert.equal(md(result.activeBlock).source, "Tail");
    assertExactCoverage(result, source);
    assertCommittedFrameHistory(characterFrames(source));
  });
}

test("references: structurally unsafe dependent tails remain plain while active", () => {
  const source = "[foo]\n\n```ts\nunclosed";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });

  assert.deepEqual(result.committedBlocks, []);
  assert.equal(md(result.activeBlock).source, source);
  assert.equal(md(result.activeBlock).renderMode, "plain");
  assertExactCoverage(result, source);
});

test("references: frame history never exposes or revokes blocks inside the dependent region", () => {
  const prefix = "Earlier\n\n";
  const source = `${prefix}[foo]\n\nLater\n\n[foo]: /url`;
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  for (const frame of frames.slice(prefix.length + "[foo]".length - 1)) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    assert.deepEqual(result.committedBlocks.map((block) => block.source), [prefix]);
    assert.equal(md(result.activeBlock).source, frame.slice(prefix.length));
    assertExactCoverage(result, frame);
  }
});

test("references: a dependent list region keeps independent preceding items committed", () => {
  const source = "- first\n- [second]\n\n[second]: /url";
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 1);
  const committed = list(result.committedBlocks[0]);
  assert.equal(committed.source, "- first\n");
  assert.deepEqual(committed.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- first\n" },
  ]);
  assert.equal(committed.activeItem, undefined);
  assert.equal(md(result.activeBlock).source, "- [second]\n\n[second]: /url");
  assertExactCoverage(result, source);
});

test("references: a dependency discovered in a list continuation never revokes prior items", () => {
  const source = "- first\n- second\n  [ref]\n\n[ref]: /url";
  const frames = characterFrames(source);

  assertCommittedFrameHistory(frames);
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  assert.equal(result.committedBlocks.length, 1);
  const committed = list(result.committedBlocks[0]);
  assert.equal(committed.source, "- first\n");
  assert.deepEqual(committed.committedItems, [
    { id: `${TURN}:0-item-0`, source: "- first\n" },
  ]);
  assert.equal(committed.activeItem, undefined);
  assert.equal(md(result.activeBlock).source, "- second\n  [ref]\n\n[ref]: /url");
  assertExactCoverage(result, source);
});

test("references: settlement commits the exact dependent region as Markdown", () => {
  const prefix = "Earlier\r\n\r\n";
  const dependent = "[foo]\r\n\r\n[foo]: /url\r\n";
  const source = `${prefix}${dependent}`;
  const streaming = partitionStreamingMarkdown(source, {
    turnId: TURN,
    settled: false,
  });
  assert.deepEqual(streaming.committedBlocks.map((block) => block.source), [prefix]);
  assert.equal(md(streaming.activeBlock).source, dependent);

  const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
  assert.equal(settled.activeBlock, null);
  assert.deepEqual(settled.committedBlocks.map((block) => block.source), [
    prefix,
    dependent,
  ]);
  assert.equal(md(settled.committedBlocks[1]).renderMode, "markdown");
  assert.equal(settled.committedText, source);
  assertExactCoverage(settled, source);
});

test("references: exclusion analysis is skipped without brackets and linear with a candidate", () => {
  const blockCount = 8_000;
  const withoutBrackets = Array.from(
    { length: blockCount },
    (_, index) => `block ${index}\n\n`,
  ).join("");
  const noBracketDiagnostics = {
    referenceAnalysisOperations: 0,
    referenceCodeRangeBuilds: 0,
  };
  const noBracketOptions = {
    turnId: TURN,
    settled: false,
    referenceAnalysisDiagnostics: noBracketDiagnostics,
  };
  const noBracketResult = partitionStreamingMarkdown(withoutBrackets, noBracketOptions);
  assert.equal(noBracketResult.committedBlocks.length, blockCount);
  assert.equal(noBracketDiagnostics.referenceCodeRangeBuilds, 0);
  assert.ok(noBracketDiagnostics.referenceAnalysisOperations <= 1);

  const withBracket = `${withoutBrackets}[reference]`;
  const bracketDiagnostics = {
    referenceAnalysisOperations: 0,
    referenceCodeRangeBuilds: 0,
  };
  const bracketOptions = {
    turnId: TURN,
    settled: false,
    referenceAnalysisDiagnostics: bracketDiagnostics,
  };
  const bracketResult = partitionStreamingMarkdown(withBracket, bracketOptions);
  assert.equal(bracketDiagnostics.referenceCodeRangeBuilds, 1);
  assert.ok(bracketDiagnostics.referenceAnalysisOperations > 0);
  const lineCount = blockCount * 2 + 1;
  assert.ok(
    bracketDiagnostics.referenceAnalysisOperations <= lineCount * 6,
    `reference analysis used ${bracketDiagnostics.referenceAnalysisOperations} operations for ${lineCount} lines`,
  );
  assertExactCoverage(bracketResult, withBracket);
});

// ── settlement ───────────────────────────────────────────────────────────

test("settlement: commits the remaining tail verbatim and preserves every byte", () => {
  const source =
    "# Result\n\nParagraph.\n\n- one\n- two\n\n```ts\nconst x = 1\n```";
  const result = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
  assert.equal(result.activeBlock, null);
  assert.equal(sourcesOf(result.committedBlocks), source);
  assert.equal(result.committedText, source);
  for (const block of result.committedBlocks) {
    if (block.kind === "markdown") {
      assert.equal(block.renderMode, "markdown");
    }
  }
});

test("settlement: ambiguous list and table tails become markdown", () => {
  for (const source of [
    "- one\n  continuation",
    "| h |\n| --- |\n",
  ]) {
    const streaming = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
    assert.deepEqual(streaming.committedBlocks, []);
    assert.equal(md(streaming.activeBlock).source, source);
    assert.equal(md(streaming.activeBlock).renderMode, "plain");

    const settled = partitionStreamingMarkdown(source, { turnId: TURN, settled: true });
    assert.equal(settled.activeBlock, null);
    assert.equal(sourcesOf(settled.committedBlocks), source);
    assert.ok(
      settled.committedBlocks.every(
        (block) => block.kind !== "markdown" || block.renderMode === "markdown",
      ),
    );
  }
});

// ── frame-history: committed (id, source) pairs never change once minted ──

test("frame history: committed block id/source pairs are immutable across growth", () => {
  const frames = [
    "# Title",
    "# Title\n",
    "# Title\n\nParagraph one",
    "# Title\n\nParagraph one is growing",
    "# Title\n\nParagraph one is growing longer.\n\n- item one",
    "# Title\n\nParagraph one is growing longer.\n\n- item one\n- item two",
    "# Title\n\nParagraph one is growing longer.\n\n- item one\n- item two\n\n```ts\nconst z = 1",
    "# Title\n\nParagraph one is growing longer.\n\n- item one\n- item two\n\n```ts\nconst z = 1\n```\n",
  ];

  const seen = new Map<string, string>();
  for (const frame of frames) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    const current = new Map(result.committedBlocks.map((block) => [block.id, block.source]));
    for (const [id, source] of seen) {
      assert.equal(current.get(id), source, `committed block ${id} disappeared or changed across frames`);
    }
    for (const block of result.committedBlocks) {
      const prior = seen.get(block.id);
      if (prior !== undefined) {
        assert.equal(block.source, prior, `committed block ${block.id} source changed across frames`);
      } else {
        seen.set(block.id, block.source);
      }
    }
  }
  // Sanity: we actually exercised committed blocks across the run.
  assert.ok(seen.size > 0);
});

test("frame history: growing trailing blank runs never replace committed pairs", () => {
  const frames = ["# H\n", "# H\n\n", "# H\n\n\n", "# H\n\n\n\n"];
  const seen = new Map<string, string>();

  for (const frame of frames) {
    const result = partitionStreamingMarkdown(frame, { turnId: TURN, settled: false });
    const current = new Map(result.committedBlocks.map((block) => [block.id, block.source]));
    for (const [id, source] of seen) {
      assert.equal(current.get(id), source, `committed block ${id} disappeared or changed`);
    }
    for (const [id, source] of current) seen.set(id, source);
    const all = result.activeBlock
      ? sourcesOf([...result.committedBlocks, result.activeBlock])
      : sourcesOf(result.committedBlocks);
    assert.equal(all, frame);
  }
});

test("frame history: committed pairs survive every character prefix of mixed constructs", () => {
  const corpus = [
    "Opening paragraph",
    "- - -",
    "After rule",
    "",
    "- item one",
    "- item two",
    "",
    "* * *",
    "# Heading",
    "```ts",
    "const value = 1",
    "```",
    "| name | value |",
    "| --- | :---: |",
    "| one | two |",
    "",
    "Tail",
  ].join("\n");
  const frames = Array.from({ length: corpus.length }, (_, index) => corpus.slice(0, index + 1));

  assertCommittedFrameHistory(frames);
});

test("frame history: list continuations, peers, and a later table preserve exact ownership", () => {
  const source = [
    "- one",
    "  continuation",
    "- two",
    "  | --- |",
    "- three",
    "",
    "| h |",
    "| --- |",
    "| body |",
    "",
    "Tail",
  ].join("\n");
  const frames = Array.from({ length: source.length }, (_, index) => source.slice(0, index + 1));

  assertCommittedFrameHistory(frames);
  for (const frame of frames) {
    assertExactCoverage(
      partitionStreamingMarkdown(frame, { turnId: TURN, settled: false }),
      frame,
    );
  }

  const final = partitionStreamingMarkdown(source, { turnId: TURN, settled: false });
  const committedList = list(final.committedBlocks[0]);
  assert.deepEqual(committedList.committedItems.map((item) => item.source), [
    "- one\n  continuation\n",
    "- two\n  | --- |\n",
    "- three\n",
  ]);
  assert.equal(md(final.activeBlock).source, "Tail");
});
