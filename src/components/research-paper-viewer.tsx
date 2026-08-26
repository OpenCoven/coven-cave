"use client";

/**
 * Paper viewer — renders an arXiv PDF inside the resources detail overlay
 * (cave-cbz28).
 *
 * pdf.js is browser-only: importing it under Node dies on `DOMMatrix`. So the
 * library is pulled in with a dynamic `import()` from inside an effect, and the
 * component itself is mounted through `next/dynamic` with `ssr: false` by its
 * one caller — behind an explicit "Read" affordance, so neither the ~1 MB of
 * PDF machinery nor the multi-megabyte document is fetched for a reader who
 * only opened the resource to look at its citations.
 *
 * Each page is drawn to a `<canvas>` and then the pdf.js `TextLayer` is built
 * over it, so the document is selectable and findable rather than merely
 * displayed — a picture of a paper is not a paper you can quote from.
 *
 * ── Two effects, deliberately ──────────────────────────────────────────────
 * The document effect owns `getDocument` / `destroy` and is keyed on the paper
 * alone; the render effect owns `getPage` / `render` / `TextLayer` and is keyed
 * on the open document plus the page and zoom. They were one effect keyed on
 * all four, which meant every page flip and every zoom click tore down the
 * worker and re-downloaded the whole PDF — ten pages of a 15 MB paper was
 * ~150 MB over the wire, and the proxy route (`force-dynamic`, no
 * `cache-control`/`etag`) gives the browser cache nothing to answer with.
 *
 * Splitting them is also what lets `pageCount` survive a page turn: only the
 * document effect's cleanup dispatches `cancel`, so flipping pages no longer
 * resets the reducer to `idle` and blanks "Page 3 of 14" down to "Page 3" with
 * both Prev and Next disabled.
 *
 * State lives in `reducePaperView` (src/lib/research-paper-view.ts). It refuses
 * `ready`/`fail` from `idle` — the status only `cancel` produces — so a
 * resolution arriving after teardown cannot revive a dead viewer, while a
 * genuine failure after the document opened still reaches the reader.
 */

import { useEffect, useReducer, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
  TextLayer,
} from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import {
  initialPaperViewState,
  isPaperViewCancellation,
  paperPdfUrl,
  paperViewErrorMessage,
  reducePaperView,
} from "@/lib/research-paper-view";

export type ResearchPaperViewerProps = {
  arxivId: string;
  authors: string[];
  abstract: string;
  publishedAt: string;
};

/** Zoom stops, not a free slider — every step lands on a legible size. */
const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 2] as const;
const DEFAULT_ZOOM_INDEX = 1;

/** Cap the backing-store multiplier: a 3× retina page at 2× zoom is enormous. */
const MAX_OUTPUT_SCALE = 2;

/**
 * An open document plus the flag its owning effect clears on teardown.
 *
 * `destroy()` on the loading task kills the worker, so a `getPage` or `render`
 * still in flight rejects. The render effect's own `cancelled` flag does not
 * cover that: React tears the document effect down first and only re-runs the
 * render effect on the *following* commit, once `opened` has changed. Without
 * this the reader would see a teardown rejection dressed up as a failure.
 */
type OpenDocument = {
  doc: PDFDocumentProxy;
  live: { current: boolean };
};

