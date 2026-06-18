"use client";

import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { Icon } from "@/lib/icon";
import { buildPreviewSrcDoc, type CanvasArtifact } from "@/lib/canvas-artifacts";

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
  return (
    <div className={`canvas-artifact${selected ? " is-selected" : ""}`}>
      <NodeResizer minWidth={260} minHeight={200} isVisible={selected} />
      {/* Drag handle — the iframe swallows pointer events, so the node is only
          draggable by this header (see dragHandle wiring in canvas-view). */}
      <div className="canvas-artifact__grip">
        <span className="canvas-artifact__title" title={artifact.prompt || artifact.title}>
          {generating ? <span className="canvas-artifact__spinner" aria-hidden /> : <Icon name="ph:bounding-box" />}
          {artifact.title || "Untitled"}
        </span>
        <div className="canvas-artifact__actions nodrag">
          <button
            type="button"
            className={`canvas-artifact__btn${view === "preview" ? " is-active" : ""}`}
            title="Preview"
            aria-label="Preview"
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
            onClick={() => data.onDelete(artifact.id)}
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
            placeholder="<!doctype html> …"
            onChange={(e) => data.onEditCode(artifact.id, e.target.value)}
          />
        ) : artifact.code ? (
          // Untrusted generated markup runs ONLY inside this sandbox:
          // allow-scripts WITHOUT allow-same-origin means scripts execute but
          // can't reach Cave's origin, cookies, or storage.
          <iframe
            className="canvas-artifact__frame"
            title={artifact.title || "preview"}
            sandbox="allow-scripts allow-popups allow-modals"
            srcDoc={buildPreviewSrcDoc(artifact.code)}
          />
        ) : (
          <div className="canvas-artifact__placeholder">
            {generating ? "Generating…" : "No preview yet"}
          </div>
        )}
      </div>
    </div>
  );
}
