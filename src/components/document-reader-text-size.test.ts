// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { test } from "vitest";
import type { Block } from "@create-markdown/core";
import { paragraph } from "@create-markdown/core";
import {
  DocumentReader,
  type DocumentReaderDocument,
} from "./document-reader.tsx";
import { MarkdownReaderBlock } from "./canonical-memory-markdown.tsx";
import {
  READER_TEXT_SCALE_DEFAULT_INDEX,
  READER_TEXT_SCALE_STEPS,
  clampScaleIndex,
  loadScaleIndex,
  parseStoredScaleIndex,
  saveScaleIndex,
  scaleForIndex,
  scaleLabel,
} from "@/lib/reader-text-scale.ts";
import { updateAppPreferences } from "@/lib/app-preferences.ts";
import { ReadingSizeController } from "./reading-size-controller.tsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const doc: DocumentReaderDocument<Block, Block> = {
  title: "Shared document",
  lede: paragraph("A concise introduction."),
  sections: [
    { id: "s1", heading: "First", level: 2, blocks: [paragraph("Body one.")] },
  ],
};

function render(navigation: "compact" | "rail" | "none") {
  return renderToStaticMarkup(
    createElement(DocumentReader<Block, Block>, {
      document: doc,
      navigation,
      renderLede: (lede) => createElement(MarkdownReaderBlock, { block: lede, blockKey: "lede" }),
      renderBlock: (block, key) =>
        createElement(MarkdownReaderBlock, { block, blockKey: key }),
    }),
  );
}

test("the size control renders in every navigation mode", () => {
  for (const navigation of ["compact", "rail", "none"] as const) {
    const html = render(navigation);
    assert.match(
      html,
      /aria-label="Reading preferences"/,
      `${navigation} reader should expose the compact Aa menu`,
    );
    assert.match(html, />Aa</, `${navigation} reader needs the Aa trigger`);
  }
});

test("a non-default canonical size keeps server and first client paint at the default, then adopts after mount", async () => {
  updateAppPreferences({ appearance: { reading: { size: 4 } } });
  const html = render("rail");
  assert.match(
    html,
    /--reader-text-scale:\s*1\b/,
    "server markup should carry the default scale even when canonical storage is non-default",
  );

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      createElement(DocumentReader<Block, Block>, {
        document: doc,
        navigation: "rail",
        renderLede: (lede) => createElement(MarkdownReaderBlock, { block: lede, blockKey: "lede" }),
        renderBlock: (block, key) =>
          createElement(MarkdownReaderBlock, { block, blockKey: key }),
      }),
    );
  });
  const root = renderer.root.find(
    (node) =>
      typeof node.props.className === "string" &&
      node.props.className.split(" ").includes("document-reader"),
  );
  assert.equal(root.props.style["--reader-text-scale"], 1.4);
  await act(async () => {
    updateAppPreferences({
      appearance: { reading: { size: READER_TEXT_SCALE_DEFAULT_INDEX } },
    });
    renderer.unmount();
  });
});

test("the size controller reapplies canonical preference notifications", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const properties = new Map<string, string>();
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Window & typeof globalThis;
  globalThis.document = {
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
      },
    },
  } as unknown as Document;

  let renderer!: ReactTestRenderer;
  try {
    await act(async () => {
      updateAppPreferences({
        appearance: { reading: { size: READER_TEXT_SCALE_DEFAULT_INDEX } },
      });
      renderer = create(createElement(ReadingSizeController));
    });
    assert.equal(properties.get("--cave-reading-size-scale"), "1");

    await act(async () => {
      updateAppPreferences({ appearance: { reading: { size: 3 } } });
    });
    assert.equal(properties.get("--cave-reading-size-scale"), "1.25");
  } finally {
    await act(async () => {
      updateAppPreferences({
        appearance: { reading: { size: READER_TEXT_SCALE_DEFAULT_INDEX } },
      });
      renderer?.unmount();
    });
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("the smallest step disables A− and the largest disables A+", () => {
  assert.equal(clampScaleIndex(-5), 0, "below range clamps to the smallest step");
  assert.equal(
    clampScaleIndex(99),
    READER_TEXT_SCALE_STEPS.length - 1,
    "above range clamps to the largest step",
  );
  // The default must leave travel in both directions, or one button is dead on
  // arrival for every user who never changed the setting.
  assert.ok(READER_TEXT_SCALE_DEFAULT_INDEX > 0, "default must allow decreasing");
  assert.ok(
    READER_TEXT_SCALE_DEFAULT_INDEX < READER_TEXT_SCALE_STEPS.length - 1,
    "default must allow increasing",
  );
});

test("the shipped size is exactly 1 so an untouched reader is unchanged", () => {
  assert.equal(
    scaleForIndex(READER_TEXT_SCALE_DEFAULT_INDEX),
    1,
    "the default step must be a no-op multiplier",
  );
  assert.equal(scaleLabel(READER_TEXT_SCALE_DEFAULT_INDEX), "100%");
});

test("steps increase monotonically", () => {
  for (let i = 1; i < READER_TEXT_SCALE_STEPS.length; i += 1) {
    assert.ok(
      READER_TEXT_SCALE_STEPS[i] > READER_TEXT_SCALE_STEPS[i - 1],
      `step ${i} must be larger than step ${i - 1}`,
    );
  }
});

test("a corrupt stored value falls back instead of throwing", () => {
  // localStorage is user-editable and shared across tabs and app versions. A
  // reader that refused to render because a preference was malformed would be
  // a worse bug than a reset text size.
  for (const raw of [null, undefined, "", "not-a-number", "NaN", "{}", "999", "-4"]) {
    const parsed = parseStoredScaleIndex(raw);
    assert.ok(
      parsed >= 0 && parsed < READER_TEXT_SCALE_STEPS.length,
      `"${String(raw)}" should parse to a valid step, got ${parsed}`,
    );
  }
  assert.equal(parseStoredScaleIndex("3"), 3, "a valid stored index is honoured");
});

test("storage that throws is survivable in both directions", () => {
  // Safari private mode throws on access, and the desktop shell runs in a
  // WKWebView where storage can be partitioned.
  const hostile = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(
    loadScaleIndex(hostile),
    READER_TEXT_SCALE_DEFAULT_INDEX,
    "an unreadable store yields the default",
  );
  assert.doesNotThrow(() => saveScaleIndex(2, hostile), "an unwritable store must not throw");
});

test("a round trip through storage preserves the step", () => {
  const backing = new Map<string, string>();
  const store = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
  };
  saveScaleIndex(3, store);
  assert.equal(loadScaleIndex(store), 3);
});

