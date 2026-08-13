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
      renderLede: (lede) => createElement(MarkdownReaderBlock, { block: lede }),
      renderBlock: (block, key) => createElement(MarkdownReaderBlock, { block, key }),
    }),
  );
}

test("the size control renders in every navigation mode", () => {
  // Text size is not a navigation affordance. A reader with no table of
  // contents — the "none" mode — still needs it, and that is exactly the case
  // that a control tucked inside the compact nav would have missed.
  for (const navigation of ["compact", "rail", "none"] as const) {
    const html = render(navigation);
    assert.match(
      html,
      /aria-label="Text size"/,
      `${navigation} reader should expose the text size group`,
    );
    assert.match(html, /Decrease text size/, `${navigation} reader needs A−`);
    assert.match(html, /Increase text size/, `${navigation} reader needs A\+`);
  }
});

test("first paint uses the default scale so hydration cannot mismatch", () => {
  // Reading localStorage in the state initializer would emit different HTML on
  // the server than the client. The stored value is applied in an effect, so
  // server markup must always carry the default.
  const html = render("rail");
  assert.match(
    html,
    /--reader-text-scale:\s*1\b/,
    "server markup should carry the default scale, not a stored one",
  );
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
  // Scaling the TOC links and the Contents trigger would move the furniture
  // while the user is trying to enlarge the text, and the rail has a fixed
  // width that oversized links would overflow.
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
    !scaled(".document-reader__textsize-btn {"),
    "the control itself must NOT scale, or A+ walks out from under the pointer",
  );
});
