import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@create-markdown/core";

type DocumentReaderModule = {
  stripCompleteMarkdownComments(markdown: string): string;
  hasUnclosedMarkdownComment(markdown: string): boolean;
  parseMarkdownReaderDocument(
    raw: string,
    fallbackTitle: string,
  ): {
    title: string;
    titleSource: "frontmatter" | "heading" | "fallback";
    lede: Block | null;
    sections: Array<{
      id: string;
      heading: string;
      level: number;
      blocks: Block[];
    }>;
  };
};

const MAIN_FIXTURE = `---
title: Findings
tags: [research]
---

<!-- research-provenance
mission: research-1
iteration: 1
-->

# Body title

> A concise lede.

## Current state

Paragraph one.

## Current state

- Item one
- Item two
`;

async function loadDocumentReader(): Promise<DocumentReaderModule> {
  const mod = await import("./document-reader.ts").catch(() => null);
  assert.ok(mod, "document-reader.ts is not implemented yet");
  return mod satisfies DocumentReaderModule;
}

function blockText(block: Block | null | undefined): string {
  if (!block) return "";
  return [
    block.content.map((span) => span.text).join(""),
    ...block.children.map((child) => blockText(child)),
  ]
    .filter(Boolean)
    .join(" ");
}

test("frontmatter title wins, provenance stays hidden, lede is extracted, and duplicate headings get stable ids", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument(MAIN_FIXTURE, "Fallback title");
  assert.deepEqual(
    { title: doc.title, titleSource: doc.titleSource },
    { title: "Findings", titleSource: "frontmatter" },
  );
  assert.equal(blockText(doc.lede), "A concise lede.");
  assert.equal(doc.sections.length, 2);
  assert.deepEqual(
    doc.sections.map((section) => ({
      id: section.id,
      heading: section.heading,
      level: section.level,
    })),
    [
      { id: "section-current-state-1", heading: "Current state", level: 2 },
      { id: "section-current-state-2", heading: "Current state", level: 2 },
    ],
  );
  assert.doesNotMatch(JSON.stringify(doc), /research-provenance/);
});

test("an h1 title beats the fallback and is removed from section content", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument("# Heading title\n\nParagraph body.", "Fallback title");
  assert.deepEqual(
    { title: doc.title, titleSource: doc.titleSource },
    { title: "Heading title", titleSource: "heading" },
  );
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].heading, "");
  assert.deepEqual(doc.sections[0].blocks.map((block) => block.type), ["paragraph"]);
  assert.equal(blockText(doc.sections[0].blocks[0]), "Paragraph body.");
});

test("a late h1 becomes the title, is removed from content, and h3-h6 each form sections", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument(
    "## Before\n\nSection body.\n\n# Late title\n\nAfter.\n\n### Alpha\n\nAlpha body.\n\n#### Beta\n\nBeta body.\n\n##### Gamma\n\nGamma body.\n\n###### Delta\n\nDelta body.",
    "Fallback title",
  );

  assert.deepEqual(
    { title: doc.title, titleSource: doc.titleSource },
    { title: "Late title", titleSource: "heading" },
  );
  assert.equal(doc.sections.length, 5);
  assert.deepEqual(
    doc.sections.map((section) => ({
      id: section.id,
      heading: section.heading,
      level: section.level,
    })),
    [
      { id: "section-before-1", heading: "Before", level: 2 },
      { id: "section-alpha-1", heading: "Alpha", level: 3 },
      { id: "section-beta-1", heading: "Beta", level: 4 },
      { id: "section-gamma-1", heading: "Gamma", level: 5 },
      { id: "section-delta-1", heading: "Delta", level: 6 },
    ],
  );
  assert.deepEqual(doc.sections[0].blocks.map((block) => block.type), [
    "paragraph",
    "paragraph",
  ]);
  assert.equal(blockText(doc.sections[0].blocks[0]), "Section body.");
  assert.equal(blockText(doc.sections[0].blocks[1]), "After.");
  assert.deepEqual(doc.sections[1].blocks.map((block) => block.type), ["paragraph"]);
  assert.equal(blockText(doc.sections[1].blocks[0]), "Alpha body.");
  assert.deepEqual(doc.sections[4].blocks.map((block) => block.type), ["paragraph"]);
  assert.equal(blockText(doc.sections[4].blocks[0]), "Delta body.");
});

test("frontmatter title still wins when a later h1 appears, and the h1 is removed from content", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument(
    "---\ntitle: Findings\n---\n\n## Before\n\nSection body.\n\n# Late title\n\nAfter.",
    "Fallback title",
  );

  assert.deepEqual(
    { title: doc.title, titleSource: doc.titleSource },
    { title: "Findings", titleSource: "frontmatter" },
  );
  assert.equal(doc.sections.length, 1);
  assert.deepEqual(doc.sections[0].blocks.map((block) => block.type), [
    "paragraph",
    "paragraph",
  ]);
  assert.equal(blockText(doc.sections[0].blocks[0]), "Section body.");
  assert.equal(blockText(doc.sections[0].blocks[1]), "After.");
});