test("only reading content is scaled — chrome keeps its own size", () => {
  const css = readFileSync(new URL("../styles/document-reader.css", import.meta.url), "utf8");
  const scaled = (selector: string) => {
    const start = css.indexOf(selector);
    assert.ok(start >= 0, `${selector} should exist`);
    return css.slice(start, css.indexOf("}", start)).includes("var(--reader-text-scale)");
  };

  assert.ok(scaled(".document-reader__title {"), "title scales");
  assert.ok(scaled(".document-reader__lede {"), "lede scales");
  assert.ok(scaled(".document-reader__heading {"), "headings scale");
  assert.ok(scaled(".document-reader__column li {"), "prose scales");

  assert.ok(!scaled(".document-reader__toc-link {"), "TOC links must NOT scale");
  assert.ok(!scaled(".document-reader__contents-trigger {"), "Contents trigger must NOT scale");
  assert.ok(!scaled(".document-reader__kicker {"), "kicker must NOT scale");
  assert.ok(
    !scaled(".document-reader__preferences-trigger {"),
    "the Aa trigger must stay stable while prose changes",
  );
});

test("the shared reader uses character-based prose and a separate wide track", () => {
  const sharedCss = readFileSync(new URL("../styles/document-reader.css", import.meta.url), "utf8");
  const researchCss = readFileSync(new URL("../styles/research-reader.css", import.meta.url), "utf8");

  assert.match(
    sharedCss,
    /--document-reader-prose-measure:\s*var\(--cave-reading-width,\s*66ch\)/,
  );
  assert.match(
    sharedCss,
    /--document-reader-wide-measure:\s*min\(\s*88ch,\s*calc\(/,
  );
  assert.match(
    sharedCss,
    /\.document-reader__prose\s*\{[\s\S]*?max-width:\s*var\(--document-reader-prose-measure\)/,
  );
  assert.match(
    sharedCss,
    /\.document-reader__wide-block\s*\{[\s\S]*?width:\s*var\(--document-reader-wide-measure\)/,
  );
  assert.doesNotMatch(
    researchCss,
    /--document-reader-column-width:\s*\d+(?:px|rem)/,
    "Research must not restore fixed reader widths",
  );
});

test("narrow rail mode collapses the actual grid and keeps tokenized prose gutters", () => {
  const css = readFileSync(new URL("../styles/document-reader.css", import.meta.url), "utf8");
  assert.match(
    css,
    /\.document-reader--rail \.document-reader__layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*13rem\) minmax\(0,\s*1fr\)/,
    "rail mode owns its two-column grid on a descendant of the query container",
  );
  assert.match(
    css,
    /@container document-reader \(max-width:\s*52rem\)\s*\{[\s\S]*?\.document-reader--rail \.document-reader__layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    "the narrow query must collapse the grid itself, not only hide the TOC",
  );
  assert.match(
    css,
    /\.document-reader__scroll\s*\{[\s\S]*?padding:\s*var\(--space-8\) var\(--document-reader-column-gutter\)/,
    "the scrolling canvas owns tokenized horizontal gutters",
  );
  assert.match(
    css,
    /\.document-reader__column\s*\{[\s\S]*?width:\s*min\(100%,\s*var\(--document-reader-prose-measure\)\)/,
    "the prose remains capped near 66ch inside the guttered canvas",
  );
});
