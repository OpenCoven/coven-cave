"use client";

/**
 * Paper viewer — renders an arXiv PDF inside the resources detail overlay
 * (cave-cbz28).
 *
 * pdf.js is browser-only: importing it under Node dies on `DOMMatrix`. So the
 * library is pulled in with a dynamic `import()` from inside an effect, and the
 * component itself is mounted through `next/dynamic` with `ssr: false` by its
 * one caller. That also keeps ~1 MB of PDF machinery out of the main bundle for
 * everyone who never opens a paper.
 *
 * Each page is drawn to a `<canvas>` and then the pdf.js `TextLayer` is built
 * over it, so the document is selectable and findable rather than merely
 * displayed — a picture of a paper is not a paper you can quote from.
 *
 * State lives in `reducePaperView` (src/lib/research-paper-view.ts), which
 * ignores `ready`/`fail` unless it is still `loading`. Combined with the
 * `cancelled` flag below, a render that resolves after the overlay closed — or
 * after the reader flipped past the page — cannot revive a dead viewer or paint
 * a stale page onto the canvas.
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
  paperPdfUrl,
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
  const [page, setPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState<number>(DEFAULT_ZOOM_INDEX);
  const [attempt, setAttempt] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

  const scale = ZOOM_STEPS[zoomIndex] ?? 1;
  const ready = state.status === "ready";
  const published = formatPublished(publishedAt);

  // A different paper in the same overlay slot starts at its own first page.
  useEffect(() => {
    setPage(1);
    setZoomIndex(DEFAULT_ZOOM_INDEX);
  }, [arxivId]);

  useEffect(() => {
    let cancelled = false;
    // pdf.js 6 moved teardown off the document proxy: `destroy()` lives on the
    // loading task, and destroying that is what tears down the document and its
    // worker. So the task has to be kept, not just its promise.
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let doc: PDFDocumentProxy | null = null;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;

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
        doc = await loadingTask.promise;
        if (cancelled) return;
        dispatch({ type: "ready", pageCount: doc.numPages });

        const target = Math.min(Math.max(page, 1), doc.numPages);
        const pdfPage = await doc.getPage(target);
        if (cancelled) return;

        const canvas = canvasRef.current;
        const container = textLayerRef.current;
        if (!canvas || !container) return;

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
        if (cancelled) return;

        // The text layer positions its spans in percentages scaled by
        // --total-scale-factor, so the container has to carry both the factor
        // and the page's CSS box.
        container.replaceChildren();
        container.style.setProperty("--total-scale-factor", String(scale));
        container.style.width = `${cssWidth}px`;
        container.style.height = `${cssHeight}px`;

        textLayer = new pdfjs.TextLayer({
          textContentSource: pdfPage.streamTextContent(),
          container,
          viewport,
        });
        await textLayer.render();
      } catch (error) {
        // A cancelled render rejects too; that is this effect tearing itself
        // down, not a failure the reader needs to see.
        if (cancelled) return;
        dispatch({
          type: "fail",
          message:
            error instanceof Error && error.message
              ? error.message
              : "Couldn’t render this paper.",
        });
      }
    })();

    return () => {
      cancelled = true;
      dispatch({ type: "cancel" });
      renderTask?.cancel();
      textLayer?.cancel();
      void loadingTask?.destroy();
    };
  }, [arxivId, page, scale, attempt]);

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

      <div className="research-paper-view__stage" data-status={state.status}>
        <div className="research-paper-view__page">
          <canvas ref={canvasRef} className="research-paper-view__canvas" />
          <div ref={textLayerRef} className="research-paper-view__text" />
        </div>

        {state.status === "loading" ? (
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
