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
