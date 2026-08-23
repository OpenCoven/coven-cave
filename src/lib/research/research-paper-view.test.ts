import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialPaperViewState,
  isPaperViewCancellation,
  paperArxivUrl,
  paperDownloadUrl,
  paperPdfUrl,
  paperViewErrorMessage,
  reducePaperView,
  type PaperViewState,
} from "./research-paper-view.ts";

/** Stand-in for a pdf.js exception: the class is gone by the time we see it. */
function pdfjsError(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { name }, extra);
}

test("builds the proxy URL and encodes the id", () => {
  assert.equal(paperPdfUrl("2401.12345"), "/api/research/papers/pdf?id=2401.12345");
});

test("links out to arXiv's landing page and its own PDF, not the proxy", () => {
  assert.equal(paperArxivUrl("2401.12345"), "https://arxiv.org/abs/2401.12345");
  assert.equal(paperDownloadUrl("2401.12345"), "https://arxiv.org/pdf/2401.12345");
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

// The document opens, so the reducer settles on `ready` — and only then does
// the page render blow up (an oversized canvas, a malformed page object, a
// font that will not load). Refusing `fail` here dropped the failure on the
// floor: blank canvas, no error, no Retry, "Page 3 of 14" still on screen.
test("a fail arriving after ready surfaces the error", () => {
  const loading = reducePaperView(initialPaperViewState, { type: "load" });
  const ready = reducePaperView(loading, { type: "ready", pageCount: 14 });
  const failed = reducePaperView(ready, { type: "fail", message: "canvas too large" });
  assert.equal(failed.status, "error");
  assert.equal(failed.error, "canvas too large");
});

test("a fail arriving after ready can still be retried", () => {
  const ready: PaperViewState = { status: "ready", pageCount: 14, error: null };
  const failed = reducePaperView(ready, { type: "fail", message: "boom" });
  assert.equal(reducePaperView(failed, { type: "load" }).status, "loading");
});

// The only route back to `idle` is `cancel`, so `idle` is exactly the
// torn-down viewer the guard exists to protect.
test("idle is the only status that refuses a fail", () => {
  for (const status of ["loading", "ready", "error"] as const) {
    const state: PaperViewState = { status, pageCount: 2, error: null };
    assert.equal(reducePaperView(state, { type: "fail", message: "x" }).status, "error");
  }
  assert.equal(
    reducePaperView(initialPaperViewState, { type: "fail", message: "x" }).status,
    "idle",
  );
});

test("pdf.js cancellations are not reader-facing failures", () => {
  assert.equal(isPaperViewCancellation(pdfjsError("AbortException", "aborted")), true);
  assert.equal(
    isPaperViewCancellation(pdfjsError("RenderingCancelledException", "cancelled")),
    true,
  );
  assert.equal(isPaperViewCancellation(pdfjsError("InvalidPDFException", "bad")), false);
  assert.equal(isPaperViewCancellation("not an error"), false);
});

test("a missing or failed fetch never leaks the proxy URL to the reader", () => {
  const missing = paperViewErrorMessage(
    pdfjsError(
      "ResponseException",
      'Missing PDF "http://localhost:3000/api/research/papers/pdf?id=2401.12345".',
      { status: 404, missing: true },
    ),
  );
  assert.doesNotMatch(missing, /api\/research|localhost/);
  assert.match(missing, /arXiv/);

  const forbidden = paperViewErrorMessage(
    pdfjsError("ResponseException", "Unexpected server response (403) while retrieving PDF", {
      status: 403,
      missing: false,
    }),
  );
  assert.doesNotMatch(forbidden, /403|retrieving PDF/);
  assert.match(forbidden, /connection/);
});

test("damaged and locked PDFs each get their own sentence", () => {
  const damaged = paperViewErrorMessage(
    pdfjsError("InvalidPDFException", "Invalid PDF structure."),
  );
  const locked = paperViewErrorMessage(
    pdfjsError("PasswordException", "No password given", { code: 1 }),
  );
  assert.match(damaged, /damaged/);
  assert.match(locked, /password/i);
  assert.notEqual(damaged, locked);
});

test("anything unrecognised falls back to one generic sentence", () => {
  const generic = paperViewErrorMessage(
    new Error('Setting up fake worker failed: "Failed to fetch dynamically imported module".'),
  );
  assert.doesNotMatch(generic, /fake worker/);
  assert.equal(paperViewErrorMessage("nonsense"), generic);
  assert.equal(paperViewErrorMessage(undefined), generic);
});
