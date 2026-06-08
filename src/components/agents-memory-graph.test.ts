// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const memoryViewSource = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");
const graphSource = await readFile(new URL("./memory-graph-3d.tsx", import.meta.url), "utf8");
const modelSource = await readFile(new URL("../lib/memory-graph-3d-model.ts", import.meta.url), "utf8");
const smokeSource = await readFile(new URL("./memory-graph-3d-smoke.tsx", import.meta.url), "utf8");
const devPageSource = await readFile(new URL("../app/dev/memory-graph-3d/page.tsx", import.meta.url), "utf8");

assert.match(
  memoryViewSource,
  /import \{ MemoryGraph3D \} from "@\/components\/memory-graph-3d"/,
  "AgentsMemoryView should render the dedicated memory graph component instead of reusing TraceGraph3D",
);

assert.match(
  memoryViewSource,
  /from "@\/lib\/memory-graph-3d-model"[\s\S]*buildMemoryGraphModel\(\{/,
  "AgentsMemoryView should build the memory constellation from its existing memory API data",
);

assert.match(
  memoryViewSource,
  /viewMode, setViewMode.*"list"/,
  "Memory tab should keep a List/Graph view toggle with List as the default retrieval surface",
);

assert.match(
  memoryViewSource,
  /onSelectFamiliar=\{\(familiarId\) => setFamiliarFilter\(familiarId\)\}/,
  "Clicking a familiar hub should sync the existing familiar filter",
);

assert.match(
  memoryViewSource,
  /onOpenMemoryFile=\{onOpenMemoryFile\}/,
  "Clicking a memory node should use the existing memory-file opening path",
);

assert.doesNotMatch(
  memoryViewSource,
  /fetch\("\/api\/memory-graph"/,
  "The first implementation should not add a memory graph API route",
);

assert.match(
  graphSource,
  /import \* as THREE from "three"/,
  "MemoryGraph3D should render a real Three.js scene",
);

assert.match(
  graphSource,
  /InstancedMesh/,
  "MemoryGraph3D should use InstancedMesh for memory leaves",
);

assert.match(
  graphSource,
  /aria-label="3D memory constellation"/,
  "MemoryGraph3D should expose an accessible canvas label",
);

assert.match(
  graphSource,
  /prefers-reduced-motion/,
  "MemoryGraph3D should respect reduced motion preferences",
);

assert.match(
  modelSource,
  /hub:memory-files/,
  "The model should preserve filesystem memory entries under a neutral Memory Files hub",
);

assert.doesNotMatch(
  modelSource,
  /DelegationGraph/,
  "The memory graph model should not depend on the calls DelegationGraph domain model",
);

assert.match(
  smokeSource,
  /<MemoryGraph3D[\s\S]*graph=\{graph\}/,
  "Memory graph should have a deterministic smoke fixture for canvas verification",
);

assert.match(
  devPageSource,
  /MemoryGraph3DSmoke/,
  "Memory graph should expose a dev-only smoke route like the trace graph",
);
