import type {
  DelegationGraph,
  DelegationGraphEdge,
  DelegationGraphNode,
} from "@/lib/coven-calls-types";

export type TraceGraphSelection =
  | { kind: "edge"; key: string }
  | { kind: "node"; id: string }
  | { kind: "trace"; id: string }
  | null;

export type ScenePosition = { x: number; y: number; z: number };

export type TraceSceneNode = DelegationGraphNode & {
  label: string;
  position: ScenePosition;
};

export type TraceSceneEdge = DelegationGraphEdge & {
  key: string;
  from: ScenePosition;
  to: ScenePosition;
  control: ScenePosition;
  color: string;
};

export type TraceRenderPolicy = {
  detail: "full" | "reduced" | "summary";
  animateParticles: boolean;
  showLabels: boolean;
  maxRenderedEdges: number;
};

export type TraceGraphSceneModel = {
  nodes: TraceSceneNode[];
  edges: TraceSceneEdge[];
  policy: TraceRenderPolicy;
};

export function edgeKey(edge: Pick<DelegationGraphEdge, "caller" | "callee" | "source">): string {
  return `${edge.caller}->${edge.callee}->${edge.source}`;
}

export function traceGraphColor(edge: Pick<DelegationGraphEdge, "source" | "latestStatus" | "hasRunning">): string {
  if (edge.latestStatus === "failed") return "#f87171";
  if (edge.hasRunning) return "#62d08f";
  if (edge.source === "inferred") return "#fbbf24";
  if (edge.source === "mixed") return "#38bdf8";
  return "#8E3DFF";
}

export function nodeStatusColor(node: Pick<DelegationGraphNode, "hasRunningReceived" | "latestReceivedFailed">): string {
  if (node.latestReceivedFailed) return "#f87171";
  if (node.hasRunningReceived) return "#62d08f";
  return "#8E3DFF";
}

export function renderPolicyForGraph({
  nodeCount,
  edgeCount,
}: {
  nodeCount: number;
  edgeCount: number;
}): TraceRenderPolicy {
  if (nodeCount > 120 || edgeCount > 360) {
    return { detail: "summary", animateParticles: false, showLabels: false, maxRenderedEdges: 180 };
  }
  if (nodeCount > 48 || edgeCount > 140) {
    return { detail: "reduced", animateParticles: false, showLabels: true, maxRenderedEdges: 140 };
  }
  return { detail: "full", animateParticles: true, showLabels: true, maxRenderedEdges: 140 };
}

function pos(x: number, y: number, z: number): ScenePosition {
  return { x, y, z };
}

export function buildTraceGraphSceneModel(
  graph: DelegationGraph,
  labels: Map<string, string>,
): TraceGraphSceneModel {
  const policy = renderPolicyForGraph({ nodeCount: graph.nodes.length, edgeCount: graph.edges.length });
  const count = Math.max(graph.nodes.length, 1);
  const radius = graph.nodes.length <= 2 ? 3.8 : Math.max(4.2, Math.min(8.4, 3.8 + count * 0.36));

  const nodes = graph.nodes.map((node, index): TraceSceneNode => {
    const angle = graph.nodes.length === 1 ? -Math.PI / 2 : (index / count) * Math.PI * 2 - Math.PI / 2;
    const lane = graph.nodes.length <= 2 ? 0 : (index % 3) - 1;
    const activity = node.sentCount + node.receivedCount;
    const lift = lane * 1.25 + Math.sin(index * 1.7) * 0.35;
    const scale = 1 + Math.min(activity, 10) * 0.018;
    return {
      ...node,
      label: labels.get(node.id) ?? node.id,
      position: pos(Math.cos(angle) * radius * scale, lift, Math.sin(angle) * radius * scale),
    };
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visibleEdges = [...graph.edges]
    .sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, policy.maxRenderedEdges);

  const edges = visibleEdges.flatMap((edge, index): TraceSceneEdge[] => {
    const caller = byId.get(edge.caller);
    const callee = byId.get(edge.callee);
    if (!caller || !callee) return [];
    const from = caller.position;
    const to = callee.position;
    const reciprocal = graph.edges.some((other) => other.caller === edge.callee && other.callee === edge.caller);
    const midpoint = pos((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    const reciprocalOffset = reciprocal ? (edge.caller < edge.callee ? 0.8 : -0.8) : 0;
    const control = pos(
      midpoint.x * 1.08 + reciprocalOffset,
      midpoint.y + 1.25 + Math.min(edge.count, 6) * 0.22 + (index % 2) * 0.35,
      midpoint.z * 1.08 - reciprocalOffset,
    );
    return [{
      ...edge,
      key: edgeKey(edge),
      from,
      to,
      control,
      color: traceGraphColor(edge),
    }];
  });

  return { nodes, edges, policy };
}

export function selectionObjectKey(selection: TraceGraphSelection, graph: DelegationGraph): string | null {
  if (!selection) return null;
  if (selection.kind === "node") return `node:${selection.id}`;
  if (selection.kind === "edge") return `edge:${selection.key}`;
  const edge = graph.edges.find((candidate) => candidate.traces.some((trace) => trace.id === selection.id));
  return edge ? `edge:${edgeKey(edge)}` : null;
}
