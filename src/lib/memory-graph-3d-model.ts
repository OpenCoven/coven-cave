import type { Familiar } from "@/lib/types";

export type MemoryGraphCovenEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
};

export type MemoryGraphFileEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
};

export type MemoryGraphHubNode = {
  kind: "hub";
  hubKind: "familiar" | "files";
  id: string;
  label: string;
  glyph?: string;
  familiarId?: string;
  memoryCount: number;
  latestAt?: string;
};

export type MemoryGraphMemoryNode = {
  kind: "memory";
  id: string;
  source: "coven" | "file";
  hubId: string;
  familiarId?: string;
  title: string;
  path: string;
  updatedAt: string;
  excerpt?: string;
  rootLabel?: string;
  relPath?: string;
};

export type MemoryGraphClusterNode = {
  kind: "cluster";
  id: string;
  hubId: string;
  familiarId?: string;
  source: "coven" | "file";
  label: string;
  count: number;
  latestAt?: string;
};

export type MemoryGraphNode =
  | MemoryGraphHubNode
  | MemoryGraphMemoryNode
  | MemoryGraphClusterNode;

type MemoryGraphChildNode = MemoryGraphMemoryNode | MemoryGraphClusterNode;

export type MemoryGraphEdge = {
  id: string;
  kind: "belongs_to";
  source: string;
  target: string;
  count: number;
};

export type MemoryGraph = {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  metrics: {
    familiarHubs: number;
    fileHubs: number;
    visibleCovenEntries: number;
    visibleFileEntries: number;
    hiddenEntries: number;
  };
};

export type MemoryGraphSelection =
  | { kind: "familiar"; id: string }
  | { kind: "memory"; id: string }
  | { kind: "cluster"; id: string }
  | { kind: "files" }
  | null;

export type MemoryGraphSceneNode = MemoryGraphNode & {
  label: string;
  position: ScenePosition;
  radius: number;
  color: string;
  memoryCount: number;
};

export type MemoryGraphSceneEdge = MemoryGraphEdge & {
  from: ScenePosition;
  to: ScenePosition;
  color: string;
  opacity: number;
};

export type MemoryGraphSceneModel = {
  nodes: MemoryGraphSceneNode[];
  edges: MemoryGraphSceneEdge[];
};

export type ScenePosition = { x: number; y: number; z: number };

function matchesQuery(values: Array<string | undefined>, query: string): boolean {
  if (!query) return true;
  return values.some((value) => (value ?? "").toLowerCase().includes(query));
}

function compareIsoDesc(a?: string, b?: string): number {
  return (b ?? "").localeCompare(a ?? "");
}

function memoryIdForCoven(entry: MemoryGraphCovenEntry): string {
  return `memory:coven:${entry.id}`;
}

export function resolveMemoryFamiliarFilter({
  familiars,
  covenEntries,
  currentFamiliarId,
  activeFamiliarId,
}: {
  familiars: Familiar[];
  covenEntries: MemoryGraphCovenEntry[];
  currentFamiliarId: string;
  activeFamiliarId?: string | null;
}): string {
  const familiarIds = new Set(familiars.map((familiar) => familiar.id));
  if (activeFamiliarId && familiarIds.has(activeFamiliarId)) return activeFamiliarId;

  const familiarsWithMemory = new Set(covenEntries.map((entry) => entry.familiar_id));
  if (
    currentFamiliarId &&
    familiarIds.has(currentFamiliarId) &&
    (familiarsWithMemory.size === 0 || familiarsWithMemory.has(currentFamiliarId))
  ) {
    return currentFamiliarId;
  }

  return familiars.find((familiar) => familiarsWithMemory.has(familiar.id))?.id ?? familiars[0]?.id ?? "";
}

function edgeId(source: string, target: string): string {
  return `${source}->${target}`;
}

function pos(x: number, y: number, z: number): ScenePosition {
  return { x, y, z };
}

