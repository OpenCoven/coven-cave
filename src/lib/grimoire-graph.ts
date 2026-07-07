// Build a [[wiki-link]] graph over Grimoire docs, for the graph viewer (cave-xr0
// slice 3). Pure + UI-agnostic: it turns a set of source docs (each with its
// markdown) into nodes + directed edges, reusing the slice-1 parser/resolver.
// Layout is a deterministic circle so @xyflow gets stable positions without a
// layout dependency.

import { extractWikiLinks } from "./wiki-link-parser";
import {
  resolveWikiLinkTarget,
  docRefKey,
  type WikiDocIndex,
  type WikiDocRef,
} from "./wiki-link-resolve";

export type DocGraphNode = {
  /** docRefKey(ref) — stable node id. */
  id: string;
  ref: WikiDocRef;
  kind: WikiDocRef["kind"];
  title: string;
  x: number;
  y: number;
};

export type DocGraphEdge = { id: string; source: string; target: string };

export type DocGraph = { nodes: DocGraphNode[]; edges: DocGraphEdge[] };

/** A source doc to graph: its ref, a display title, and its raw markdown. */
export type GraphSourceDoc = { ref: WikiDocRef; title: string; markdown: string };

/**
 * Build a directed link graph from `docs`. Each source doc is a node; each of
 * its resolved `[[wiki-links]]` becomes an edge source→target. A link target
 * that resolves to a doc NOT in `docs` (e.g. a memory file referenced from a
 * knowledge entry) is added as a leaf node so the edge lands somewhere;
 * unresolved links and self-links are dropped, and duplicate edges collapse.
 */
export function buildDocGraph(docs: readonly GraphSourceDoc[], index: WikiDocIndex): DocGraph {
  const labels = new Map<string, { ref: WikiDocRef; title: string }>();
  for (const d of docs) labels.set(docRefKey(d.ref), { ref: d.ref, title: d.title });

  const edges: DocGraphEdge[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    const source = docRefKey(d.ref);
    for (const link of extractWikiLinks(d.markdown)) {
      const ref = resolveWikiLinkTarget(link.target, index);
      if (!ref) continue;
      const target = docRefKey(ref);
      if (target === source) continue; // no self-loops
      const id = `${source}=>${target}`;
      if (seen.has(id)) continue; // one edge per ordered pair
      seen.add(id);
      // Leaf target (a resolved doc that isn't itself a source) — label it with
      // the link's display text since we don't hold its full metadata here.
      if (!labels.has(target)) labels.set(target, { ref, title: link.display });
      edges.push({ id, source, target });
    }
  }

  return { nodes: layoutCircle(labels), edges };
}

/** Deterministic circular layout, stable-sorted by node id. Radius grows with
 *  node count so labels don't overlap on larger graphs. */
function layoutCircle(labels: Map<string, { ref: WikiDocRef; title: string }>): DocGraphNode[] {
  const entries = [...labels.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const n = entries.length;
  const radius = n <= 1 ? 0 : Math.max(140, Math.round((n * 48) / (2 * Math.PI)));
  return entries.map(([id, v], i) => {
    const angle = n <= 1 ? 0 : (2 * Math.PI * i) / n;
    return {
      id,
      ref: v.ref,
      kind: v.ref.kind,
      title: v.title,
      x: Math.round(Math.cos(angle) * radius),
      y: Math.round(Math.sin(angle) * radius),
    };
  });
}
