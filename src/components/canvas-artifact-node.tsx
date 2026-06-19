"use client";

import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { buildPreviewSrcDoc, type CanvasArtifact } from "@/lib/canvas-artifacts";
import { buildReactSrcDoc } from "@/lib/canvas-react-harness";

export type ArtifactNodeData = {
  artifact: CanvasArtifact;
  view: "preview" | "code";
  generating: boolean;
  onToggleView: (id: string) => void;
  onRefine: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onEditCode: (id: string, code: string) => void;
  onOpenInBrowser: (id: string) => void;
};

export type ArtifactFlowNode = Node<ArtifactNodeData & Record<string, unknown>, "artifact">;

export function ArtifactNode({ data, selected }: NodeProps<ArtifactFlowNode>) {
  const { artifact, view, generating } = data;
  const isReact = artifact.kind === "react";
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const srcDoc = useMemo(
    () => (isReact ? buildReactSrcDoc(artifact.code) : buildPreviewSrcDoc(artifact.code)),
    [isReact, artifact.code],
  );

  // The sandbox runtime reports compile/render/runtime failures via postMessage
  // (the only channel out of the no-same-origin iframe). Match messages to THIS
  // node's frame by comparing the event source to its contentWindow.
  useEffect(() => {
    setRuntimeError(null); // a fresh srcDoc reloads the frame; clear stale errors
    function onMessage(e: MessageEvent) {
      if (e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.type === "sandbox-error" && typeof e.data.message === "string") {
        setRuntimeError(e.data.message);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [srcDoc]);

  return (
    <div className={`canvas-artifact${selected ? " is-selected" : ""}`}>
      <NodeResizer
        minWidth={260}
        minHeight={200}
        isVisible
        handleClassName="canvas-artifact-resizer__handle"
        lineClassName="canvas-artifact-resizer__line"
        color="var(--accent, #6b8fbf)"
      />
      {/* Drag handle — the iframe swallows pointer events, so the node is only
          draggable by this header (see dragHandle wiring in canvas-view). */}
      <div className="canvas-artifact__grip">
        <span className="canvas-artifact__title" title={artifact.prompt || artifact.title}>
          {generating ? <span className="canvas-artifact__spinner" aria-hidden /> : <Icon name="ph:bounding-box" />}
          {artifact.title || "Untitled"}
        </span>
        <span className="canvas-artifact__kind">{isReact ? "React" : "HTML"}</span>
        <div className="canvas-artifact__actions nodrag">
          <button
            type="button"
            className={`canvas-artifact__btn${view === "preview" ? " is-active" : ""}`}
            title={view === "preview" ? "Show code" : "Show preview"}
            aria-label={view === "preview" ? "Show code" : "Show preview"}
            onClick={() => data.onToggleView(artifact.id)}
          >
            <Icon name={view === "preview" ? "ph:code" : "ph:squares-four"} />
          </button>
          <button
            type="button"
            className="canvas-artifact__btn"
            title="Refine with the familiar"
            aria-label="Refine"
            disabled={generating}
            onClick={() => data.onRefine(artifact.id)}
          >
            <Icon name="ph:sparkle" />
          </button>
          <button
            type="button"
            className="canvas-artifact__btn"
            title="Open in browser"
            aria-label="Open in browser"
            onClick={() => data.onOpenInBrowser(artifact.id)}
          >
            <Icon name="ph:arrow-square-out" />
          </button>
          <button
            type="button"
            className="canvas-artifact__btn"
            title="Duplicate"
            aria-label="Duplicate"
            onClick={() => data.onDuplicate(artifact.id)}
          >
            <Icon name="ph:copy" />
          </button>
          <button
            type="button"
            className="canvas-artifact__btn canvas-artifact__btn--danger"
            title="Delete"
            aria-label="Delete"
            onClick={() => {
              // Deleting a sketch is destructive and not undoable, so confirm first.
              const name = artifact.title?.trim() || "this sketch";
              if (window.confirm(`Delete ${name}? This can't be undone.`)) {
                data.onDelete(artifact.id);
              }
            }}
          >
            <Icon name="ph:trash" />
          </button>
        </div>
      </div>

      <div className="canvas-artifact__body nodrag">
        {view === "code" ? (
          <textarea
            className="canvas-artifact__code"
            spellCheck={false}
            value={artifact.code}
            placeholder={isReact ? "export default function App() { … }" : "<!doctype html> …"}
            onChange={(e) => data.onEditCode(artifact.id, e.target.value)}
          />
        ) : artifact.code ? (
          // Untrusted generated code runs ONLY inside this sandbox: allow-scripts
          // WITHOUT allow-same-origin means scripts execute but can't reach Cave's
          // origin, cookies, or storage. React artifacts additionally load the
          // offline sandbox runtime (same-origin asset, opaque-origin iframe).
          <iframe
            ref={frameRef}
            className="canvas-artifact__frame"
            title={artifact.title || "preview"}
            sandbox="allow-scripts allow-popups allow-modals"
            srcDoc={srcDoc}
          />
        ) : (
          <div className="canvas-artifact__placeholder">
            {generating ? "Generating…" : "No preview yet"}
          </div>
        )}

        {runtimeError && view === "preview" ? (
          <div className="canvas-artifact__error" role="alert">
            <Icon name="ph:warning-circle-fill" />
            <span className="canvas-artifact__error-msg">{runtimeError}</span>
            <button
              type="button"
              className="canvas-artifact__error-fix nodrag"
              onClick={() => data.onToggleView(artifact.id)}
            >
              View code
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