function addCappedLeaves({
  hubId,
  familiarId,
  source,
  entries,
  maxLeavesPerHub,
  toMemoryNode,
  nodes,
  edges,
}: {
  hubId: string;
  familiarId?: string;
  source: "coven" | "file";
  entries: Array<MemoryGraphCovenEntry | MemoryGraphFileEntry>;
  maxLeavesPerHub: number;
  toMemoryNode: (entry: MemoryGraphCovenEntry | MemoryGraphFileEntry) => MemoryGraphMemoryNode;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}) {
  const visible = entries.slice(0, maxLeavesPerHub);
  const hidden = entries.slice(maxLeavesPerHub);

  for (const entry of visible) {
    const node = toMemoryNode(entry);
    nodes.push(node);
    edges.push({
      id: edgeId(node.id, hubId),
      kind: "belongs_to",
      source: node.id,
      target: hubId,
      count: 1,
    });
  }

  if (hidden.length > 0) {
    const cluster: MemoryGraphClusterNode = {
      kind: "cluster",
      id: `cluster:${hubId}`,
      hubId,
      familiarId,
      source,
      label: `+${hidden.length} older`,
      count: hidden.length,
      latestAt:
        source === "coven"
          ? (hidden[0] as MemoryGraphCovenEntry | undefined)?.updated_at
          : (hidden[0] as MemoryGraphFileEntry | undefined)?.modified,
    };
    nodes.push(cluster);
    edges.push({
      id: edgeId(cluster.id, hubId),
      kind: "belongs_to",
      source: cluster.id,
      target: hubId,
      count: hidden.length,
    });
  }
}

export function buildMemoryGraphModel({
  familiars,
  covenEntries,
  fileEntries: _fileEntries,
  query = "",
  familiarFilter = "all",
  maxLeavesPerHub = 30,
}: {
  familiars: Familiar[];
  covenEntries: MemoryGraphCovenEntry[];
  fileEntries: MemoryGraphFileEntry[];
  query?: string;
  familiarFilter?: string;
  maxLeavesPerHub?: number;
}): MemoryGraph {
  const q = query.trim().toLowerCase();
  const nodes: MemoryGraphNode[] = [];
  const edges: MemoryGraphEdge[] = [];
  let hiddenEntries = 0;

  const selectedFamiliarId = familiarFilter !== "all"
    ? familiarFilter
    : covenEntries.find((entry) => matchesQuery([entry.title, entry.excerpt, entry.familiar_id, entry.path], q))?.familiar_id ?? familiars[0]?.id;
  const selectedFamiliar = familiars.find((familiar) => familiar.id === selectedFamiliarId);

  const matchingCovenEntries = covenEntries
    .filter((entry) => entry.familiar_id === selectedFamiliarId)
    .filter((entry) =>
      matchesQuery([entry.title, entry.excerpt, entry.familiar_id, entry.path], q),
    )
    .sort((a, b) => compareIsoDesc(a.updated_at, b.updated_at));

  const totalMatchingForFamiliar = covenEntries.filter((entry) =>
    entry.familiar_id === selectedFamiliarId &&
    matchesQuery([entry.title, entry.excerpt, entry.familiar_id, entry.path], q),
  ).length;

  if (selectedFamiliar) {
    const hubId = `familiar:${selectedFamiliar.id}`;
    nodes.push({
      kind: "hub",
      hubKind: "familiar",
      id: hubId,
      label: selectedFamiliar.display_name ?? selectedFamiliar.name ?? selectedFamiliar.id,
      glyph: selectedFamiliar.icon ?? selectedFamiliar.emoji,
      familiarId: selectedFamiliar.id,
      memoryCount: totalMatchingForFamiliar,
      latestAt: matchingCovenEntries[0]?.updated_at,
    });
    addCappedLeaves({
      hubId,
      familiarId: selectedFamiliar.id,
      source: "coven",
      entries: matchingCovenEntries,
      maxLeavesPerHub,
      nodes,
      edges,
      toMemoryNode: (entry) => {
        const coven = entry as MemoryGraphCovenEntry;
        return {
          kind: "memory",
          id: memoryIdForCoven(coven),
          source: "coven",
          hubId,
          familiarId: coven.familiar_id,
          title: coven.title,
          path: coven.path,
          updatedAt: coven.updated_at,
          excerpt: coven.excerpt,
        };
      },
    });
    hiddenEntries += Math.max(matchingCovenEntries.length - maxLeavesPerHub, 0);
  }

  return {
    nodes,
    edges,
    metrics: {
      familiarHubs: selectedFamiliar ? 1 : 0,
      fileHubs: 0,
      visibleCovenEntries: matchingCovenEntries.length,
      visibleFileEntries: 0,
      hiddenEntries,
    },
  };
}

