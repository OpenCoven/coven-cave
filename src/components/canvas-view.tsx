"use client";

import "@xyflow/react/dist/style.css";
import "@/styles/canvas.css";

import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/lib/icon";
import { Popover, PopoverBody, PopoverItem, PopoverLabel, PopoverSeparator } from "@/components/ui/popover";
import type { Familiar } from "@/lib/types";
import { DEMO_MODE_EVENT, isDemoModeEnabled } from "@/lib/demo-mode";
import { type CanvasPosition, type CanvasPositions } from "@/lib/canvas-layout";
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

type Props = {
  familiars: Familiar[];
  activeFamiliarId: string | null;
  // Accepted for call-site compatibility with the workspace; the sketch canvas
  // doesn't render board cards, so they're unused here.
  onOpenCard?: (cardId: string) => void;
  onOpenUrl?: (url: string) => void;
};

const ARTIFACT_W = 420;
const ARTIFACT_H = 320;

const TRANSFORM_SUGGESTIONS = [
  { label: "Polish", prompt: "Polish the visual hierarchy, spacing, and typography without changing the content." },
  { label: "More data", prompt: "Add richer dashboard data, charts, and useful operational context." },
  { label: "Simplify", prompt: "Simplify the layout and make the most important information easier to scan." },
  { label: "Mobile", prompt: "Make this work better on a narrow mobile viewport." },
  { label: "Color pass", prompt: "Refine the color system so the interface feels more intentional and cohesive." },
];

const nodeTypes: NodeTypes = { artifact: ArtifactNode };

// ── Surface ───────────────────────────────────────────────────────────────--

