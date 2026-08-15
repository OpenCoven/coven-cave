import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialPaperViewState,
  paperPdfUrl,
  reducePaperView,
  type PaperViewState,
} from "./research-paper-view.ts";

test("builds the proxy URL and encodes the id", () => {
  assert.equal(paperPdfUrl("2401.12345"), "/api/research/papers/pdf?id=2401.12345");
});

test("load then ready", () => {
  const loading = reducePaperView(initialPaperViewState, { type: "load" });
  assert.equal(loading.status, "loading");
  const ready = reducePaperView(loading, { type: "ready", pageCount: 12 });
  assert.equal(ready.status, "ready");
  assert.equal(ready.pageCount, 12);
  assert.equal(ready.error, null);
});

test("failure records the message and can retry", () => {
  const loading = reducePaperView(initialPaperViewState, { type: "load" });
  const failed = reducePaperView(loading, { type: "fail", message: "boom" });
  assert.equal(failed.status, "error");
  assert.equal(failed.error, "boom");
  assert.equal(reducePaperView(failed, { type: "load" }).status, "loading");
});

test("cancel returns to idle and clears the page count", () => {
  const ready: PaperViewState = { status: "ready", pageCount: 12, error: null };
  assert.deepEqual(reducePaperView(ready, { type: "cancel" }), initialPaperViewState);
});

test("a ready arriving after cancel is ignored", () => {
  const cancelled = reducePaperView({ status: "ready", pageCount: 3, error: null }, { type: "cancel" });
  assert.equal(reducePaperView(cancelled, { type: "ready", pageCount: 3 }).status, "idle");
});

test("a fail arriving after cancel is ignored", () => {
  const cancelled = reducePaperView({ status: "loading", pageCount: 0, error: null }, { type: "cancel" });
  const after = reducePaperView(cancelled, { type: "fail", message: "late" });
  assert.equal(after.status, "idle");
  assert.equal(after.error, null);
});

test("a second ready does not overwrite a settled ready", () => {
  const loading = reducePaperView(initialPaperViewState, { type: "load" });
  const ready = reducePaperView(loading, { type: "ready", pageCount: 4 });
  assert.equal(reducePaperView(ready, { type: "ready", pageCount: 99 }).pageCount, 4);
});

test("the initial state is idle with no error", () => {
  assert.deepEqual(initialPaperViewState, { status: "idle", pageCount: 0, error: null });
});
