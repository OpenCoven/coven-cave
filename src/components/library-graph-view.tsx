"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { Modal } from "@/components/ui/modal";
import { LibraryGraph3D } from "@/components/library-graph-3d";
import type { GraphifyResult, GraphifyGraph, GraphifyNode, GraphifyEdge, GraphifyRunSnapshot } from "@/lib/library-types";

// ── Types ────────────────────────────────────────────────────────

type GraphMeta = Omit<GraphifyResult, "graphJson" | "reportMd">;

// ── NodeDetailPanel ──────────────────────────────────────────────

function NodeDetailPanel({
  node,
  graph,
  onClose,
}: {
  node: GraphifyNode;
  graph: GraphifyGraph;
  onClose: () => void;
}) {
  const connected = graph.edges
    .filter((e) => {
      const src = typeof e.source === "object"
        ? (e.source as { id?: string }).id ?? String(e.source)
        : String(e.source);
      const tgt = typeof e.target === "object"
        ? (e.target as { id?: string }).id ?? String(e.target)
        : String(e.target);
      return src === node.id || tgt === node.id;
    })
    .map((e) => {
      const src = typeof e.source === "object"
        ? (e.source as { id?: string }).id ?? String(e.source)
        : String(e.source);
      const tgt = typeof e.target === "object"
        ? (e.target as { id?: string }).id ?? String(e.target)
        : String(e.target);
      const otherId = src === node.id ? tgt : src;
      const other = graph.nodes.find((n) => n.id === otherId);
      return { edge: e, other, direction: src === node.id ? ("out" as const) : ("in" as const) };
    });

  return (
    <div className="flex h-full flex-col overflow-hidden border-l border-[var(--border-hairline)] bg-[var(--bg-base)] p-4 text-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="truncate font-semibold text-[var(--text-primary)]">{node.label}</span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          aria-label="Close"
        >
          <Icon name="ph:x-bold" width={12} />
        </button>
      </div>

      {node.type && (
        <div className="mb-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Type </span>
          <span className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
            {String(node.type)}
          </span>
        </div>
      )}

      {typeof node.weight === "number" && (
        <div className="mb-2 text-xs text-[var(--text-muted)]">
          Weight: <span className="text-[var(--text-secondary)]">{node.weight}</span>
        </div>
      )}

      {Array.isArray(node.tags) && (node.tags as string[]).length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {(node.tags as string[]).map((tag, i) => (
            <span key={i} className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
              {tag}
            </span>
          ))}
        </div>
      )}

      {connected.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Connections ({connected.length})
          </div>
          <ul className="space-y-1">
            {connected.map(({ other, edge, direction }, i) => (
              <li key={i} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span className="shrink-0 text-[var(--text-muted)]">{direction === "out" ? "\u2192" : "\u2190"}</span>
                <span className="truncate">
                  {other?.label ?? (direction === "out" ? String(edge.target) : String(edge.source))}
                </span>
                {edge.label && (
                  <span className="ml-auto shrink-0 rounded bg-[var(--bg-raised)] px-1 py-0.5 text-[9px] text-[var(--text-muted)]">
                    {String(edge.label)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── RunGraphifyModal ─────────────────────────────────────────────

async function pickGraphifyDirectory(): Promise<{ path: string | null; error: string | null }> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return { path: null, error: "Folder picker is available in the desktop app." };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke("shell_pick_directory") as string | null;
    return { path, error: null };
  } catch (err) {
    return { path: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function RunGraphifyModal({
  open,
  onClose,
  onResult,
  onRunStart,
}: {
  open: boolean;
  onClose: () => void;
  onResult: (result: GraphifyResult) => void;
  onRunStart: (snapshot: GraphifyRunSnapshot) => void;
}) {
  const [targetPath, setTargetPath] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseDirectory = async () => {
    if (loading) return;
    setError(null);
    const picked = await pickGraphifyDirectory();
    if (picked.path) setTargetPath(picked.path);
    if (picked.error) setError(picked.error);
  };

  const run = async () => {
    if (!targetPath.trim() || loading) return;
    setLoading(true);
    setError(null);
    const trimmedTargetPath = targetPath.trim();
    const runLabel = label.trim() || trimmedTargetPath.split("/").filter(Boolean).at(-1) || "Graphify run";
    onRunStart({
      id: `live_${Date.now()}`,
      targetPath: trimmedTargetPath,
      label: runLabel,
      generatedAt: new Date().toISOString(),
      status: "started",
      nodeCount: 0,
      edgeCount: 0,
    });
    try {
      const res = await fetch("/api/library/graph", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetPath: targetPath.trim(), label: label.trim() || undefined }),
      });
      const json = await res.json() as { ok: boolean; result?: GraphifyResult; error?: string };
      if (!json.ok || !json.result) {
        setError(json.error ?? "Graphify failed");
        return;
      }
      onResult(json.result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) { setTargetPath(""); setLabel(""); setError(null); }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={["Knowledge Graph", "Run Graphify"]}
      footerActions={
        <>
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-card)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-raised)]"
          >
            Cancel
          </button>
          <button
            onClick={() => void run()}
            disabled={!targetPath.trim() || loading}
            className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-card)] disabled:opacity-50"
          >
            {loading ? "Running\u2026" : "Run Graphify"}
          </button>
        </>
      }
    >
      <div className="mb-4">
        <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Target folder path
        </label>
        <div className="flex gap-2">
          <input
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            placeholder="/Users/buns/Documents/GitHub/my-project"
            autoFocus
            className="min-w-0 flex-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
          />
          <button
            type="button"
            aria-label="Choose Graphify target folder"
            title="Choose Graphify target folder"
            onClick={() => void chooseDirectory()}
            disabled={loading}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-card)] disabled:opacity-50"
          >
            <Icon name="ph:folder-open" width={14} />
            Choose
          </button>
        </div>
      </div>
      <div className="mb-4">
        <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Label (optional)
        </label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="My Project"
          className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
        />
      </div>
      {loading && (
        <div className="mb-3 rounded border border-[var(--border-hairline)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-muted)]">
          Running graphify \u2014 this can take up to 2 minutes for large codebases\u2026
        </div>
      )}
      {error && (
        <div className="mb-3 rounded border border-[var(--border-hairline)] bg-[var(--bg-card)] px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}
    </Modal>
  );
}

// ── LibraryGraphView (main export) ───────────────────────────────

export function LibraryGraphView() {
  const [graphMetas, setGraphMetas] = useState<GraphMeta[]>([]);
  const [activeResult, setActiveResult] = useState<GraphifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [liveSnapshots, setLiveSnapshots] = useState<GraphifyRunSnapshot[]>([]);

  const loadMetas = useCallback(async () => {
    try {
      const res = await fetch("/api/library/graph", { cache: "no-store" });
      const json = await res.json() as { ok: boolean; graphs?: GraphMeta[] };
      if (json.ok) setGraphMetas(json.graphs ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void loadMetas(); }, [loadMetas]);

  const loadGraphById = async (id: string) => {
    setLoading(true);
    setError(null);
    setSelectedNodeId(null);
    setFilter("");
    try {
      const res = await fetch(`/api/library/graph?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; result?: GraphifyResult; error?: string };
      if (json.ok && json.result) {
        setActiveResult(json.result);
      } else {
        setError(json.error ?? "Failed to load graph");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleNewResult = (result: GraphifyResult) => {
    setActiveResult(result);
    setLiveSnapshots((prev) => prev.filter((snapshot) => snapshot.targetPath !== result.targetPath));
    setGraphMetas((prev) => [
      { id: result.id, label: result.label, targetPath: result.targetPath, generatedAt: result.generatedAt },
      ...prev.filter((m) => m.id !== result.id),
    ]);
    setSelectedNodeId(null);
    setFilter("");
  };

  const handleRunStart = (snapshot: GraphifyRunSnapshot) => {
    setLiveSnapshots((prev) => [...prev.filter((entry) => entry.targetPath !== snapshot.targetPath || entry.status !== "started"), snapshot]);
  };

  const selectedNode = activeResult?.graphJson.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const activeSnapshots = activeResult
    ? [...(activeResult.snapshots ?? []), ...liveSnapshots.filter((snapshot) => snapshot.targetPath === activeResult.targetPath)]
    : [];
  const dateFmt = new Intl.DateTimeFormat([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="library-graph-toolbar flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2">
        <Icon name="ph:graph" width={15} className="text-[var(--text-muted)]" />
        <span className="text-sm font-medium text-[var(--text-primary)]">Knowledge Graph</span>

        {graphMetas.length > 0 && (
          <select
            className="library-graph-select ml-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--text-secondary)] outline-none"
            value={activeResult?.id ?? ""}
            onChange={(e) => { if (e.target.value) void loadGraphById(e.target.value); }}
          >
            <option value="">{activeResult ? activeResult.label : "\u2014 Previous runs \u2014"}</option>
            {graphMetas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} \u00b7 {dateFmt.format(new Date(m.generatedAt))}
              </option>
            ))}
          </select>
        )}

        <div className="library-graph-actions ml-auto flex items-center gap-2">
          {activeResult && (
            <>
              <div className="relative">
                <Icon name="ph:magnifying-glass" width={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={filter}
                  onChange={(e) => { setFilter(e.target.value); setSelectedNodeId(null); }}
                  placeholder="Filter nodes\u2026"
                  className="h-7 w-36 rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] pl-6 pr-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
                />
              </div>
              {activeResult.reportMd && (
                <button
                  type="button"
                  onClick={() => setShowReport((v) => !v)}
                  className={`flex items-center gap-1 rounded border border-[var(--border-hairline)] px-2 py-1 text-xs transition-colors ${showReport ? "bg-[var(--accent-presence)] text-white" : "bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"}`}
                >
                  <Icon name="ph:file-text" width={11} />
                  Report
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setRunModalOpen(true)}
            className="flex items-center gap-1.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-card)]"
          >
            <Icon name="ph:arrows-clockwise" width={12} />
            Run Graphify
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex min-h-0 flex-1">
        {loading && (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-muted)]">
            Loading graph\u2026
          </div>
        )}

        {error && (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-sm rounded border border-[var(--border-hairline)] bg-[var(--bg-card)] p-4 text-sm text-red-400">
              {error}
            </div>
          </div>
        )}

        {!loading && !error && !activeResult && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-[var(--text-muted)]">
            <Icon name="ph:graph" width={40} className="opacity-20" />
            <p>No knowledge graph loaded.</p>
            <button
              type="button"
              onClick={() => setRunModalOpen(true)}
              className="flex items-center gap-1.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-card)]"
            >
              <Icon name="ph:arrows-clockwise" width={13} />
              Run Graphify on a folder
            </button>
          </div>
        )}

        {!loading && !error && activeResult && !showReport && (
          <>
            <div className={`relative min-h-0 overflow-hidden ${selectedNode ? "flex-1" : "flex-1"}`}>
              <LibraryGraph3D
                graph={activeResult.graphJson}
                snapshots={activeSnapshots}
                targetPath={activeResult.targetPath}
                label={activeResult.label}
                filter={filter}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
              />
              <div className="absolute bottom-2 right-2 rounded bg-[var(--bg-card)]/80 px-2 py-1 text-[10px] text-[var(--text-muted)] backdrop-blur-sm">
                {activeResult.graphJson.nodes.length} nodes \u00b7 {activeResult.graphJson.edges.length} edges
                {" \u00b7 "}{activeResult.label}
              </div>
            </div>

            {selectedNode && (
              <div className="w-[220px] shrink-0 overflow-hidden">
                <NodeDetailPanel
                  node={selectedNode}
                  graph={activeResult.graphJson}
                  onClose={() => setSelectedNodeId(null)}
                />
              </div>
            )}
          </>
        )}

        {!loading && !error && activeResult?.reportMd && showReport && (
          <div className="flex-1 overflow-y-auto p-6">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--text-secondary)]">
              {activeResult.reportMd}
            </pre>
            <button
              type="button"
              onClick={() => setShowReport(false)}
              className="mt-4 flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:arrow-left" width={11} />
              Back to graph
            </button>
          </div>
        )}
      </div>

      <RunGraphifyModal
        open={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        onResult={handleNewResult}
        onRunStart={handleRunStart}
      />
    </div>
  );
}
