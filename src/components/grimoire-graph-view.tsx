"use client";

// The Grimoire link graph — doc nodes + [[wiki-link]] edges, rendered with
// @xyflow/react (already in the app; CSS is imported globally). Lazy-loaded by
// grimoire-view so this heavy dep only lands when the graph is opened.

import { useCallback, useMemo, type MouseEvent } from "react";
import { ReactFlow, Background, Controls, type Edge, type Node } from "@xyflow/react";
import type { DocGraph } from "@/lib/grimoire-graph";
import type { WikiDocRef } from "@/lib/wiki-link-resolve";
import { EmptyState } from "@/components/ui/empty-state";

const KIND_COLOR: Record<WikiDocRef["kind"], string> = {
  knowledge: "var(--accent-presence)",
  memory: "var(--color-warning)",
  journal: "var(--text-secondary)",
};

export function GrimoireGraphView({
  graph,
  onOpen,
}: {
  graph: DocGraph;
  onOpen: (ref: WikiDocRef) => void;
}) {
  const nodes = useMemo<Node[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        position: { x: n.x, y: n.y },
        data: { label: n.title },
        connectable: false,
        style: {
          fontSize: 11,
          padding: "4px 9px",
          borderRadius: 999,
          border: `1px solid color-mix(in oklch, ${KIND_COLOR[n.kind]} 55%, var(--border-hairline))`,
          background: `color-mix(in oklch, ${KIND_COLOR[n.kind]} 12%, var(--bg-raised))`,
          color: "var(--text-primary)",
          maxWidth: 180,
        },
      })),
    [graph.nodes],
  );

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        style: { stroke: "var(--border-strong)", strokeWidth: 1 },
      })),
    [graph.edges],
  );

  const refById = useMemo(() => {
    const m = new Map<string, WikiDocRef>();
    for (const n of graph.nodes) m.set(n.id, n.ref);
    return m;
  }, [graph.nodes]);

  const onNodeClick = useCallback(
    (_: MouseEvent, node: Node) => {
      const ref = refById.get(node.id);
      if (ref) onOpen(ref);
    },
    [refById, onOpen],
  );

  if (graph.nodes.length === 0) {
    return (
      <div className="grid h-full min-h-0 place-items-center p-8">
        <EmptyState
          icon="ph:link"
          headline="No links yet"
          subtitle="Reference another doc with [[its title]] to see it connected here."
        />
      </div>
    );
  }

  return (
    <div className="grimoire-graph h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
      >
        <Background gap={22} color="var(--border-hairline)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
