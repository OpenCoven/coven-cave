/**
 * mermaid-viewer — fullscreen zoom/pan viewer for chat mermaid diagrams.
 *
 * Mermaid diagrams render as `<div class="cm-mermaid-diagram"><svg></svg></div>`
 * injected via dangerouslySetInnerHTML (see message-bubble.tsx mdToHtml /
 * postProcess), so there's no React node to hang an expand button off. Instead
 * this module wires the injected DOM directly — mirroring the copy/expand-button
 * pattern in message-bubble.tsx — adding an "Expand" affordance to each diagram
 * that opens a fullscreen overlay with wheel/pinch/button zoom and drag-to-pan,
 * the same reading experience as the doc reader's fullscreen mode.
 *
 * The injected affordance sends an open request to its React owner. Only the
 * zoom/pan canvas uses imperative DOM; the shared Modal owns every shell.
 */

const MIN_SCALE = 0.1;
const MAX_SCALE = 12;
const ZOOM_STEP = 1.25; // per button click / keyboard +/-
const WHEEL_SENSITIVITY = 0.0015;

const EXPAND_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg>`;
type WiredEl = HTMLElement & { _mermaidWired?: boolean };


/**
 * Wire every (rendered) mermaid diagram inside `container` with an Expand
 * button + click-to-open. Idempotent per DOM element via a `_mermaidWired`
 * flag — re-renders that replace innerHTML produce fresh elements, so a new
 * settled render re-wires the new nodes.
 */
export function wireMermaidDiagrams(container: HTMLElement, openViewer: (source: SVGSVGElement) => void): void {
  const diagrams = container.querySelectorAll<HTMLElement>(".cm-mermaid-diagram");
  for (const diagram of Array.from(diagrams)) {
    if ((diagram as WiredEl)._mermaidWired) continue;
    const svg = diagram.querySelector("svg");
    // Pre-render placeholder / render failure leaves no <svg> — skip; the next
    // settled render will replace this element and we'll wire that one.
    if (!svg) continue;
    (diagram as WiredEl)._mermaidWired = true;
    diagram.classList.add("cm-mermaid-diagram--interactive");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-mermaid-expand";
    btn.setAttribute("aria-label", "Expand diagram");
    btn.title = "Expand diagram";
    btn.innerHTML = EXPAND_ICON;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      openViewer(svg);
    });
    diagram.appendChild(btn);

    diagram.addEventListener("click", () => openViewer(svg));
  }
}

export function naturalSize(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) return { w: vb.width, h: vb.height };
  const rect = svg.getBoundingClientRect();
  return { w: rect.width || 600, h: rect.height || 400 };
}

/** Owns only the diagram canvas interaction. React Modal owns the shell,
 * keyboard containment, Escape, focus return, and the toolbar controls. */
export function mountMermaidViewport(
  source: SVGSVGElement,
  { w: baseW, h: baseH }: { w: number; h: number },
  { stage, canvas, level, zoomInBtn, zoomOutBtn, fitBtn, close }: {
    stage: HTMLDivElement; canvas: HTMLDivElement; level: HTMLSpanElement;
    zoomInBtn: HTMLButtonElement; zoomOutBtn: HTMLButtonElement; fitBtn: HTMLButtonElement;
    close: () => void;
  },
): () => void {
  const clone = source.cloneNode(true) as SVGSVGElement;
  // The chat CSS caps the inline svg at max-width:100%; height:auto. Inside the
  // viewer we drive size purely via the transform, so pin the clone to its
  // natural pixel box and let transform: scale() do the rest.
  clone.style.maxWidth = "none";
  clone.style.width = `${baseW}px`;
  clone.style.height = `${baseH}px`;
  // Mermaid frequently measures label widths before the webfont loads, so node
  // boxes (and sometimes the viewBox itself) end up a hair too narrow and the
  // outer <svg>/<foreignObject> clip the final, wider text. Letting overflow
  // show keeps every label fully readable when enlarged.
  clone.style.overflow = "visible";
  // IMPORTANT: keep the svg id. Mermaid embeds its theme CSS in an inner <style>
  // with every rule scoped to the svg id (`#diagram-N .cluster rect { fill }`),
  // so stripping the id drops all fills/borders and the diagram renders as a
  // black-on-black silhouette. The clone is byte-identical to the live inline
  // diagram, so sharing the id (and its internal url(#…) marker refs) is safe.
  canvas.replaceChildren(clone);

  // --- Transform state -------------------------------------------------------
  let scale = 1;
  let tx = 0;
  let ty = 0;

  const apply = () => {
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    level.textContent = `${Math.round(scale * 100)}%`;
  };

  const fit = () => {
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const pad = 48;
    const target = Math.min((sw - pad) / baseW, (sh - pad) / baseH);
    // Clamp into range, but never auto-blow a small diagram past 100%.
    scale = Math.max(MIN_SCALE, Math.min(target, 1));
    tx = (sw - baseW * scale) / 2;
    ty = (sh - baseH * scale) / 2;
    apply();
  };

  const zoomAt = (factor: number, px: number, py: number) => {
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
    if (next === scale) return;
    // Keep the point under (px, py) — coords relative to the stage origin —
    // anchored while scaling.
    tx = px - (px - tx) * (next / scale);
    ty = py - (py - ty) * (next / scale);
    scale = next;
    apply();
  };

  const zoomCenter = (factor: number) => {
    zoomAt(factor, stage.clientWidth / 2, stage.clientHeight / 2);
  };

  // --- Interaction -----------------------------------------------------------
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * WHEEL_SENSITIVITY);
    zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
  };

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = 0; // total drag distance — distinguishes a pan from a backdrop tap
  let downOnBackdrop = false;
  let pointerId: number | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    dragging = true;
    moved = 0;
    // A tap that both starts and ends on empty space (not the diagram) closes.
    downOnBackdrop = event.target === stage;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("cm-mermaid-viewer__stage--grabbing");
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    tx += dx;
    ty += dy;
    lastX = event.clientX;
    lastY = event.clientY;
    apply();
  };
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (pointerId !== null && stage.hasPointerCapture(pointerId)) {
      stage.releasePointerCapture(pointerId);
    }
    pointerId = null;
    stage.classList.remove("cm-mermaid-viewer__stage--grabbing");
    if (downOnBackdrop && moved < 5) close();
    downOnBackdrop = false;
  };

  // Zoom shortcuts belong to this dialog only. Escape and Tab remain with
  // Modal, so a nested or later independent layer owns those keys.
  const onKey = (event: KeyboardEvent) => {
    if (!stage.closest('[role="dialog"]')?.contains(event.target as Node)) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault(); event.stopPropagation(); zoomCenter(ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault(); event.stopPropagation(); zoomCenter(1 / ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault(); event.stopPropagation(); fit();
    }
  };

  // Double-click to zoom in at the cursor (double-click again past max wraps to fit).
  const onDblClick = (event: MouseEvent) => {
    const rect = stage.getBoundingClientRect();
    if (scale >= MAX_SCALE * 0.95) fit();
    else zoomAt(ZOOM_STEP * ZOOM_STEP, event.clientX - rect.left, event.clientY - rect.top);
  };

  const zoomIn = () => zoomCenter(ZOOM_STEP);
  const zoomOut = () => zoomCenter(1 / ZOOM_STEP);
  zoomInBtn.addEventListener("click", zoomIn);
  zoomOutBtn.addEventListener("click", zoomOut);
  fitBtn.addEventListener("click", fit);
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("keydown", onKey);
  stage.addEventListener("dblclick", onDblClick);
  fit();
  return () => {
    if (pointerId !== null && stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
    zoomInBtn.removeEventListener("click", zoomIn);
    zoomOutBtn.removeEventListener("click", zoomOut);
    fitBtn.removeEventListener("click", fit);
    stage.removeEventListener("wheel", onWheel);
    stage.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("keydown", onKey);
    stage.removeEventListener("dblclick", onDblClick);
    canvas.replaceChildren();
  };
}