test("a Setext h1 title uses heading precedence and is removed from content", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument(
    "Setext title\n============\n\nParagraph body.",
    "Fallback title",
  );

  assert.deepEqual(
    { title: doc.title, titleSource: doc.titleSource },
    { title: "Setext title", titleSource: "heading" },
  );
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].heading, "");
  assert.deepEqual(doc.sections[0].blocks.map((block) => block.type), ["paragraph"]);
  assert.equal(blockText(doc.sections[0].blocks[0]), "Paragraph body.");
});

test("standard thematic breaks stay separate from following Setext titles", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();

  for (const divider of ["---", "***", "___", "  - - -", "   * * *", "  _ _ _"]) {
    const doc = parseMarkdownReaderDocument(`${divider}\nTitle\n===\n\nAfter.`, "Fallback title");

    assert.deepEqual(
      { title: doc.title, titleSource: doc.titleSource },
      { title: "Title", titleSource: "heading" },
      `${divider} stays out of the title text`,
    );
    assert.equal(doc.sections.length, 1, `${divider} stays in one overview section`);
    assert.deepEqual(
      doc.sections[0].blocks.map((block) => block.type),
      ["divider", "paragraph"],
      `${divider} remains a standalone block`,
    );
    assert.equal(blockText(doc.sections[0].blocks[1]), "After.");
  }
});

test("a spaced hyphen thematic break after prose stays an overview divider", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument("Paragraph\n- - -", "Fallback title");

  assert.deepEqual(
    { title: doc.title, titleSource: doc.titleSource },
    { title: "Fallback title", titleSource: "fallback" },
  );
  assert.equal(doc.sections.length, 1);
  assert.deepEqual(
    {
      heading: doc.sections[0].heading,
      level: doc.sections[0].level,
      blockTypes: doc.sections[0].blocks.map((block) => block.type),
    },
    { heading: "", level: 0, blockTypes: ["paragraph", "divider"] },
  );
  assert.equal(blockText(doc.sections[0].blocks[0]), "Paragraph");
});

test("a star thematic break after prose stays an overview divider", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument("Paragraph\n* * *", "Fallback title");

  assert.deepEqual(
    { title: doc.title, titleSource: doc.titleSource },
    { title: "Fallback title", titleSource: "fallback" },
  );
  assert.equal(doc.sections.length, 1);
  assert.deepEqual(
    {
      heading: doc.sections[0].heading,
      level: doc.sections[0].level,
      blockTypes: doc.sections[0].blocks.map((block) => block.type),
    },
    { heading: "", level: 0, blockTypes: ["paragraph", "divider"] },
  );
  assert.equal(blockText(doc.sections[0].blocks[0]), "Paragraph");
});

test("an underscore thematic break after prose stays an overview divider", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument("Paragraph\n_ _ _", "Fallback title");

  assert.deepEqual(
    { title: doc.title, titleSource: doc.titleSource },
    { title: "Fallback title", titleSource: "fallback" },
  );
  assert.equal(doc.sections.length, 1);
  assert.deepEqual(
    {
      heading: doc.sections[0].heading,
      level: doc.sections[0].level,
      blockTypes: doc.sections[0].blocks.map((block) => block.type),
    },
    { heading: "", level: 0, blockTypes: ["paragraph", "divider"] },
  );
  assert.equal(blockText(doc.sections[0].blocks[0]), "Paragraph");
});

test("a compact hyphen underline after prose stays a Setext h2 section", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument("Paragraph\n---", "Fallback title");

  assert.deepEqual(
    { title: doc.title, titleSource: doc.titleSource },
    { title: "Fallback title", titleSource: "fallback" },
  );
  assert.equal(doc.sections.length, 1);
  assert.deepEqual(
    {
      heading: doc.sections[0].heading,
      level: doc.sections[0].level,
      blockTypes: doc.sections[0].blocks.map((block) => block.type),
    },
    { heading: "Paragraph", level: 2, blockTypes: [] },
  );
});

test("Setext h2 headings create sections without leaving duplicate paragraph blocks", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument(
    "First section\n-------------\n\nBody one.\n\nSecond section\n--------------\n\nBody two.",
    "Fallback title",
  );

  assert.deepEqual(
    doc.sections.map((section) => ({
      heading: section.heading,
      level: section.level,
      blockTypes: section.blocks.map((block) => block.type),
      text: section.blocks.map((block) => blockText(block)),
    })),
    [
      {
        heading: "First section",
        level: 2,
        blockTypes: ["paragraph"],
        text: ["Body one."],
      },
      {
        heading: "Second section",
        level: 2,
        blockTypes: ["paragraph"],
        text: ["Body two."],
      },
    ],
  );
});

