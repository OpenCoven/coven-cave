// Narrow the Grimoire doc graph to the shell's familiar multiselect, mirroring
// what the Memory navigator rail already does.
//
// Only MEMORY nodes carry an owner, so only memory nodes are scoped. Stitches
// and journal days stay coven-wide for the same reason the rail keeps them:
// knowledge is deliberately shared, and they are the graph's connective tissue —
// dropping them would shred the very relations the view exists to show.
//
// Dropping nodes is not enough on its own. Edges whose endpoint disappeared
// would dangle, and a tag node that loses every edge becomes a floating orphan
// that the unscoped graph can never produce (tag nodes only exist because some
// doc pointed at them). So this prunes both and recomputes `degree`, which the
// renderer uses for node size — leaving the pre-scope degree would draw a
// memory-heavy stitch as a hub with no visible spokes.

import { familiarInScope } from "./familiar-multiselect.ts";
import type { DocGraph, DocGraphEdge, DocGraphNode } from "./grimoire-graph.ts";

/** Node id of a memory doc, matching `docRefKey({ kind: "memory", path })`. */
export function memoryGraphNodeId(fullPath: string): string {
  return `memory:${fullPath}`;
}

/**
 * Build the `memoryGraphNodeId -> familiarId` lookup the scope needs from the
 * loaded memory inventory. Ownership lives only on the inventory entries; the
 * graph itself carries just paths.
 */
export function buildMemoryOwnerIndex(
  entries: readonly { fullPath: string; familiarId?: string | null }[],
): Map<string, string | null> {
  const owners = new Map<string, string | null>();
  for (const entry of entries) {
    owners.set(memoryGraphNodeId(entry.fullPath), entry.familiarId ?? null);
  }
  return owners;
}

/**
 * Restrict `graph` to `scope`. An empty scope is "All" and returns the graph
 * untouched (same reference, so memoized consumers never rerender for nothing).
 *
 * A memory node whose owner is unknown — not in the inventory, or an ownerless
 * shared pool such as `~/.coven/memory` — is treated as ownerless and hidden
 * while a familiar is selected, matching `memory-file-scope`'s rule. Failing
 * closed here is deliberate: a path we cannot attribute must not leak into a
 * scoped view.
 */
export function scopeDocGraph(
  graph: DocGraph,
  scope: ReadonlySet<string>,
  memoryOwnerByNodeId: ReadonlyMap<string, string | null>,
): DocGraph {
  if (scope.size === 0) return graph;

  const kept = new Set<string>();
  const nodes: DocGraphNode[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "memory" && !familiarInScope(scope, memoryOwnerByNodeId.get(node.id) ?? null)) {
      continue;
    }
    kept.add(node.id);
    nodes.push(node);
  }

  const edges: DocGraphEdge[] = graph.edges.filter((e) => kept.has(e.source) && kept.has(e.target));

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  // A tag with no surviving edge is meaningless — prune it. Tag edges only ever
  // touch that tag, so removing one strands no further edges.
  const scopedNodes = nodes
    .filter((n) => n.kind !== "tag" || (degree.get(n.id) ?? 0) > 0)
    .map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 }));

  return { nodes: scopedNodes, edges };
}
