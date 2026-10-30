"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { Modal } from "./ui/modal";
import { IconButton } from "./ui/icon-button";
import { mountMermaidViewport, naturalSize } from "./mermaid-viewer";

export type MarkdownViewerRequest =
  | { kind: "table"; source: HTMLTableElement }
  | { kind: "diagram"; source: SVGSVGElement };
type Snapshot =
  | { kind: "table"; source: HTMLTableElement }
  | { kind: "diagram"; source: SVGSVGElement; dimensions: { w: number; h: number } };
let activeClose: (() => void) | null = null;

/** Injected HTML sends requests back to its React owner. Rendering the viewer
 * here preserves that owner's modal/popover depth, hidden state and cleanup. */
export function useMarkdownViewer() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const close = useCallback(() => {
    if (activeClose === close) activeClose = null;
    setSnapshot(null);
  }, []);
  const openViewer = useCallback((request: MarkdownViewerRequest) => {
    // Complete the previous owner's cleanup/focus return before opening a new
    // root. Within one owner, replace the content without remounting its shell.
    if (activeClose && activeClose !== close) flushSync(activeClose);
    activeClose = close;
    setSnapshot(request.kind === "table"
      ? { kind: "table", source: request.source.cloneNode(true) as HTMLTableElement }
      : { kind: "diagram", source: request.source.cloneNode(true) as SVGSVGElement, dimensions: naturalSize(request.source) });
  }, [close]);
  useEffect(() => () => { if (activeClose === close) activeClose = null; }, [close]);
  const viewer = snapshot?.kind === "table"
    ? <TableViewer table={snapshot.source} onClose={close} />
    : snapshot?.kind === "diagram"
      ? <DiagramViewer source={snapshot.source} dimensions={snapshot.dimensions} onClose={close} />
      : null;
  return { openViewer, viewer };
}

function TableViewer({ table, onClose }: { table: HTMLTableElement; onClose: () => void }) {
  return <Modal open onClose={onClose} title="Expanded table" size="reader" bodyLayout="fill" closeLabel="Close expanded table">
    <TableContent table={table} />
  </Modal>;
}

// Modal mounts its children after hydration. Keep DOM initialization inside
// that boundary so the first open has mounted refs, and unmount owns cleanup.
function TableContent({ table }: { table: HTMLTableElement }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    body?.replaceChildren(table);
    return () => body?.replaceChildren();
  }, [table]);
  return <div ref={bodyRef} className="cave-table-lightbox__body cave-md" />;
}

function DiagramViewer({ source, dimensions, onClose }: { source: SVGSVGElement; dimensions: { w: number; h: number }; onClose: () => void }) {
  const levelRef = useRef<HTMLSpanElement | null>(null);
  const zoomInRef = useRef<HTMLButtonElement | null>(null);
  const zoomOutRef = useRef<HTMLButtonElement | null>(null);
  const fitRef = useRef<HTMLButtonElement | null>(null);
  return <Modal open onClose={onClose} title="Diagram viewer" presentation="fullscreen" bodyLayout="fill" closeLabel="Close diagram viewer"
    headerActions={<>
      <IconButton ref={zoomOutRef} icon="ph:minus" aria-label="Zoom out" />
      <span ref={levelRef} className="cm-mermaid-viewer__level">100%</span>
      <IconButton ref={zoomInRef} icon="ph:plus" aria-label="Zoom in" />
      <IconButton ref={fitRef} icon="ph:arrows-out-simple" aria-label="Fit to screen" />
    </>}
    footerPills={<span>Scroll to zoom · drag to pan · Esc to close</span>}
  ><DiagramContent source={source} dimensions={dimensions} onClose={onClose} levelRef={levelRef} zoomInRef={zoomInRef} zoomOutRef={zoomOutRef} fitRef={fitRef} /></Modal>;
}

function DiagramContent({ source, dimensions, onClose, levelRef, zoomInRef, zoomOutRef, fitRef }: {
  source: SVGSVGElement;
  dimensions: { w: number; h: number };
  onClose: () => void;
  levelRef: RefObject<HTMLSpanElement | null>;
  zoomInRef: RefObject<HTMLButtonElement | null>;
  zoomOutRef: RefObject<HTMLButtonElement | null>;
  fitRef: RefObject<HTMLButtonElement | null>;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current, canvas = canvasRef.current, level = levelRef.current;
    const zoomInBtn = zoomInRef.current, zoomOutBtn = zoomOutRef.current, fitBtn = fitRef.current;
    if (!stage || !canvas || !level || !zoomInBtn || !zoomOutBtn || !fitBtn) return;
    return mountMermaidViewport(source, dimensions, { stage, canvas, level, zoomInBtn, zoomOutBtn, fitBtn, close: onClose });
  }, [source, dimensions, onClose, levelRef, zoomInRef, zoomOutRef, fitRef]);
  return <div ref={stageRef} className="cm-mermaid-viewer__stage"><div ref={canvasRef} className="cm-mermaid-viewer__canvas" /></div>;
}
