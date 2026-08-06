// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildMemoryOwnerIndex,
  memoryGraphNodeId,
  scopeDocGraph,
} from "./grimoire-graph-scope.ts";

const node = (id, kind, degree = 0) => ({ id, ref: null, kind, title: id, degree });
const edge = (source, target, type = "link") => ({ id: `${type}:${source}=>${target}`, source, target, type });

// A small corpus: one stitch, echo's + sage's memory, a journal day, two tags.
const graph = () => ({
  nodes: [
    node("knowledge:stitch-a", "knowledge", 3),
    node(memoryGraphNodeId("/echo/one.md"), "memory", 2),
    node(memoryGraphNodeId("/sage/two.md"), "memory", 2),
    node(memoryGraphNodeId("/pool/shared.md"), "memory", 1),
    node("journal:2026-08-05", "journal", 1),
    node("tag:shared", "tag", 2),
    node("tag:sage-only", "tag", 1),
  ],
  edges: [
    edge("knowledge:stitch-a", memoryGraphNodeId("/echo/one.md")),
    edge("knowledge:stitch-a", memoryGraphNodeId("/sage/two.md")),
    edge(memoryGraphNodeId("/echo/one.md"), "journal:2026-08-05", "mention"),
    edge("knowledge:stitch-a", "tag:shared", "tag"),
    edge(memoryGraphNodeId("/sage/two.md"), "tag:sage-only", "tag"),
    edge(memoryGraphNodeId("/pool/shared.md"), "tag:shared", "tag"),
  ],
});

const owners = buildMemoryOwnerIndex([
  { fullPath: "/echo/one.md", familiarId: "echo" },
  { fullPath: "/sage/two.md", familiarId: "sage" },
  { fullPath: "/pool/shared.md", familiarId: null },
]);

// ── Empty scope is "All" — untouched, and the SAME reference so memoized
//    consumers don't rerender for nothing.
{
  const g = graph();
  assert.equal(scopeDocGraph(g, new Set(), owners), g, "empty scope returns the graph by reference");
}

// ── The core guarantee: only the selected familiar's memory survives.
{
  const scoped = scopeDocGraph(graph(), new Set(["echo"]), owners);
  const ids = scoped.nodes.map((n) => n.id);
  assert.ok(ids.includes(memoryGraphNodeId("/echo/one.md")), "own memory kept");
  assert.ok(!ids.includes(memoryGraphNodeId("/sage/two.md")), "another familiar's memory dropped");
  assert.ok(
    !ids.includes(memoryGraphNodeId("/pool/shared.md")),
    "ownerless shared-pool memory hidden while a familiar is selected",
  );
}

// ── Stitches and journal stay coven-wide (they carry no owner, and they are
//    the graph's connective tissue).
{
  const scoped = scopeDocGraph(graph(), new Set(["echo"]), owners);
  const ids = scoped.nodes.map((n) => n.id);
  assert.ok(ids.includes("knowledge:stitch-a"), "knowledge is never scoped out");
  assert.ok(ids.includes("journal:2026-08-05"), "journal is never scoped out");
}

// ── No dangling edges: every edge endpoint still exists.
{
  const scoped = scopeDocGraph(graph(), new Set(["echo"]), owners);
  const ids = new Set(scoped.nodes.map((n) => n.id));
  for (const e of scoped.edges) {
    assert.ok(ids.has(e.source), `edge ${e.id} source survives`);
    assert.ok(ids.has(e.target), `edge ${e.id} target survives`);
  }
  assert.ok(
    !scoped.edges.some((e) => e.source === memoryGraphNodeId("/sage/two.md")),
    "edges out of a dropped node are pruned",
  );
}

// ── A tag that loses every edge is pruned; a tag still pointed at survives.
{
  const scoped = scopeDocGraph(graph(), new Set(["echo"]), owners);
  const ids = scoped.nodes.map((n) => n.id);
  assert.ok(!ids.includes("tag:sage-only"), "a tag orphaned by scoping is pruned");
  assert.ok(ids.includes("tag:shared"), "a tag the stitch still points at survives");
}

// ── Degree is recomputed, not carried over from the unscoped graph.
{
  const scoped = scopeDocGraph(graph(), new Set(["echo"]), owners);
  const byId = new Map(scoped.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get("knowledge:stitch-a").degree, 2, "stitch lost its sage edge");
  assert.equal(byId.get(memoryGraphNodeId("/echo/one.md")).degree, 2);
  assert.equal(byId.get("tag:shared").degree, 1, "tag lost the shared-pool edge");
}

// ── Multiselect: two familiars both survive.
{
  const scoped = scopeDocGraph(graph(), new Set(["echo", "sage"]), owners);
  const ids = scoped.nodes.map((n) => n.id);
  assert.ok(ids.includes(memoryGraphNodeId("/echo/one.md")));
  assert.ok(ids.includes(memoryGraphNodeId("/sage/two.md")));
  assert.ok(ids.includes("tag:sage-only"), "the tag is no longer orphaned");
  assert.ok(!ids.includes(memoryGraphNodeId("/pool/shared.md")), "ownerless still hidden");
}

// ── A memory node absent from the inventory fails CLOSED — an unattributable
//    path must not leak into a scoped view.
{
  const scoped = scopeDocGraph(graph(), new Set(["echo"]), new Map());
  assert.ok(
    !scoped.nodes.some((n) => n.kind === "memory"),
    "unknown ownership is treated as ownerless and hidden",
  );
}

// ── Scoping to a familiar with no memory leaves the shared corpus intact.
{
  const scoped = scopeDocGraph(graph(), new Set(["thoth"]), owners);
  assert.ok(!scoped.nodes.some((n) => n.kind === "memory"), "no memory for thoth");
  assert.ok(scoped.nodes.some((n) => n.id === "knowledge:stitch-a"), "stitches remain");
}

console.log("grimoire-graph-scope tests passed");
