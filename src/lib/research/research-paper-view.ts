export type PaperViewStatus = "idle" | "loading" | "ready" | "error";

export type PaperViewState = {
  status: PaperViewStatus;
  pageCount: number;
  error: string | null;
};

export type PaperViewAction =
  | { type: "load" }
  | { type: "ready"; pageCount: number }
  | { type: "fail"; message: string }
  | { type: "cancel" };

export const initialPaperViewState: PaperViewState = {
  status: "idle",
  pageCount: 0,
  error: null,
};

export function paperPdfUrl(arxivId: string): string {
  return `/api/research/papers/pdf?id=${encodeURIComponent(arxivId)}`;
}

/** The paper's arXiv landing page — the "open it where it lives" action. */
export function paperArxivUrl(arxivId: string): string {
  return `https://arxiv.org/abs/${encodeURIComponent(arxivId)}`;
}

/**
 * arXiv's own PDF, not the loopback proxy: this is handed to the browser (or
 * the OS handler under the desktop shell) to save, and a `/api/...` path is
 * meaningless once it leaves the app.
 */
export function paperDownloadUrl(arxivId: string): string {
  return `https://arxiv.org/pdf/${encodeURIComponent(arxivId)}`;
}

/**
 * Rejections pdf.js uses to signal "this work was called off", not "this
 * paper is broken". They reach a catch block whenever teardown races an
 * in-flight render, and showing one to the reader would be a lie.
 */
const CANCELLATION_NAMES = new Set(["AbortException", "RenderingCancelledException"]);

/** True when `error` is pdf.js reporting its own cancellation. */
export function isPaperViewCancellation(error: unknown): boolean {
  return error instanceof Error && CANCELLATION_NAMES.has(error.name);
}

/**
 * Map a pdf.js rejection to something a reader can act on.
 *
 * Discriminating on `error.name` rather than `instanceof` is deliberate.
 * pdf.js parses in a worker, so every failure crosses a structured-clone
 * boundary and is rebuilt on the main thread by `wrapReason`, which switches
 * on exactly this name. The class identities also move between majors: the
 * installed pdfjs-dist (6.2.108) exports `InvalidPDFException`,
 * `PasswordException` and `ResponseException`, and no longer has the
 * `MissingPDFException` / `UnexpectedResponseException` pair that v4 did —
 * `ResponseException` carries `status` and `missing` instead. A name check
 * keeps this file free of a pdfjs import (it is unit-testable under plain
 * node) and degrades to the generic sentence on anything unrecognised.
 *
 * The raw message never reaches the UI: pdf.js writes the fetch URL into it,
 * which would leak the internal `/api/research/papers/pdf?id=…` path onto the
 * reader's screen.
 */
export function paperViewErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";

  if (name === "ResponseException") {
    const { status, missing } = error as { status?: number; missing?: boolean };
    if (missing || status === 404) {
      return "This paper isn’t available from arXiv right now.";
    }
    return "Couldn’t fetch this paper — check your connection, then retry.";
  }
  if (name === "InvalidPDFException") {
    return "This paper’s PDF is damaged, so it can’t be shown here.";
  }
  if (name === "PasswordException") {
    return "This paper’s PDF is password-protected, so it can’t be shown here.";
  }
  return "Couldn’t render this paper. Retry, or open it on arXiv.";
}

export function reducePaperView(state: PaperViewState, action: PaperViewAction): PaperViewState {
  switch (action.type) {
    case "load":
      return { status: "loading", pageCount: 0, error: null };
    case "ready":
      // A render that resolves after dismissal must not revive the viewer.
      if (state.status !== "loading") return state;
      return { status: "ready", pageCount: action.pageCount, error: null };
    case "fail":
      // `cancel` is the only thing that returns the viewer to `idle`, so
      // `idle` means "torn down" and a late rejection from a dead effect run
      // must not resurrect it. Everything else is a live run: `loading` is a
      // document that never opened, and `ready` is a page that failed AFTER
      // it did — the canvas is blanked before each render, so refusing `fail`
      // from `ready` left the reader staring at an empty page with a
      // confident "Page 3 of 14" above it and no way to retry.
      if (state.status === "idle") return state;
      return { status: "error", pageCount: 0, error: action.message };
    case "cancel":
      return initialPaperViewState;
  }
}