test("unsupported code-fence info strings stay fenced and never create reader headings", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();

  for (const { label, source } of [
    {
      label: "colon info",
      source: "```ts:foo\nInside\n---\n```\n\nAfter.",
    },
    {
      label: "attribute info",
      source: "```ts foo=bar\nInside\n---\n```\n\nAfter.",
    },
  ]) {
    const doc = parseMarkdownReaderDocument(source, "Fallback title");
    assert.deepEqual(
      { title: doc.title, titleSource: doc.titleSource },
      { title: "Fallback title", titleSource: "fallback" },
      `${label} does not invent a title`,
    );
    assert.equal(doc.sections.length, 1, `${label} stays in one overview section`);
    assert.deepEqual(
      doc.sections[0].blocks.map((block) => block.type),
      ["codeBlock", "paragraph"],
      `${label} remains one fenced code block`,
    );
    assert.equal(blockText(doc.sections[0].blocks[0]), "Inside\n---");
    assert.equal(blockText(doc.sections[0].blocks[1]), "After.");
  }
});

test("tilde and longer fences with unsupported info strings keep Setext-looking code literal", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();

  for (const { label, source } of [
    {
      label: "tilde fence",
      source: "~~~ts:foo\r\nTitle\r\n===\r\n~~~\r\n\r\nAfter.",
    },
    {
      label: "long fence",
      source: "````ts foo=bar\nTitle\n===\n````\n\nAfter.",
    },
  ]) {
    const doc = parseMarkdownReaderDocument(source, "Fallback title");
    assert.deepEqual(
      { title: doc.title, titleSource: doc.titleSource },
      { title: "Fallback title", titleSource: "fallback" },
      `${label} does not let fenced code become a title`,
    );
    assert.equal(doc.sections.length, 1, `${label} stays in one overview section`);
    assert.deepEqual(
      doc.sections[0].blocks.map((block) => block.type),
      ["codeBlock", "paragraph"],
      `${label} remains fenced`,
    );
    assert.equal(blockText(doc.sections[0].blocks[0]), "Title\n===");
    assert.equal(blockText(doc.sections[0].blocks[1]), "After.");
  }
});

test("a real paragraph followed by an identical ATX heading keeps both blocks", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument("Same\n\n## Same\n\nBody.", "Fallback title");

  assert.equal(doc.title, "Fallback title");
  assert.equal(doc.sections.length, 2);
  assert.deepEqual(
    doc.sections.map((section) => ({
      heading: section.heading,
      level: section.level,
      text: section.blocks.map((block) => blockText(block)),
    })),
    [
      { heading: "", level: 0, text: ["Same"] },
      { heading: "Same", level: 2, text: ["Body."] },
    ],
  );
});

test("setext-looking lines inside fenced code blocks stay literal", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument(
    "```md\nCode sample\n-----------\n```\n\nReal section\n------------\n\nAfter.",
    "Fallback title",
  );

  assert.equal(doc.sections.length, 2);
  assert.deepEqual(
    doc.sections.map((section) => ({
      heading: section.heading,
      level: section.level,
      blockTypes: section.blocks.map((block) => block.type),
      text: section.blocks.map((block) => blockText(block)),
    })),
    [
      {
        heading: "",
        level: 0,
        blockTypes: ["codeBlock"],
        text: ["Code sample\n-----------"],
      },
      {
        heading: "Real section",
        level: 2,
        blockTypes: ["paragraph"],
        text: ["After."],
      },
    ],
  );
});

test("headingless prose stays in one headingless overview section", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument("Paragraph one.\n\nParagraph two.", "Fallback title");
  assert.equal(doc.sections.length, 1);
  assert.deepEqual(
    {
      heading: doc.sections[0].heading,
      level: doc.sections[0].level,
      blockTypes: doc.sections[0].blocks.map((block) => block.type),
    },
    { heading: "", level: 0, blockTypes: ["paragraph", "paragraph"] },
  );
});

test("fallback title is used when there is no frontmatter title or h1", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const doc = parseMarkdownReaderDocument("Plain body.", "Fallback title");
  assert.deepEqual(
    { title: doc.title, titleSource: doc.titleSource },
    { title: "Fallback title", titleSource: "fallback" },
  );
});

test("complete comments are removed from parsed content and unclosed comments stay literal", async () => {
  const { parseMarkdownReaderDocument } = await loadDocumentReader();
  const clean = parseMarkdownReaderDocument(
    "Visible intro.\n\n<!-- hidden details -->\n\nVisible outro.",
    "Fallback title",
  );
  assert.doesNotMatch(JSON.stringify(clean), /hidden details/);

  const malformed = parseMarkdownReaderDocument(
    "Visible intro.\n\n<!-- hidden details",
    "Fallback title",
  );
  assert.match(JSON.stringify(malformed), /<!-- hidden details/);
});

test("comment helpers strip only complete comments and detect later unmatched openings", async () => {
  const { stripCompleteMarkdownComments, hasUnclosedMarkdownComment } =
    await loadDocumentReader();
  assert.equal(
    stripCompleteMarkdownComments("Alpha <!-- hidden --> Omega\n<!-- gone -->\nTail"),
    "Alpha  Omega\n\nTail",
  );
  assert.equal(
    stripCompleteMarkdownComments("Alpha <!-- hidden"),
    "Alpha <!-- hidden",
  );
  assert.equal(hasUnclosedMarkdownComment("Alpha <!-- hidden --> Omega"), false);
  assert.equal(
    hasUnclosedMarkdownComment("Alpha <!-- hidden --> Omega <!-- still open"),
    true,
  );
});
