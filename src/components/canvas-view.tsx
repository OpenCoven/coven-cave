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
import { Popover, PopoverBody, PopoverItem, PopoverLabel, PopoverSeparator } from "@/components/ui/popover";
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
import {
  buildPreviewSrcDoc,
  buildRefinePrompt,
  buildSketchPrompt,
  clampArtifactCode,
  CANVAS_TEMPLATES,
  STARTER_ARTIFACT_HTML,
  titleFromPrompt,
  type CanvasArtifact,
  type CanvasTemplate,
} from "@/lib/canvas-artifacts";
import { buildReactSrcDoc } from "@/lib/canvas-react-harness";
import { generateArtifactCode } from "@/lib/canvas-generate";
import { ArtifactNode, type ArtifactFlowNode } from "@/components/canvas-artifact-node";

type CanvasLayer = "triage" | "sketch";

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

const ARTIFACT_W = 420;
const ARTIFACT_H = 320;

function loadLayer(): CanvasLayer {
  if (typeof window === "undefined") return "triage";
  const v = localStorage.getItem("cave:canvas:layer");
  return v === "sketch" ? "sketch" : "triage";
}

// ── Issue node (triage) ─────────────────────────────────────────────────────

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

const nodeTypes: NodeTypes = { issue: IssueNode, artifact: ArtifactNode };

// ── Band guides (triage only) ───────────────────────────────────────────────
//
// The triage bands live in world space but are drawn as a screen overlay that
// re-projects on every pan/zoom (React Flow keeps node DOM in a transformed
// layer we can't inject into, so we mirror the transform ourselves).

