// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { test } from "vitest";
import type { Block } from "@create-markdown/core";
import { paragraph } from "@create-markdown/core";
import { DocumentReader, type DocumentReaderDocument } from "./document-reader.tsx";
import { MarkdownReaderBlock } from "./document-reader-markdown.tsx";
import {
  READER_MEASURE_MAX_PX,
  READER_MEASURE_MIN_PX,
  READER_MEASURE_STEP_PX,
} from "@/lib/reader-measure.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const doc: DocumentReaderDocument<Block, Block> = {
  title: "Wide document",
  lede: paragraph("An introduction."),
  sections: [{ id: "s1", heading: "First", level: 2, blocks: [paragraph("Body.")] }],
};

async function mount(props: Record<string, unknown> = {}) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      createElement(DocumentReader<Block, Block>, {
        document: doc,
        navigation: "none",
        renderLede: (lede) => createElement(MarkdownReaderBlock, { block: lede, blockKey: "lede" }),
        renderBlock: (block, key) => createElement(MarkdownReaderBlock, { block, blockKey: key }),
        ...props,
      }),
    );
  });
  return renderer;
}

const readerRoot = (renderer: ReactTestRenderer) =>
  renderer.root.find(
    (node) =>
      typeof node.props.className === "string" &&
      node.props.className.split(" ").includes("document-reader"),
  );

const handles = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) => node.type === "div" && node.props.role === "separator" && node.props["aria-label"] === "Reading width",
  );

const measure = (renderer: ReactTestRenderer) =>
  readerRoot(renderer).props.style["--document-reader-prose-measure"];

const key = (k: string, shiftKey = false) => ({
  key: k,
  shiftKey,
  preventDefault() {},
  stopPropagation() {},
});

test("readers that do not opt in keep their fixed measure and render no handle", async () => {
  const renderer = await mount();
  assert.equal(handles(renderer).length, 0);
  assert.equal(readerRoot(renderer).props.className.includes("document-reader--resizable"), false);
  assert.equal(measure(renderer), undefined);
  await act(async () => renderer.unmount());
});

test("an opted-in reader exposes a keyboard-operable width separator", async () => {
  const renderer = await mount({ resizeKey: "test-surface" });
  const [handle] = handles(renderer);
  assert.ok(handle, "the separator renders");
  assert.ok(readerRoot(renderer).props.className.includes("document-reader--resizable"));
  assert.equal(handle.props["aria-orientation"], "vertical");
  assert.equal(handle.props.tabIndex, 0);
  assert.equal(handle.props["aria-valuemin"], READER_MEASURE_MIN_PX);
  assert.equal(handle.props["aria-valuemax"], READER_MEASURE_MAX_PX);
  assert.equal(handle.props["aria-valuetext"], "Preset width");
  assert.equal(measure(renderer), undefined, "no custom width until the person resizes");

  await act(async () => handle.props.onKeyDown(key("ArrowLeft")));
  assert.equal(measure(renderer), `${READER_MEASURE_MAX_PX - READER_MEASURE_STEP_PX}px`);
  assert.equal(handles(renderer)[0].props["aria-valuetext"], `${READER_MEASURE_MAX_PX - READER_MEASURE_STEP_PX} pixels`);

  await act(async () => handles(renderer)[0].props.onKeyDown(key("Home")));
  assert.equal(measure(renderer), `${READER_MEASURE_MIN_PX}px`);

  await act(async () => handles(renderer)[0].props.onKeyDown(key("End")));
  assert.equal(measure(renderer), `${READER_MEASURE_MAX_PX}px`, "End widens to the 96rem cap");

  await act(async () => handles(renderer)[0].props.onKeyDown(key("Enter")));
  assert.equal(measure(renderer), undefined, "Enter hands the width back to the preset");

  let prevented = false;
  await act(async () =>
    handles(renderer)[0].props.onKeyDown({ ...key("e"), preventDefault: () => (prevented = true) }),
  );
  assert.equal(prevented, false, "non-resize keys keep their reader meaning (E to edit)");
  await act(async () => renderer.unmount());
});

test("dragging the column edge resizes a centered column and double-click resets", async () => {
  const renderer = await mount({ resizeKey: "test-surface" });
  await act(async () => handles(renderer)[0].props.onKeyDown(key("Home")));

  const target = { setPointerCapture() {}, releasePointerCapture() {} };
  const pointer = (clientX: number) => ({
    button: 0,
    pointerId: 7,
    clientX,
    currentTarget: target,
    preventDefault() {},
  });

  await act(async () => handles(renderer)[0].props.onPointerDown(pointer(500)));
  assert.equal(handles(renderer)[0].props["data-dragging"], "");
  await act(async () => handles(renderer)[0].props.onPointerMove(pointer(600)));
  assert.equal(measure(renderer), `${READER_MEASURE_MIN_PX + 200}px`, "a 100px edge move widens by 200px");
  await act(async () => handles(renderer)[0].props.onPointerUp(pointer(650)));
  assert.equal(measure(renderer), `${READER_MEASURE_MIN_PX + 300}px`);
  assert.equal(handles(renderer)[0].props["data-dragging"], undefined);

  // A stray move after release does nothing.
  await act(async () => handles(renderer)[0].props.onPointerMove(pointer(900)));
  assert.equal(measure(renderer), `${READER_MEASURE_MIN_PX + 300}px`);

  await act(async () => handles(renderer)[0].props.onDoubleClick());
  assert.equal(measure(renderer), undefined);
  await act(async () => renderer.unmount());
});

test("choosing a width preset or resetting preferences drops the custom width", () => {
  const source = readFileSync(new URL("./document-reader.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /const applyWidthPreset = \(level: ReadingWidth\) => \{\s*if \(resizeKey\) commitMeasure\(null\);\s*applyReadingWidth\(level\);/,
  );
  assert.match(source, /preferenceGroup\("Width", READING_WIDTH_OPTIONS, reading\.width, READING_LABELS\.width, applyWidthPreset\)/);
  assert.match(source, /const resetReadingPreferences = \(\) => \{\s*if \(resizeKey\) commitMeasure\(null\);/);
});

test("the handle is styled from tokens and steps aside in narrow readers", () => {
  const css = readFileSync(new URL("../styles/grimoire-launcher.css", import.meta.url), "utf8");
  const rootCss = readFileSync(new URL("../styles/document-reader.css", import.meta.url), "utf8");
  assert.doesNotMatch(rootCss, /document-reader__measure-handle/, "the root-loaded reader sheet stays unchanged");
  assert.match(css, /\.document-reader--resizable \.document-reader__column\s*\{\s*position: relative;/);
  assert.match(css, /\.document-reader__measure-handle\s*\{[\s\S]*?cursor: col-resize;[\s\S]*?touch-action: none;/);
  assert.match(
    css,
    /@container document-reader \(max-width: 40rem\)\s*\{\s*\.document-reader__measure-handle\s*\{\s*display: none;/,
  );
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.document-reader__measure-handle::after\s*\{\s*transition: none;/);
});
