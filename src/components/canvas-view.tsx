"use client";

import "@xyflow/react/dist/style.css";
import "@/styles/canvas.css";

import {
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useViewport,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/lib/icon";
import { type Card, type CardStatus } from "@/lib/cave-board-types";
import type { Familiar } from "@/lib/types";
import { DEMO_BOARD_CARDS } from "@/lib/demo-seed";
import { DEMO_MODE_EVENT, isDemoModeEnabled } from "@/lib/demo-mode";
import {
  autoArrange,
  bandForX,
  bandLeft,
  BAND_LABELS,
  BAND_WIDTH,
  CANVAS_BANDS,
  CANVAS_NODE_WIDTH,
  resolvePositions,
  type CanvasPosition,
  type CanvasPositions,
} from "@/lib/canvas-layout";

type Props = {
  familiars: Familiar[];
  activeFamiliarId: string | null;
  onOpenCard?: (cardId: string) => void;
  onOpenUrl?: (url: string) => void;
};

type IssueNodeData = {
  card: Card;
  familiarName: string | null;
  onOpenCard?: (cardId: string) => void;
  onOpenUrl?: (url: string) => void;
};

type IssueFlowNode = Node<IssueNodeData & Record<string, unknown>, "issue">;

// ── Node ────────────────────────────────────────────────────────────────────

function IssueNode({ data }: NodeProps<IssueFlowNode>) {
  const { card, familiarName, onOpenCard, onOpenUrl } = data;
  const gh = card.github?.[0];
  const ghUrl = gh?.url ?? card.links?.[0];
  return (
    <div className={`canvas-issue canvas-issue--${card.status}`}>
      <div className="canvas-issue__top">
        <span className={`canvas-issue__prio canvas-issue__prio--${card.priority}`} aria-hidden />
        <span className="canvas-issue__status">{BAND_LABELS[card.status]}</span>
        {gh?.number ? <span className="canvas-issue__num">#{gh.number}</span> : null}
      </div>
      <button
        type="button"
        className="canvas-issue__title nodrag"
        title="Open this card"
        onClick={() => onOpenCard?.(card.id)}
      >
        {card.title || "Untitled"}
      </button>
      <div className="canvas-issue__meta">
        {familiarName ? <span className="canvas-issue__familiar">{familiarName}</span> : null}
        {card.labels?.slice(0, 3).map((label) => (
          <span key={label} className="canvas-issue__label">
            {label}
          </span>
        ))}
      </div>
      {ghUrl ? (
        <button
          type="button"
          className="canvas-issue__open nodrag"
          title="Open link"
          aria-label="Open link"
          onClick={() => onOpenUrl?.(ghUrl)}
        >
          <Icon name="ph:arrow-square-out" />
        </button>
      ) : null}
    </div>
  );
}

const nodeTypes: NodeTypes = { issue: IssueNode };

// ── Band guides ───────────────────────────────────────────────────────────--
//
// The triage bands live in world space but are drawn as a screen overlay that
// re-projects on every pan/zoom (React Flow keeps node DOM in a transformed
// layer we can't inject into, so we mirror the transform ourselves). Each
// band gets a left divider and a header label pinned to the top of the pane.

function BandGuides() {
  const { x, y: _y, zoom } = useViewport();
  return (
    <div className="canvas-bands" aria-hidden>
      {CANVAS_BANDS.map((status, i) => {
        const left = bandLeft(i) * zoom + x;
        const width = BAND_WIDTH * zoom;
        return (
          <div key={status} className="canvas-band" style={{ left, width }}>
            <div className="canvas-band__header">{BAND_LABELS[status]}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Surface ───────────────────────────────────────────────────────────────--

function CanvasSurface({ familiars, activeFamiliarId, onOpenCard, onOpenUrl }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [positions, setPositions] = useState<CanvasPositions>({});
  const [nodes, setNodes] = useState<IssueFlowNode[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const familiarsById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);

  const filtered = useMemo(
    () => cards.filter((c) => activeFamiliarId === null || c.familiarId === activeFamiliarId),
    [cards, activeFamiliarId],
  );

  const load = useCallback(async () => {
    if (isDemoModeEnabled()) {
      setCards(DEMO_BOARD_CARDS as Card[]);
      setPositions({});
      setHasLoaded(true);
      return;
    }
    try {
      const [boardRes, canvasRes] = await Promise.all([
        fetch("/api/board", { cache: "no-store" }),
        fetch("/api/canvas", { cache: "no-store" }),
      ]);
      const boardJson = await boardRes.json();
      const canvasJson = await canvasRes.json().catch(() => ({}));
      if (boardJson?.ok) setCards(boardJson.cards as Card[]);
      setPositions((canvasJson?.positions as CanvasPositions) ?? {});
    } catch {
      // Leave whatever we had; the empty state covers a cold failure.
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The Board emits this after any mutation; keep the canvas in sync.
  useEffect(() => {
    const onReload = () => load();
    window.addEventListener("cave:board:reload", onReload);
    window.addEventListener(DEMO_MODE_EVENT, onReload);
    return () => {
      window.removeEventListener("cave:board:reload", onReload);
      window.removeEventListener(DEMO_MODE_EVENT, onReload);
    };
  }, [load]);

  // Rebuild nodes whenever the card set, positions, or familiar lookup change.
  // resolvePositions keeps saved coordinates and auto-places newcomers.
  useEffect(() => {
    const resolved = resolvePositions(filtered, positions);
    setNodes(
      filtered.map((card) => ({
        id: card.id,
        type: "issue" as const,
        position: resolved[card.id] ?? { x: 0, y: 0 },
        data: {
          card,
          familiarName: card.familiarId ? familiarsById.get(card.familiarId)?.name ?? null : null,
          onOpenCard,
          onOpenUrl,
        },
      })),
    );
  }, [filtered, positions, familiarsById, onOpenCard, onOpenUrl]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev) as IssueFlowNode[]);
  }, []);

  const savePosition = useCallback((id: string, pos: CanvasPosition) => {
    setPositions((prev) => ({ ...prev, [id]: pos }));
    void fetch("/api/canvas", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positions: { [id]: pos } }),
    }).catch(() => {
      /* position persistence is best-effort; layout rebuilds from status */
    });
  }, []);

  const patchStatus = useCallback(async (id: string, status: CardStatus) => {
    const prevStatus = cards.find((c) => c.id === id)?.status;
    if (!prevStatus || prevStatus === status) return;
    // Optimistic: reflect the new band immediately, revert on failure.
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    setActionError(null);
    try {
      const res = await fetch(`/api/board/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status: prevStatus } : c)));
      setActionError("Couldn't move that card — change reverted.");
    }
  }, [cards]);

  const onNodeDragStop = useCallback(
    (_e: unknown, node: IssueFlowNode) => {
      savePosition(node.id, { x: node.position.x, y: node.position.y });
      const centerX = node.position.x + CANVAS_NODE_WIDTH / 2;
      void patchStatus(node.id, bandForX(centerX));
    },
    [savePosition, patchStatus],
  );

  const arrange = useCallback(() => {
    if (isDemoModeEnabled()) {
      setPositions(autoArrange(filtered));
      return;
    }
    const next = autoArrange(filtered);
    setPositions(next);
    void fetch("/api/canvas", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positions: next }),
    }).catch(() => undefined);
  }, [filtered]);

  const isEmpty = hasLoaded && filtered.length === 0;

  return (
    <div className="canvas-view" data-mode="canvas">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <BandGuides />
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeStrokeWidth={2} />
        <Panel position="top-left" className="canvas-toolbar">
          <span className="canvas-toolbar__title">
            <Icon name="ph:bounding-box" /> Triage Canvas
          </span>
          <span className="canvas-toolbar__count">{filtered.length} issues</span>
          <button type="button" className="canvas-toolbar__btn" onClick={arrange} title="Tidy cards into their status bands">
            <Icon name="ph:arrows-clockwise" /> Auto-arrange
          </button>
        </Panel>
        {actionError ? (
          <Panel position="top-center" className="canvas-error" role="alert">
            {actionError}
          </Panel>
        ) : null}
      </ReactFlow>
      {isEmpty ? (
        <div className="canvas-empty">
          <Icon name="ph:bounding-box" />
          <p className="canvas-empty__title">No issues to triage</p>
          <p className="canvas-empty__hint">
            Cards from the Board appear here as you create them. Drag a card across a band to retriage it.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function CanvasView(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasSurface {...props} />
    </ReactFlowProvider>
  );
}