function BandGuides() {
  const { x, zoom } = useViewport();
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
  const [layer, setLayer] = useState<CanvasLayer>(loadLayer);
  const [cards, setCards] = useState<Card[]>([]);
  const [positions, setPositions] = useState<CanvasPositions>({});
  const [artifacts, setArtifacts] = useState<CanvasArtifact[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [artifactView, setArtifactView] = useState<Record<string, "preview" | "code">>({});
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState("");
  // Template dropdown (where the Blank button lives).
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const templatesAnchorRef = useRef<HTMLButtonElement | null>(null);

  const artifactsRef = useRef<CanvasArtifact[]>([]);
  useEffect(() => {
    artifactsRef.current = artifacts;
  }, [artifacts]);
  const editTimers = useRef<Record<string, number>>({});
  const resizingNodeIds = useRef<Set<string>>(new Set());

  const familiarsById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);

  const filtered = useMemo(
    () => cards.filter((c) => activeFamiliarId === null || c.familiarId === activeFamiliarId),
    [cards, activeFamiliarId],
  );

  const setLayerPersisted = useCallback((next: CanvasLayer) => {
    setLayer(next);
    setActionError(null);
    if (typeof window !== "undefined") localStorage.setItem("cave:canvas:layer", next);
  }, []);

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
      setArtifacts((canvasJson?.artifacts as CanvasArtifact[]) ?? []);
    } catch {
      // Leave whatever we had; the empty state covers a cold failure.
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onReload = () => load();
    window.addEventListener("cave:board:reload", onReload);
    window.addEventListener(DEMO_MODE_EVENT, onReload);
    return () => {
      window.removeEventListener("cave:board:reload", onReload);
      window.removeEventListener(DEMO_MODE_EVENT, onReload);
    };
  }, [load]);

  // ── Artifact persistence ──────────────────────────────────────────────────

  const persistArtifact = useCallback((art: CanvasArtifact) => {
    void fetch("/api/canvas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifact: art }),
    }).catch(() => undefined);
  }, []);

  const savePosition = useCallback((id: string, pos: CanvasPosition) => {
    setPositions((prev) => ({ ...prev, [id]: pos }));
    void fetch("/api/canvas", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positions: { [id]: pos } }),
    }).catch(() => undefined);
  }, []);

  // ── Generation ────────────────────────────────────────────────────────────

  const runGeneration = useCallback(
    async (id: string, ask: string, refineOf?: CanvasArtifact) => {
      const familiarId = activeFamiliarId ?? familiars[0]?.id ?? null;
      if (!familiarId) {
        setActionError("Pick a familiar first — generation runs through it.");
        return;
      }
      setActionError(null);
      setGenerating((prev) => new Set(prev).add(id));
      const sendPrompt = refineOf
        ? buildRefinePrompt(refineOf.code, ask, refineOf.kind ?? "html")
        : buildSketchPrompt(ask);
      const result = await generateArtifactCode({ prompt: sendPrompt, familiarId });
      setGenerating((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (result.code) {
        const code = clampArtifactCode(result.code);
        const kind = result.kind ?? "html";
        const updatedAt = new Date().toISOString();
        const current = artifactsRef.current.find((a) => a.id === id);
        const updated: CanvasArtifact | null = current ? { ...current, code, kind, updatedAt } : null;
        if (updated) {
          setArtifacts((prev) => prev.map((a) => (a.id === id ? updated : a)));
          setArtifactView((prev) => ({ ...prev, [id]: "preview" }));
          persistArtifact(updated);
        }
      } else {
        setActionError(result.error ?? "Generation failed.");
      }
    },
    [activeFamiliarId, familiars, persistArtifact],
  );

  const placementFor = useCallback((index: number): CanvasPosition => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    return { x: 40 + col * (ARTIFACT_W + 40), y: 40 + row * (ARTIFACT_H + 48) };
  }, []);

  const createArtifact = useCallback(
    (ask: string, opts?: { blank?: boolean; template?: CanvasTemplate }) => {
      const prompt = ask.trim();
      const template = opts?.template;
      // Blank and template starters skip generation; a plain ask needs a prompt.
      const starter = opts?.blank || !!template;
      if (!starter && !prompt) return;
      const id = `art-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const art: CanvasArtifact = {
        id,
        title: template ? template.label : opts?.blank ? "Blank sketch" : titleFromPrompt(prompt),
        prompt,
        code: template ? template.code : opts?.blank ? STARTER_ARTIFACT_HTML : "",
        kind: template ? template.kind : "html",
        createdAt: now,
        updatedAt: now,
      };
      setArtifacts((prev) => [...prev, art]);
      const pos = placementFor(artifactsRef.current.length);
      savePosition(id, pos);
      // Templates open to their preview (they're complete); Blank opens to code
      // for hand-writing.
      setArtifactView((prev) => ({ ...prev, [id]: opts?.blank ? "code" : "preview" }));
      persistArtifact(art);
      if (!starter) void runGeneration(id, prompt);
    },
    [placementFor, savePosition, persistArtifact, runGeneration],
  );

  // ── Per-artifact node handlers ─────────────────────────────────────────────

  const onToggleView = useCallback((id: string) => {
    setArtifactView((prev) => ({ ...prev, [id]: prev[id] === "code" ? "preview" : "code" }));
  }, []);

  const onRefine = useCallback(
    (id: string) => {
      const art = artifactsRef.current.find((a) => a.id === id);
      if (!art) return;
      const ask = window.prompt("How should this change?", "");
      if (ask === null || !ask.trim()) return;
      void runGeneration(id, ask.trim(), art);
    },
    [runGeneration],
  );

  const onDuplicate = useCallback(
    (id: string) => {
      const art = artifactsRef.current.find((a) => a.id === id);
      if (!art) return;
      const copyId = `art-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const copy: CanvasArtifact = { ...art, id: copyId, title: `${art.title} copy`, createdAt: now, updatedAt: now };
      setArtifacts((prev) => [...prev, copy]);
      const base = positions[id] ?? placementFor(artifactsRef.current.length);
      savePosition(copyId, { x: base.x + 32, y: base.y + 32 });
      setArtifactView((prev) => ({ ...prev, [copyId]: prev[id] ?? "preview" }));
      persistArtifact(copy);
    },
    [positions, placementFor, savePosition, persistArtifact],
  );

  const onDeleteArtifact = useCallback((id: string) => {
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    setPositions((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    void fetch("/api/canvas", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => undefined);
  }, []);

  const onEditCode = useCallback(
    (id: string, code: string) => {
      const clamped = clampArtifactCode(code);
      const updatedAt = new Date().toISOString();
      setArtifacts((prev) => prev.map((a) => (a.id === id ? { ...a, code: clamped, updatedAt } : a)));
      window.clearTimeout(editTimers.current[id]);
      editTimers.current[id] = window.setTimeout(() => {
        const a = artifactsRef.current.find((x) => x.id === id);
        if (a) persistArtifact(a);
      }, 700);
    },
    [persistArtifact],
  );

  const onOpenInBrowser = useCallback((id: string) => {
    const art = artifactsRef.current.find((a) => a.id === id);
    if (!art) return;
    try {
      // blob: inherits our origin, so the React harness's /sandbox runtime path
      // still resolves in the opened tab.
      const doc = art.kind === "react" ? buildReactSrcDoc(art.code) : buildPreviewSrcDoc(art.code);
      const blob = new Blob([doc], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    } catch {
      /* popup blocked or unsupported — preview node still works */
    }
  }, []);

  // ── Node assembly (per layer) ──────────────────────────────────────────────

  useEffect(() => {
    if (layer === "triage") {
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
      return;
    }
    setNodes(
      artifacts.map((art, i) => {
        const saved = positions[art.id] ?? placementFor(i);
        return {
          id: art.id,
          type: "artifact" as const,
          position: saved,
          dragHandle: ".canvas-artifact__grip",
          style: { width: saved.width ?? ARTIFACT_W, height: saved.height ?? ARTIFACT_H },
          data: {
            artifact: art,
            view: artifactView[art.id] ?? "preview",
            generating: generating.has(art.id),
            onToggleView,
            onRefine,
            onDuplicate,
            onDelete: onDeleteArtifact,
            onEditCode,
            onOpenInBrowser,
          },
        };
      }) as ArtifactFlowNode[],
    );
  }, [
    layer, filtered, positions, familiarsById, onOpenCard, onOpenUrl, artifacts, artifactView,
    generating, placementFor, onToggleView, onRefine, onDuplicate, onDeleteArtifact, onEditCode, onOpenInBrowser,
  ]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (layer === "sketch") {
      for (const change of changes) {
        if (change.type === "dimensions" && change.resizing) {
          resizingNodeIds.current.add(change.id);
          continue;
        }
        if (change.type !== "dimensions" || change.resizing || !change.dimensions || !resizingNodeIds.current.has(change.id)) continue;
        resizingNodeIds.current.delete(change.id);
        const { width, height } = change.dimensions;
        if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
        const saved = positions[change.id] ?? nodes.find((node) => node.id === change.id)?.position;
        if (!saved) continue;
        savePosition(change.id, { x: saved.x, y: saved.y, width, height });
      }
    }
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, [layer, nodes, positions, savePosition]);

  const patchStatus = useCallback(async (id: string, status: CardStatus) => {
    const prevStatus = cards.find((c) => c.id === id)?.status;
    if (!prevStatus || prevStatus === status) return;
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
    (_e: unknown, node: Node) => {
      savePosition(node.id, { x: node.position.x, y: node.position.y });
      // Triage cards retriage by which band they land in; artifacts are free.
      if (node.type === "issue") {
        const centerX = node.position.x + CANVAS_NODE_WIDTH / 2;
        void patchStatus(node.id, bandForX(centerX));
      }
    },
    [savePosition, patchStatus],
  );

  const arrange = useCallback(() => {
    const next = autoArrange(filtered);
    setPositions((prev) => ({ ...prev, ...next }));
    if (isDemoModeEnabled()) return;
    void fetch("/api/canvas", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positions: next }),
    }).catch(() => undefined);
  }, [filtered]);

  const submitComposer = useCallback(() => {
    if (!composer.trim()) return;
    createArtifact(composer);
    setComposer("");
  }, [composer, createArtifact]);

  const isSketch = layer === "sketch";
  const triageEmpty = hasLoaded && !isSketch && filtered.length === 0;
  const sketchEmpty = hasLoaded && isSketch && artifacts.length === 0;

  return (
    <div className="canvas-view" data-mode="canvas" data-layer={layer}>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        {isSketch ? null : <BandGuides />}
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        {/* Nothing to map on an empty canvas — the minimap would just render a
            blank box, so only show it once there are nodes. */}
        {nodes.length > 0 ? <MiniMap pannable zoomable nodeStrokeWidth={2} /> : null}

        <Panel position="top-left" className="canvas-toolbar">
          <span className="canvas-toolbar__title">
            <Icon name="ph:bounding-box" /> Canvas
          </span>
          <div className="canvas-segmented" role="tablist" aria-label="Canvas mode">
            <button
              type="button"
              role="tab"
              aria-selected={!isSketch}
              className={`canvas-segmented__btn${!isSketch ? " is-active" : ""}`}
              onClick={() => setLayerPersisted("triage")}
            >
              Triage
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isSketch}
              className={`canvas-segmented__btn${isSketch ? " is-active" : ""}`}
              onClick={() => setLayerPersisted("sketch")}
            >
              Sketch
            </button>
          </div>
          {isSketch ? (
            <span className="canvas-toolbar__count">{artifacts.length} examples</span>
          ) : (
            <>
              <span className="canvas-toolbar__count">{filtered.length} issues</span>
              <button
                type="button"
                className="canvas-toolbar__btn"
                onClick={arrange}
                title="Tidy cards into their status bands"
              >
                <Icon name="ph:arrows-clockwise" /> Auto-arrange
              </button>
            </>
          )}
        </Panel>

        {actionError ? (
          <Panel position="top-center" className="canvas-error" role="alert">
            {actionError}
          </Panel>
        ) : null}

        {isSketch ? (
          <Panel position="bottom-center" className="canvas-composer">
            <textarea
              className="canvas-composer__input"
              placeholder="Describe a UI to spin up — e.g. “a pricing page with three tiers and a toggle”"
              value={composer}
              rows={2}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitComposer();
                }
              }}
            />
            <div className="canvas-composer__actions">
              <span className="canvas-composer__new">
                <button
                  ref={templatesAnchorRef}
                  type="button"
                  className="canvas-composer__blank"
                  title="Start from a blank sketch or a template"
                  aria-haspopup="menu"
                  aria-expanded={templatesOpen}
                  onClick={() => setTemplatesOpen((v) => !v)}
                >
                  <Icon name="ph:plus" /> Blank
                  <Icon name="ph:caret-down" width={11} />
                </button>
                <Popover
                  open={templatesOpen}
                  onOpenChange={setTemplatesOpen}
                  anchorRef={templatesAnchorRef}
                  placement="top-start"
                  minWidth={232}
                >
                  <PopoverBody>
                    <PopoverItem
                      icon="ph:file-dashed"
                      onSelect={() => { createArtifact("", { blank: true }); setTemplatesOpen(false); }}
                    >
                      Blank sketch
                    </PopoverItem>
                    <PopoverSeparator />
                    <PopoverLabel>Templates</PopoverLabel>
                    {CANVAS_TEMPLATES.map((t) => (
                      <PopoverItem
                        key={t.id}
                        icon={t.icon}
                        onSelect={() => { createArtifact("", { template: t }); setTemplatesOpen(false); }}
                      >
                        {t.label}
                      </PopoverItem>
                    ))}
                  </PopoverBody>
                </Popover>
              </span>
              <button
                type="button"
                className="canvas-composer__send"
                disabled={!composer.trim()}
                onClick={submitComposer}
              >
                <Icon name="ph:sparkle" /> Generate
              </button>
            </div>
          </Panel>
        ) : null}
      </ReactFlow>

      {triageEmpty ? (
        <div className="canvas-empty">
          <Icon name="ph:bounding-box" />
          <p className="canvas-empty__title">No issues to triage</p>
          <p className="canvas-empty__hint">
            Cards from the Board appear here. Drag a card across a band to retriage it, or switch to Sketch to build UIs.
          </p>
        </div>
      ) : null}
      {sketchEmpty ? (
        <div className="canvas-empty">
          <Icon name="ph:sparkle" />
          <p className="canvas-empty__title">Spin up a UI</p>
          <p className="canvas-empty__hint">
            Describe a component or page below and a familiar will generate it as a live, editable preview. Add several to compare side by side.
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
