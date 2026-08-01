import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Block } from "@create-markdown/core";
import { paragraph } from "@create-markdown/core";
import {
  DocumentReader,
  type DocumentReaderDocument,
} from "./document-reader.tsx";
import { MarkdownReaderBlock } from "./canonical-memory-markdown.tsx";

function documentWith(headings: string[]): DocumentReaderDocument<Block, Block> {
  return {
    title: "Shared document",
    lede: paragraph("A concise introduction."),
    sections: headings.map((heading, index) => ({
      id: `section-${index + 1}`,
      heading,
      level: 2,
      blocks: [paragraph(`Body ${index + 1}.`)],
    })),
  };
}

function render(
  document: DocumentReaderDocument<Block, Block>,
  navigation: "compact" | "rail" | "none",
): string {
  return renderToStaticMarkup(
    createElement(DocumentReader<Block, Block>, {
      document,
      navigation,
      renderLede: (lede) =>
        createElement(MarkdownReaderBlock, {
          block: lede,
          blockKey: "lede",
        }),
      renderBlock: (block, key) =>
        createElement(MarkdownReaderBlock, {
          block,
          blockKey: key,
        }),
    }),
  );
}

test("compact navigation appears only for documents with at least two named sections", () => {
  const oneSection = render(documentWith(["Only section"]), "compact");
  assert.doesNotMatch(oneSection, /Contents/);

  const twoSections = render(
    documentWith(["First section", "Second section"]),
    "compact",
  );
  assert.match(twoSections, />Contents</);
  assert.match(twoSections, /aria-haspopup="dialog"/);
});

test("expanded navigation renders a persistent contents rail and collapsible sections", () => {
  const markup = render(
    documentWith(["First section", "Second section"]),
    "rail",
  );
  assert.match(markup, /aria-label="Contents"/);
  assert.match(markup, /First section/);
  assert.match(markup, /Second section/);
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /A concise introduction\./);
  assert.match(markup, /Body 1\./);
});

test("the shared reader uses the popover scaffold and reduced-motion-aware scrolling", () => {
  const source = readFileSync(
    new URL("./document-reader.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /from "@\/components\/ui\/popover"/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /className="[^"]*focus-ring/);
});