export function memorySelectionObjectKey(selection: MemoryGraphSelection): string | null {
  if (!selection) return null;
  if (selection.kind === "familiar") return `hub:familiar:${selection.id}`;
  if (selection.kind === "files") return null;
  if (selection.kind === "memory") return `memory:${selection.id}`;
  return `cluster:${selection.id}`;
}

export function buildMemoryGraphSceneModel(graph: MemoryGraph): MemoryGraphSceneModel {
  const hubs = graph.nodes
    .filter((node): node is MemoryGraphHubNode => node.kind === "hub");
  const hubPositions = new Map<string, ScenePosition>();

  hubs.forEach((hub) => {
    hubPositions.set(hub.id, pos(-2.25, 0, 0));
  });

  const childrenByHub = new Map<string, MemoryGraphChildNode[]>();
  for (const node of graph.nodes) {
    if (node.kind === "hub") continue;
    const bucket = childrenByHub.get(node.hubId) ?? [];
    bucket.push(node);
    childrenByHub.set(node.hubId, bucket);
  }

  const sceneNodes: MemoryGraphSceneNode[] = [];
  for (const hub of hubs) {
    const hubPosition = hubPositions.get(hub.id) ?? pos(0, 0, 0);
    sceneNodes.push({
      ...hub,
      label: hub.label,
      position: hubPosition,
      radius: 0.72 + Math.min(hub.memoryCount, 24) * 0.008,
      color: "#8E3DFF",
      memoryCount: hub.memoryCount,
    });

    const children = childrenByHub.get(hub.id) ?? [];
    const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(children.length || 1))));
    const rowGap = 0.82;
    const colGap = 1.28;
    children.forEach((child, index) => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      const rowWidth = Math.min(columns, children.length - row * columns);
      const colOffset = col - (rowWidth - 1) / 2;
      const position = pos(
        positionAdd(hubPosition.x, 1.75 + row * rowGap * 0.42),
        positionAdd(hubPosition.y, -0.35 + row * rowGap * 0.72),
        positionAdd(hubPosition.z, colOffset * colGap + Math.sin(index * 1.7) * 0.08),
      );
      sceneNodes.push({
        ...child,
        label: child.kind === "memory" ? child.title : child.label,
        position,
        radius: child.kind === "memory" ? 0.36 : 0.48,
        color: child.kind === "memory" ? "#62d08f" : "#f59e0b",
        memoryCount: child.kind === "cluster" ? child.count : 1,
      });
    });
  }

  const nodeById = new Map(sceneNodes.map((node) => [node.id, node]));
  const sceneEdges = graph.edges.flatMap((edge): MemoryGraphSceneEdge[] => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return [];
    return [{
      ...edge,
      from: source.position,
      to: target.position,
      color: source.kind === "memory" ? "#62d08f" : "#f59e0b",
      opacity: source.kind === "cluster" ? 0.42 : 0.28,
    }];
  });

  return { nodes: sceneNodes, edges: sceneEdges };
}

function positionAdd(base: number, offset: number): number {
  return Math.round((base + offset) * 1000) / 1000;
}
