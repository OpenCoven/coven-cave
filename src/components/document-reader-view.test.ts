import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
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
  options: {
    context?: ReturnType<typeof createElement>;
    collapsibleSections?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(DocumentReader<Block, Block>, {
      document,
      navigation,
      ...options,
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
  assert.match(markup, /aria-current="location"/);
  assert.match(markup, /A concise introduction\./);
  assert.match(markup, /Body 1\./);
});

test("non-collapsible sections render direct headings and keep their bodies visible", () => {
  const markup = render(
    documentWith(["First section", "Second section"]),
    "none",
    { collapsibleSections: false },
  );

  assert.match(
    markup,
    /<h2 class="document-reader__heading" data-document-section="section-1" id="section-1">First section<\/h2>/,
  );
  assert.doesNotMatch(markup, /document-reader__section-toggle/);
  assert.doesNotMatch(markup, /<h2[^>]*aria-expanded=/);
  assert.match(markup, /Body 1\./);
  assert.match(markup, /Body 2\./);
});

test("context renders between the document title and lede", () => {
  const markup = render(documentWith(["First section"]), "none", {
    context: createElement("p", null, "Shared context"),
  });
  const css = readFileSync(
    new URL("../styles/document-reader.css", import.meta.url),
    "utf8",
  );
  const titleIndex = markup.indexOf("Shared document");
  const contextIndex = markup.indexOf("Shared context");
  const ledeIndex = markup.indexOf("A concise introduction.");

  assert.ok(titleIndex >= 0);
  assert.ok(contextIndex > titleIndex);
  assert.ok(ledeIndex > contextIndex);
  assert.match(
    markup,
    /<div class="document-reader__context"><p>Shared context<\/p><\/div>/,
  );
  assert.match(
    css,
    /\.document-reader__context\s*\{\s*margin:\s*calc\(-1 \* var\(--space-2\)\) 0 var\(--space-4\);\s*color:\s*var\(--text-secondary\);\s*font-size:\s*calc\(var\(--text-lg\) \* var\(--reader-text-scale\)\);\s*line-height:\s*var\(--cave-reading-leading,\s*1\.6\);\s*\}/,
  );
});

test("the shared reader uses the popover scaffold, roving outline keys, and reduced-motion-aware scrolling", () => {
  const source = readFileSync(
    new URL("./document-reader.tsx", import.meta.url),
    "utf8",
  );
  const globals = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /import "@\/styles\/document-reader\.css"/);
  assert.match(globals, /@import "\.\.\/styles\/document-reader\.css";/);
  assert.match(source, /from "@\/components\/ui\/popover"/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /Home/);
  assert.match(source, /End/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /className="[^"]*focus-ring/);
});

test("the shared reader reports active-section changes and exposes target scrolling", () => {
  const source = readFileSync(
    new URL("./document-reader.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /onActiveSectionChange\?: \(section: \{ id: string; heading: string \} \| null\) => void/,
  );
  assert.match(
    source,
    /onActiveSectionChangeRef\.current\?\.\(activeSectionForId\(id\)\)/,
    "active-section changes should notify the current callback",
  );
  assert.match(
    source,
    /if \(current\) activateSection\(current\);/,
    "the scroll spy should route section changes through the notifying helper",
  );
  assert.match(
    source,
    /setActiveSection\(resetActiveSection\);[\s\S]*?onActiveSectionChangeRef\.current\?\.\(activeSectionForId\(resetActiveSection\)\)/,
    "document resets should notify even when the first section id is unchanged",
  );
  assert.match(
    source,
    /scrollToTarget: \(id: string, focus\?: boolean\) => void/,
  );
  assert.match(
    source,
    /`\[data-document-target="\$\{CSS\.escape\(id\)\}"\]`/,
  );
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(
    source,
    /if \(focus\) \{[\s\S]*?window\.requestAnimationFrame\(\(\) => target\.focus\(\)\);[\s\S]*?\}/,
  );
  assert.match(
    source,
    /apiRef\.current = \{ scrollToSection, scrollToTarget \}/,
  );
});

test("the shared reader falls back to the global accent outside Research", () => {
  const source = readFileSync(
    new URL("../styles/document-reader.css", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /--document-reader-accent:\s*var\(--research-accent, var\(--accent\)\)/,
  );
  assert.match(
    source,
    /--document-reader-accent-soft:\s*var\(\s*--research-accent-soft,\s*color-mix\(in oklch, var\(--document-reader-accent\) 14%, transparent\)\s*\)/,
  );
});
