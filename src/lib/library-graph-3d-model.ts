import type { GraphifyEdge, GraphifyGraph, GraphifyNode, GraphifyRunSnapshot } from "@/lib/library-types";

export type LibraryGraphScenePosition = { x: number; y: number; z: number };

export type LibraryGraphSceneNode = GraphifyNode & {
  position: LibraryGraphScenePosition;
  radius: number;
  color: string;
};

export type LibraryGraphSceneEdge = GraphifyEdge & {
  key: string;
  sourceId: string;
  targetId: string;
  from: LibraryGraphScenePosition;
  to: LibraryGraphScenePosition;
  control: LibraryGraphScenePosition;
};

export type LibraryGraphRenderPolicy = {
  detail: "full" | "reduced" | "summary";
  showLabels: boolean;
  animateParticles: boolean;
  maxRenderedEdges: number;
};

export type LibraryGraphSceneModel = {
  nodes: LibraryGraphSceneNode[];
  edges: LibraryGraphSceneEdge[];
  policy: LibraryGraphRenderPolicy;
};

export type GraphSnapshotBTree = {
  order: number;
  entries: Array<{ key: string; snapshot: GraphifyRunSnapshot }>;
};

const TYPE_COLORS: Record<string, string> = {
  file: "#8E3DFF",
  module: "#38bdf8",
  symbol: "#62d08f",
  tool: "#fbbf24",
  external: "#f87171",
};

export function graphEdgeEndpoint(value: GraphifyEdge["source"] | GraphifyEdge["target"]): string {
  if (typeof value === "object" && value !== null && "id" in value) {
    return String((value as { id?: unknown }).id ?? "");
  }
  return String(value);
}

export function renderPolicyForLibraryGraph({
  nodeCount,
  edgeCount,
}: {
  nodeCount: number;
  edgeCount: number;
}): LibraryGraphRenderPolicy {
  if (nodeCount > 180 || edgeCount > 360) {
    return { detail: "summary", showLabels: false, animateParticles: false, maxRenderedEdges: 180 };
  }
  if (nodeCount > 72 || edgeCount > 180) {
    return { detail: "reduced", showLabels: false, animateParticles: false, maxRenderedEdges: 180 };
  }
  return { detail: "full", showLabels: true, animateParticles: true, maxRenderedEdges: 180 };
}

function positionFor(index: number, count: number): LibraryGraphScenePosition {
  if (count <= 1) return { x: 0, y: 0, z: 0 };
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / Math.max(count - 1, 1)) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = goldenAngle * index;
  const scale = Math.max(4.8, Math.min(15, 3.2 + Math.sqrt(count) * 0.78));
  return {
    x: Math.cos(theta) * radius * scale,
    y: y * scale * 0.42,
    z: Math.sin(theta) * radius * scale,
  };
}

function nodeRadius(node: GraphifyNode): number {
  const weight = typeof node.weight === "number" ? node.weight : 1;
  return Math.max(0.12, Math.min(0.52, 0.16 + weight * 0.05));
}

function nodeColor(node: GraphifyNode): string {
  const type = typeof node.type === "string" ? node.type.toLowerCase() : "";
  return TYPE_COLORS[type] ?? "#c6a9ff";
}

function midpoint(a: LibraryGraphScenePosition, b: LibraryGraphScenePosition): LibraryGraphScenePosition {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

export function buildLibraryGraphSceneModel(graph: GraphifyGraph): LibraryGraphSceneModel {
  const policy = renderPolicyForLibraryGraph({ nodeCount: graph.nodes.length, edgeCount: graph.edges.length });
  const nodes = graph.nodes.map((node, index): LibraryGraphSceneNode => ({
    ...node,
    position: positionFor(index, graph.nodes.length),
    radius: nodeRadius(node),
    color: nodeColor(node),
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges
    .slice(0, policy.maxRenderedEdges)
    .flatMap((edge, index): LibraryGraphSceneEdge[] => {
      const sourceId = graphEdgeEndpoint(edge.source);
      const targetId = graphEdgeEndpoint(edge.target);
      const source = byId.get(sourceId);
      const target = byId.get(targetId);
      if (!source || !target) return [];
      const mid = midpoint(source.position, target.position);
      return [{
        ...edge,
        key: `${sourceId}->${targetId}->${edge.label ?? index}`,
        sourceId,
        targetId,
        from: source.position,
        to: target.position,
        control: {
          x: mid.x * 1.05,
          y: mid.y + 0.8 + (index % 5) * 0.11,
          z: mid.z * 1.05,
        },
      }];
    });
  return { nodes, edges, policy };
}

function snapshotKey(snapshot: Pick<GraphifyRunSnapshot, "targetPath" | "generatedAt" | "id">): string {
  return `${snapshot.targetPath}\u0000${snapshot.generatedAt}\u0000${snapshot.id}`;
}

export function buildGraphSnapshotBTree(snapshots: GraphifyRunSnapshot[], order = 8): GraphSnapshotBTree {
  return {
    order,
    entries: snapshots
      .map((snapshot) => ({ key: snapshotKey(snapshot), snapshot }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export function rangeGraphSnapshots(tree: GraphSnapshotBTree, targetPath: string): GraphifyRunSnapshot[] {
  const prefix = `${targetPath}\u0000`;
  return tree.entries
    .filter((entry) => entry.key.startsWith(prefix))
    .map((entry) => entry.snapshot);
}

export function diffGraphSnapshots(
  previous: Pick<GraphifyRunSnapshot, "nodeCount" | "edgeCount"> | undefined,
  next: Pick<GraphifyRunSnapshot, "nodeCount" | "edgeCount"> | undefined,
): { nodeDelta: number; edgeDelta: number } {
  return {
    nodeDelta: (next?.nodeCount ?? 0) - (previous?.nodeCount ?? 0),
    edgeDelta: (next?.edgeCount ?? 0) - (previous?.edgeCount ?? 0),
  };
}