function CanvasSurface({ familiars, activeFamiliarId }: Props) {
  const [positions, setPositions] = useState<CanvasPositions>({});
  const [artifacts, setArtifacts] = useState<CanvasArtifact[]>([]);
  const [nodes, setNodes, applyNodesChange] = useNodesState<Node>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [artifactView, setArtifactView] = useState<Record<string, "preview" | "code">>({});
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState("");
  const [transformArtifactId, setTransformArtifactId] = useState<string | null>(null);
  const [transformAsk, setTransformAsk] = useState("");
  // True while a user is dragging an artifact resize handle (see onNodesChange).
  const [isResizing, setIsResizing] = useState(false);
  // Template dropdown (where the Blank button lives).
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const templatesAnchorRef = useRef<HTMLButtonElement | null>(null);

  const artifactsRef = useRef<CanvasArtifact[]>([]);
  useEffect(() => {
    artifactsRef.current = artifacts;
  }, [artifacts]);
  const editTimers = useRef<Record<string, number>>({});
  const resizingNodeIds = useRef<Set<string>>(new Set());

  const transformArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === transformArtifactId) ?? null,
    [artifacts, transformArtifactId],
  );

  const load = useCallback(async () => {
    if (isDemoModeEnabled()) {
      // Demo mode has no persisted artifacts — start from the empty state.
      setArtifacts([]);
      setPositions({});
      setHasLoaded(true);
      return;
    }
    try {
      const canvasRes = await fetch("/api/canvas", { cache: "no-store" });
      const canvasJson = await canvasRes.json().catch(() => ({}));
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
    window.addEventListener(DEMO_MODE_EVENT, onReload);
    return () => window.removeEventListener(DEMO_MODE_EVENT, onReload);
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
      setTransformArtifactId(id);
      setTransformAsk("");
    },
    [],
  );

  const closeTransform = useCallback(() => {
    setTransformArtifactId(null);
    setTransformAsk("");
  }, []);

  const submitTransform = useCallback(() => {
    const ask = transformAsk.trim();
    if (!ask || !transformArtifact) return;
    void runGeneration(transformArtifact.id, ask, transformArtifact);
    closeTransform();
  }, [closeTransform, runGeneration, transformArtifact, transformAsk]);

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

  // ── Node assembly ──────────────────────────────────────────────────────────

  useEffect(() => {
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
    positions, artifacts, artifactView, generating, placementFor,
    onToggleView, onRefine, onDuplicate, onDeleteArtifact, onEditCode, onOpenInBrowser,
  ]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === "dimensions" && change.resizing) {
        resizingNodeIds.current.add(change.id);
        continue;
      }
      if (change.type !== "dimensions" || change.resizing || !change.dimensions || !resizingNodeIds.current.has(change.id)) continue;
      resizingNodeIds.current.delete(change.id);
      const { width, height } = change.dimensions;
      if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
      // Resizing from the top/left edge moves the node as well as sizing it, so
      // persist the node's CURRENT position — the stale saved entry would snap the
      // window back to its pre-resize origin on reload.
      const saved = nodes.find((node) => node.id === change.id)?.position ?? positions[change.id];
      if (!saved) continue;
      savePosition(change.id, { x: saved.x, y: saved.y, width, height });
    }
    // While any artifact is actively resizing, suppress iframe pointer capture so
    // the drag tracks the cursor smoothly even as it passes over a live preview.
    setIsResizing(resizingNodeIds.current.size > 0);
    applyNodesChange(changes);
  }, [applyNodesChange, nodes, positions, savePosition]);

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      savePosition(node.id, { x: node.position.x, y: node.position.y });
    },
    [savePosition],
  );

  const submitComposer = useCallback(() => {
    if (!composer.trim()) return;
    createArtifact(composer);
    setComposer("");
  }, [composer, createArtifact]);

  const sketchEmpty = hasLoaded && artifacts.length === 0;

  return (
    <div className={`canvas-view${isResizing ? " is-resizing" : ""}`} data-mode="canvas" data-layer="sketch">
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
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        {/* Nothing to map on an empty canvas — the minimap would just render a
            blank box, so only show it once there are nodes. */}
        {nodes.length > 0 ? <MiniMap pannable zoomable nodeStrokeWidth={2} /> : null}

        <Panel position="top-left" className="canvas-toolbar">
          <span className="canvas-toolbar__title">
            <Icon name="ph:bounding-box" /> Canvas
          </span>
          <span className="canvas-toolbar__count">{artifacts.length} examples</span>
        </Panel>

        {actionError ? (
          <Panel position="top-center" className="canvas-error" role="alert">
            {actionError}
          </Panel>
        ) : null}

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
      </ReactFlow>

      {sketchEmpty ? (
        <div className="canvas-empty">
          <Icon name="ph:sparkle" />
          <p className="canvas-empty__title">Spin up a UI</p>
          <p className="canvas-empty__hint">
            Describe a component or page below and a familiar will generate it as a live, editable preview. Add several to compare side by side.
          </p>
        </div>
      ) : null}
      {transformArtifact ? (
        <div
          className="canvas-transform"
          role="dialog"
          aria-modal="true"
          aria-labelledby="canvas-transform-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeTransform();
          }}
        >
          <form
            className="canvas-transform__panel"
            onSubmit={(event) => {
              event.preventDefault();
              submitTransform();
            }}
          >
            <div className="canvas-transform__header">
              <span className="canvas-transform__icon" aria-hidden>
                <Icon name="ph:magic-wand-fill" />
              </span>
              <div className="canvas-transform__title-wrap">
                <h2 id="canvas-transform-title">Transform {transformArtifact?.title ?? "artifact"}</h2>
                <p>
                  {transformArtifact.kind?.toUpperCase() ?? "HTML"} · describe the change and keep iterating on this node.
                </p>
              </div>
              <button
                type="button"
                className="canvas-transform__close"
                aria-label="Cancel transform"
                onClick={closeTransform}
              >
                <Icon name="ph:x" />
              </button>
            </div>
            <textarea
              autoFocus
              className="canvas-transform__input"
              rows={4}
              value={transformAsk}
              placeholder="Make the cards denser, add a revenue trend chart, or use a quieter operations dashboard style..."
              onChange={(event) => setTransformAsk(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeTransform();
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submitTransform();
                }
              }}
            />
            <div className="canvas-transform__suggestions" aria-label="Suggested transforms">
              {TRANSFORM_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => setTransformAsk(suggestion.prompt)}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
            <div className="canvas-transform__footer">
              <span>Cmd+Enter to apply</span>
              <div className="canvas-transform__actions">
                <button type="button" className="canvas-transform__cancel" onClick={closeTransform}>
                  Cancel
                </button>
                <button type="submit" className="canvas-transform__apply" disabled={!transformAsk.trim()}>
                  <Icon name="ph:sparkle" /> Apply change
                </button>
              </div>
            </div>
          </form>
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
