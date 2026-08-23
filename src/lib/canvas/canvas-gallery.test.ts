// Gallery toolbar helpers: search + kind filter for the Canvas grid. The
// snapshot-merge and freshness-guard helpers in the same module are covered
// by src/components/chat-canvas-tab.test.ts alongside their view wiring.
import assert from "node:assert/strict";

import {
  filterCanvasArtifacts,
  galleryArtifactKind,
  type CanvasKindFilter,
} from "./canvas-gallery.ts";

const art = (id: string, title: string, kind?: "html" | "react") => ({
  id,
  title,
  prompt: "",
  code: "",
  ...(kind ? { kind } : {}),
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:00:00.000Z",
});

const sketches = [
  art("a", "Pricing page", "react"),
  art("b", "Hello, canvas", "html"),
  art("c", "PRICING tiers experiment", "react"),
  art("d", "Legacy sketch"), // no kind → treated as "html"
];

// ── Kind resolution (back-compat default) ───────────────────────────────────
assert.equal(galleryArtifactKind(sketches[0]), "react", "explicit react kind resolves");
assert.equal(galleryArtifactKind(sketches[1]), "html", "explicit html kind resolves");
assert.equal(galleryArtifactKind(sketches[3]), "html", "missing kind defaults to html (legacy artifacts)");

// ── Search ──────────────────────────────────────────────────────────────────
assert.deepEqual(
  filterCanvasArtifacts(sketches, "pricing", "all").map((a) => a.id),
  ["a", "c"],
  "title match is a case-insensitive substring",
);
assert.deepEqual(
  filterCanvasArtifacts(sketches, "  PRICING  ", "all").map((a) => a.id),
  ["a", "c"],
  "query whitespace is trimmed before matching",
);
assert.deepEqual(
  filterCanvasArtifacts(sketches, "", "all").map((a) => a.id),
  ["a", "b", "c", "d"],
  "empty query passes everything through in order",
);
assert.deepEqual(
  filterCanvasArtifacts(sketches, "no such sketch", "all"),
  [],
  "a non-matching query yields an empty list, not a throw",
);

// ── Kind filter ─────────────────────────────────────────────────────────────
assert.deepEqual(
  filterCanvasArtifacts(sketches, "", "react").map((a) => a.id),
  ["a", "c"],
  "react filter keeps only react sketches",
);
assert.deepEqual(
  filterCanvasArtifacts(sketches, "", "html").map((a) => a.id),
  ["b", "d"],
  "html filter includes legacy artifacts without a kind",
);

// ── Combined ────────────────────────────────────────────────────────────────
assert.deepEqual(
  filterCanvasArtifacts(sketches, "pricing", "html"),
  [],
  "search and kind filter intersect",
);
assert.deepEqual(
  filterCanvasArtifacts(sketches, "sketch", "html").map((a) => a.id),
  ["d"],
  "search applies within the kind-filtered set",
);

// The filter never mutates its input.
const before = sketches.map((a) => a.id);
filterCanvasArtifacts(sketches, "pricing", "react");
assert.deepEqual(sketches.map((a) => a.id), before, "filtering leaves the source array untouched");

// Exhaustiveness: every filter value is accepted.
for (const f of ["all", "react", "html"] as CanvasKindFilter[]) {
  assert.ok(Array.isArray(filterCanvasArtifacts(sketches, "", f)), `filter "${f}" returns a list`);
}

console.log("canvas gallery filter helpers: ok");
