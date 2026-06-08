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

const FILE_HUB_ID = "hub:memory-files";

function matchesQuery(values: Array<string | undefined>, query: string): boolean {
  if (!query) return true;
  return values.some((value) => (value ?? "").toLowerCase().includes(query));
}

function compareIsoDesc(a?: string, b?: string): number {
  return (b ?? "").localeCompare(a ?? "");
}

function compactFileTitle(entry: MemoryGraphFileEntry): string {
  return entry.relPath || entry.fullPath.split("/").pop() || entry.fullPath;
}

function memoryIdForFile(entry: MemoryGraphFileEntry): string {
  return `memory:file:${entry.fullPath}`;
}

function memoryIdForCoven(entry: MemoryGraphCovenEntry): string {
  return `memory:coven:${entry.id}`;
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
  fileEntries,
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

  const matchingCovenEntries = covenEntries
    .filter((entry) => familiarFilter === "all" || entry.familiar_id === familiarFilter)
    .filter((entry) =>
      matchesQuery([entry.title, entry.excerpt, entry.familiar_id, entry.path], q),
    )
    .sort((a, b) => compareIsoDesc(a.updated_at, b.updated_at));

  const matchingFiles = fileEntries
    .filter((entry) =>
      matchesQuery([entry.rootLabel, entry.relPath, entry.fullPath], q),
    )
    .sort((a, b) => compareIsoDesc(a.modified, b.modified));

  const covenByFamiliar = new Map<string, MemoryGraphCovenEntry[]>();
  for (const entry of matchingCovenEntries) {
    const bucket = covenByFamiliar.get(entry.familiar_id) ?? [];
    bucket.push(entry);
    covenByFamiliar.set(entry.familiar_id, bucket);
  }

  const totalCovenByFamiliar = new Map<string, number>();
  for (const entry of covenEntries) {
    if (!matchesQuery([entry.title, entry.excerpt, entry.familiar_id, entry.path], q)) continue;
    totalCovenByFamiliar.set(
      entry.familiar_id,
      (totalCovenByFamiliar.get(entry.familiar_id) ?? 0) + 1,
    );
  }

  for (const familiar of familiars) {
    const hubId = `familiar:${familiar.id}`;
    const entries = covenByFamiliar.get(familiar.id) ?? [];
    const latestAt = entries[0]?.updated_at;
    nodes.push({
      kind: "hub",
      hubKind: "familiar",
      id: hubId,
      label: familiar.display_name ?? familiar.name ?? familiar.id,
      glyph: familiar.icon ?? familiar.emoji,
      familiarId: familiar.id,
      memoryCount: totalCovenByFamiliar.get(familiar.id) ?? 0,
      latestAt,
    });
    addCappedLeaves({
      hubId,
      familiarId: familiar.id,
      source: "coven",
      entries,
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
    hiddenEntries += Math.max(entries.length - maxLeavesPerHub, 0);
  }

  if (matchingFiles.length > 0 || fileEntries.length > 0) {
    nodes.push({
      kind: "hub",
      hubKind: "files",
      id: FILE_HUB_ID,
      label: "Memory Files",
      glyph: "ph:file-text",
      memoryCount: matchingFiles.length,
      latestAt: matchingFiles[0]?.modified,
    });
    addCappedLeaves({
      hubId: FILE_HUB_ID,
      source: "file",
      entries: matchingFiles,
      maxLeavesPerHub,
      nodes,
      edges,
      toMemoryNode: (entry) => {
        const file = entry as MemoryGraphFileEntry;
        return {
          kind: "memory",
          id: memoryIdForFile(file),
          source: "file",
          hubId: FILE_HUB_ID,
          title: compactFileTitle(file),
          path: file.fullPath,
          updatedAt: file.modified,
          rootLabel: file.rootLabel,
          relPath: file.relPath,
        };
      },
    });
    hiddenEntries += Math.max(matchingFiles.length - maxLeavesPerHub, 0);
  }

  return {
    nodes,
    edges,
    metrics: {
      familiarHubs: familiars.length,
      fileHubs: fileEntries.length > 0 ? 1 : 0,
      visibleCovenEntries: matchingCovenEntries.length,
      visibleFileEntries: matchingFiles.length,
      hiddenEntries,
    },
  };
}

export function memorySelectionObjectKey(selection: MemoryGraphSelection): string | null {
  if (!selection) return null;
  if (selection.kind === "familiar") return `hub:familiar:${selection.id}`;
  if (selection.kind === "files") return `hub:${FILE_HUB_ID}`;
  if (selection.kind === "memory") return `memory:${selection.id}`;
  return `cluster:${selection.id}`;
}

function hubSortKey(node: MemoryGraphHubNode): string {
  return node.hubKind === "files" ? "zzzz" : node.label.toLowerCase();
}

function fibonacciHemispherePosition({
  center,
  index,
  count,
  radius,
  phase,
  orbitScale = 1,
}: {
  center: ScenePosition;
  index: number;
  count: number;
  radius: number;
  phase: number;
  orbitScale?: number;
}): ScenePosition {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const normalized = count <= 1 ? 0.5 : (index + 0.5) / count;
  const y = 1 - normalized * 0.92;
  const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = goldenAngle * index + phase;
  const scaledRadius = radius * orbitScale;
  return pos(
    positionAdd(center.x, Math.cos(theta) * horizontal * scaledRadius),
    positionAdd(center.y, y * scaledRadius - 0.28),
    positionAdd(center.z, Math.sin(theta) * horizontal * scaledRadius),
  );
}

export function buildMemoryGraphSceneModel(graph: MemoryGraph): MemoryGraphSceneModel {
  const hubs = graph.nodes
    .filter((node): node is MemoryGraphHubNode => node.kind === "hub")
    .sort((a, b) => hubSortKey(a).localeCompare(hubSortKey(b)));
  const hubCount = Math.max(hubs.length, 1);
  const ringRadius = hubCount <= 2 ? 3.5 : Math.max(4.2, Math.min(8.2, 3.2 + hubCount * 0.52));
  const hubPositions = new Map<string, ScenePosition>();

  hubs.forEach((hub, index) => {
    const angle = hubCount === 1 ? -Math.PI / 2 : (index / hubCount) * Math.PI * 2 - Math.PI / 2;
    const filesLift = hub.hubKind === "files" ? -0.8 : 0;
    hubPositions.set(
      hub.id,
      pos(Math.cos(angle) * ringRadius, filesLift + Math.sin(index * 1.2) * 0.24, Math.sin(angle) * ringRadius),
    );
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
      radius: hub.hubKind === "files" ? 0.48 : 0.56 + Math.min(hub.memoryCount, 24) * 0.01,
      color: hub.hubKind === "files" ? "#38bdf8" : "#8E3DFF",
      memoryCount: hub.memoryCount,
    });

    const children = childrenByHub.get(hub.id) ?? [];
    const shellRadius = hub.hubKind === "files" ? 1.65 : 1.35 + Math.min(children.length, 18) * 0.025;
    children.forEach((child, index) => {
      const orbitScale = child.kind === "cluster" ? 1.16 : 1;
      const position = fibonacciHemispherePosition({
        center: hubPosition,
        index,
        count: Math.max(children.length, 1),
        radius: shellRadius,
        phase: hub.id.length * 0.17,
        orbitScale,
      });
      sceneNodes.push({
        ...child,
        label: child.kind === "memory" ? child.title : child.label,
        position,
        radius: child.kind === "memory" && child.source === "file" ? 0.18 : child.kind === "memory" ? 0.2 : 0.32,
        color: child.kind === "memory" && child.source === "file" ? "#38bdf8" : child.kind === "memory" ? "#62d08f" : "#f59e0b",
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
      color: source.kind === "memory" && source.source === "file" ? "#38bdf8" : source.kind === "memory" ? "#62d08f" : "#f59e0b",
      opacity: source.kind === "cluster" ? 0.42 : 0.28,
    }];
  });

  return { nodes: sceneNodes, edges: sceneEdges };
}

function positionAdd(base: number, offset: number): number {
  return Math.round((base + offset) * 1000) / 1000;
}
