import assert from "node:assert/strict";
import test from "node:test";
import { createCitationPreviewCoordinator } from "./citation-preview.ts";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("citation previews stay open until row hover and focus have both left", async (t) => {
  const changes: boolean[] = [];
  const preview = createCitationPreviewCoordinator((open) => changes.push(open), 10);
  t.after(() => preview.dispose());

  preview.enter("row-focus");
  preview.enter("row-hover");
  preview.leave("row-hover");
  await wait(30);

  assert.equal(changes.includes(false), false, "pointer departure must not override retained keyboard focus");

  preview.leave("row-focus");
  await wait(30);

  assert.equal(changes.at(-1), false, "the preview closes once the final active interaction leaves");
});

test("citation previews tolerate the gap between a row and its portaled card", async (t) => {
  const changes: boolean[] = [];
  const preview = createCitationPreviewCoordinator((open) => changes.push(open), 10);
  t.after(() => preview.dispose());

  preview.enter("row-hover");
  preview.leave("row-hover");
  preview.enter("preview-hover");
  await wait(30);

  assert.equal(changes.includes(false), false, "entering the card cancels the pending row close");

  preview.leave("preview-hover");
  await wait(30);

  assert.equal(changes.at(-1), false, "the preview closes after the card is also left");
});