function formatPublished(iso: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ResearchPaperViewer({
  arxivId,
  authors,
  abstract,
  publishedAt,
}: ResearchPaperViewerProps) {
  const [state, dispatch] = useReducer(reducePaperView, initialPaperViewState);
  const [opened, setOpened] = useState<OpenDocument | null>(null);
  const [painted, setPainted] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState<number>(DEFAULT_ZOOM_INDEX);
  const [attempt, setAttempt] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

  const scale = ZOOM_STEPS[zoomIndex] ?? 1;
  const ready = state.status === "ready";
  const published = formatPublished(publishedAt);
  /**
   * What is actually on the canvas. Comparing it against what is asked for is
   * a truer "pending" than a flag the render effect raises, because it is true
   * from the instant the reader clicks — before the effect has run — and it
   * never reports a page as drawn that a superseded run painted.
   */
  const renderKey = `${page}@${scale}`;
  const pending = state.status === "loading" || (ready && painted !== renderKey);

  // A different paper in the same overlay slot starts at its own first page.
  // Defensive only: the overlay always passes through `openLink === null`
  // between two resources, so this component unmounts rather than being
  // handed a new `arxivId` in place. Left as a reset so the invariant holds
  // if that ever changes; the one aborted fetch it could cost has no
  // observable symptom.
  useEffect(() => {
    setPage(1);
    setZoomIndex(DEFAULT_ZOOM_INDEX);
  }, [arxivId]);

  // ── Document: fetch and parse once per paper (and once per retry). ──
  useEffect(() => {
    let cancelled = false;
    // pdf.js 6 moved teardown off the document proxy: `destroy()` lives on the
    // loading task, and destroying that is what tears down the document and its
    // worker. So the task has to be kept, not just its promise.
    let loadingTask: PDFDocumentLoadingTask | null = null;
    const live = { current: true };

    dispatch({ type: "load" });

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        // Staged into public/ by postinstall — same origin, so no CDN and no
        // cross-origin worker bootstrap.
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        // v6 typings no longer accept a bare URL string here.
        loadingTask = pdfjs.getDocument({ url: paperPdfUrl(arxivId) });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setOpened({ doc, live });
        dispatch({ type: "ready", pageCount: doc.numPages });
      } catch (error) {
        if (cancelled || isPaperViewCancellation(error)) return;
        dispatch({ type: "fail", message: paperViewErrorMessage(error) });
      }
    })();

    return () => {
      cancelled = true;
      live.current = false;
      dispatch({ type: "cancel" });
      setOpened(null);
      setPainted(null);
      // A discarded promise turns a teardown rejection into an unhandled one.
      loadingTask?.destroy().catch(() => {});
    };
  }, [arxivId, attempt]);

  // ── Render: one page of the already-open document, at the current zoom. ──
  useEffect(() => {
    if (!opened) return;
    const { doc, live } = opened;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    /** Either this run was superseded, or the document under it is gone. */
    const stale = () => cancelled || !live.current;

    void (async () => {
      try {
        // Module-cached by the document effect; this is a map lookup, not a
        // second download.
        const pdfjs = await import("pdfjs-dist");
        if (stale()) return;

        const target = Math.min(Math.max(page, 1), doc.numPages);
        if (target !== page) {
          // The reader's page outlived the document it belonged to — a retry
          // that reopened a shorter file. Correct the state rather than paint
          // one page while the readout names another; the effect re-runs.
          setPage(target);
          return;
        }

        const canvas = canvasRef.current;
        const container = textLayerRef.current;
        if (!canvas || !container) {
          // Returning bare here left the same silent blank as a swallowed
          // failure: a `ready` viewer with nothing painted and no way out.
          dispatch({
            type: "fail",
            message: "Couldn’t draw this page. Close the paper and open it again.",
          });
          return;
        }

        // Drop the old spans before ANY of the page work, not after the render
        // lands. Held to the end, the previous page's text stayed selectable
        // and findable for the whole load of the next one — under a canvas
        // already dimmed to say "pending" — so a search hit could belong to a
        // page no longer on screen. Clearing here also covers the error paths
        // below (`getPage` on a malformed page object, a font that will not
        // load): an error banner over an empty text layer is honest, an error
        // banner over the last page's words is not.
        container.replaceChildren();

        const pdfPage = await doc.getPage(target);
        if (stale()) return;

        const viewport = pdfPage.getViewport({ scale });
        const output = Math.min(
          typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
          MAX_OUTPUT_SCALE,
        );
        const cssWidth = Math.floor(viewport.width);
        const cssHeight = Math.floor(viewport.height);

        canvas.width = Math.floor(viewport.width * output);
        canvas.height = Math.floor(viewport.height * output);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        renderTask = pdfPage.render({
          canvas,
          viewport,
          transform: output === 1 ? undefined : [output, 0, 0, output, 0, 0],
        });
        await renderTask.promise;
        if (stale()) return;

        // The text layer positions its spans in percentages scaled by
        // --total-scale-factor, so the container has to carry both the factor
        // and the page's CSS box.
        container.style.setProperty("--total-scale-factor", String(scale));
        container.style.width = `${cssWidth}px`;
        container.style.height = `${cssHeight}px`;

        textLayer = new pdfjs.TextLayer({
          textContentSource: pdfPage.streamTextContent(),
          container,
          viewport,
        });
        await textLayer.render();
        if (stale()) return;
        setPainted(`${page}@${scale}`);
      } catch (error) {
        // A cancelled render rejects too; that is this effect tearing itself
        // down, not a failure the reader needs to see.
        if (stale() || isPaperViewCancellation(error)) return;
        dispatch({ type: "fail", message: paperViewErrorMessage(error) });
      }
    })();

    // No `cancel` dispatch here — that belongs to the document effect. Firing
    // it on every page turn is what used to reset `pageCount` to 0 mid-flip,
    // disabling Prev and Next and dropping "Page 3 of 14" to bare "Page 3".
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [opened, page, scale]);

  return (
    <section className="research-paper-view" aria-label="Paper">
      {authors.length > 0 || published ? (
        <div className="research-paper-view__byline">
          {authors.length > 0 ? (
            <span className="research-paper-view__authors">{authors.join(", ")}</span>
          ) : null}
          {published ? (
            <span className="research-paper-view__published">{published}</span>
          ) : null}
        </div>
      ) : null}

      {abstract ? (
        <div className="research-paper-view__abstract">
          <div className="research-paper-view__label">
            <i aria-hidden />
            <span>Abstract</span>
          </div>
          <p>{abstract}</p>
        </div>
      ) : null}

      <div className="research-paper-view__toolbar">
        <div className="research-paper-view__group">
          <Button
            size="xs"
            variant="ghost"
            leadingIcon="ph:caret-left"
            disabled={!ready || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Prev
          </Button>
          <span className="research-paper-view__readout">
            {ready ? `Page ${page} of ${state.pageCount}` : `Page ${page}`}
          </span>
          <Button
            size="xs"
            variant="ghost"
            trailingIcon="ph:caret-right"
            disabled={!ready || page >= state.pageCount}
            onClick={() =>
              setPage((current) => Math.min(state.pageCount, current + 1))
            }
          >
            Next
          </Button>
        </div>
        <div className="research-paper-view__group">
          <Button
            size="xs"
            variant="ghost"
            leadingIcon="ph:minus"
            aria-label="Zoom out"
            disabled={zoomIndex <= 0}
            onClick={() => setZoomIndex((current) => Math.max(0, current - 1))}
          />
          <span className="research-paper-view__readout">
            {Math.round(scale * 100)}%
          </span>
          <Button
            size="xs"
            variant="ghost"
            leadingIcon="ph:plus"
            aria-label="Zoom in"
            disabled={zoomIndex >= ZOOM_STEPS.length - 1}
            onClick={() =>
              setZoomIndex((current) => Math.min(ZOOM_STEPS.length - 1, current + 1))
            }
          />
        </div>
      </div>

      <div
        className="research-paper-view__stage"
        data-status={state.status}
        data-pending={pending || undefined}
      >
        <div className="research-paper-view__page">
          <canvas ref={canvasRef} className="research-paper-view__canvas" />
          <div ref={textLayerRef} className="research-paper-view__text" />
        </div>

        {pending ? (
          <p className="research-paper-view__status" role="status">
            Rendering page {page}…
          </p>
        ) : null}

        {state.status === "error" ? (
          <div className="research-paper-view__error" role="alert">
            <Icon name="ph:warning" width={13} height={13} aria-hidden />
            <span>{state.error ?? "Couldn’t render this paper."}</span>
            <Button
              size="xs"
              variant="secondary"
              leadingIcon="ph:arrow-clockwise"
              onClick={() => setAttempt((current) => current + 1)}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
