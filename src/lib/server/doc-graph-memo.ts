import type { DocGraph, GraphSourceDoc } from "../grimoire-graph.ts";
import type { WikiDocIndex } from "../wiki-link-resolve.ts";

/**
 * Reuse the last doc graph built for a scope when its inputs are unchanged
 * (#5682).
 *
 * `buildDocGraph` costs ~120 ms on a 1350-doc corpus and the Grimoire asks for
 * the graph on every visit, while the corpus rarely changes between visits.
 * Comparing the inputs field by field is a few milliseconds: the memory
 * contents come from the scan's content cache, so unchanged files hand back
 * the same string and `===` stops at the pointer check.
 */

type MemoEntry = { docs: GraphSourceDoc[]; index: WikiDocIndex; graph: DocGraph };

export type DocGraphMemo = {
  build(scopeKey: string, docs: GraphSourceDoc[], index: WikiDocIndex): DocGraph;
};

export function createDocGraphMemo(
  buildGraph: (docs: GraphSourceDoc[], index: WikiDocIndex) => DocGraph,
  maxScopes = 8,
): DocGraphMemo {
  const entries = new Map<string, MemoEntry>();
  return {
    build(scopeKey, docs, index) {
      const hit = entries.get(scopeKey);
      entries.delete(scopeKey);
      if (hit && sameDocs(hit.docs, docs) && sameIndex(hit.index, index)) {
        entries.set(scopeKey, hit);
        return hit.graph;
      }
      const graph = buildGraph(docs, index);
      entries.set(scopeKey, { docs: snapshotDocs(docs), index: snapshotIndex(index), graph });
      while (entries.size > maxScopes) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return graph;
    },
  };
}

// The memo compares against its own copies, never the caller's arrays: a
// caller that edits a doc or index entry in place and asks again must get a
// rebuild, not the graph of the pre-edit inputs. Strings are immutable, so
// the copies share them and the `===` comparisons stay pointer checks.
function snapshotDocs(docs: readonly GraphSourceDoc[]): GraphSourceDoc[] {
  return docs.map((doc) => ({
    ref: { ...doc.ref },
    title: doc.title,
    markdown: doc.markdown,
    ...(doc.tags ? { tags: [...doc.tags] } : {}),
  }));
}

function snapshotIndex(index: WikiDocIndex): WikiDocIndex {
  return {
    knowledge: index.knowledge.map((entry) => ({ ...entry })),
    memory: index.memory.map((entry) => ({ ...entry })),
    journal: index.journal.map((entry) => ({ ...entry })),
  };
}

function sameList<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!same(a[i], b[i])) return false;
  }
  return true;
}

const sameString = (x: string, y: string) => x === y;

function sameDocs(a: readonly GraphSourceDoc[], b: readonly GraphSourceDoc[]): boolean {
  return sameList(a, b, (x, y) =>
    x.title === y.title
    && x.markdown === y.markdown
    && sameRef(x.ref, y.ref)
    && sameList(x.tags ?? [], y.tags ?? [], sameString),
  );
}

function sameRef(a: GraphSourceDoc["ref"], b: GraphSourceDoc["ref"]): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "knowledge":
      return b.kind === "knowledge" && a.id === b.id && a.collection === b.collection;
    case "memory":
      return b.kind === "memory" && a.path === b.path;
    case "journal":
      return b.kind === "journal" && a.date === b.date;
    default:
      // A ref kind this memo does not know about is never assumed equal.
      return false;
  }
}

function sameIndex(a: WikiDocIndex, b: WikiDocIndex): boolean {
  return sameList(a.knowledge, b.knowledge, (x, y) =>
    x.id === y.id && x.collection === y.collection && x.title === y.title,
  )
    && sameList(a.memory, b.memory, (x, y) => x.path === y.path)
    && sameList(a.journal, b.journal, (x, y) => x.date === y.date);
}
