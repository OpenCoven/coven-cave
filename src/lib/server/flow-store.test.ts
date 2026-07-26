import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveFlow, loadFlow } from "./flow-store.ts";
import type { FlowDoc } from "../flow/flow-doc.ts";

const dir = await mkdtemp(path.join(tmpdir(), "coven-flow-store-"));
process.env.COVEN_FLOWS_DIR = dir;

try {
  const now = "2026-01-01T00:00:00.000Z";
  const flow: FlowDoc = {
    id: "defaults",
    name: "Defaults",
    active: false,
    nodes: [
      {
        id: "a",
        type: "familiar",
        name: "A",
        position: { x: 0, y: 0 },
        params: {},
        disabled: false,
        displayNote: false,
        settings: { retryOnFail: false, maxTries: 1, onError: "stop" },
      },
      {
        id: "b",
        type: "familiar",
        name: "B",
        position: { x: 240, y: 0 },
        params: {},
        disabled: true,
        displayNote: true,
      },
    ],
    edges: [],
    createdAt: now,
    updatedAt: now,
    schema: 1,
  };

  await saveFlow(flow);
  const loaded = await loadFlow("defaults");
  assert.ok(loaded, "saved flow can be loaded");
  assert.equal(loaded.nodes.find((node) => node.id === "a")?.disabled, undefined, "enabled default is omitted");
  assert.equal(loaded.nodes.find((node) => node.id === "a")?.displayNote, undefined, "display-note default is omitted");
  assert.equal(loaded.nodes.find((node) => node.id === "a")?.settings, undefined, "execution-setting defaults are omitted");
  assert.equal(loaded.nodes.find((node) => node.id === "b")?.disabled, true, "disabled state persists");
  assert.equal(loaded.nodes.find((node) => node.id === "b")?.displayNote, true, "display-note enabled state persists");

  // Dangling edges (source/target referencing a node that isn't in the doc) are
  // dropped on load rather than persisted forever as references to a ghost node.
  const danglingFlow: FlowDoc = {
    id: "dangling",
    name: "Dangling",
    active: false,
    nodes: [
      { id: "n1", type: "trigger.manual", name: "Trigger", position: { x: 0, y: 0 }, params: {} },
      { id: "n2", type: "familiar", name: "Do", position: { x: 240, y: 0 }, params: {} },
    ],
    edges: [
      { id: "e-valid", source: "n1", sourceHandle: "main", target: "n2", targetHandle: "in" },
      { id: "e-dangling-target", source: "n1", sourceHandle: "main", target: "ghost", targetHandle: "in" },
      { id: "e-dangling-source", source: "ghost", sourceHandle: "main", target: "n2", targetHandle: "in" },
    ],
    createdAt: now,
    updatedAt: now,
    schema: 1,
  };
  await saveFlow(danglingFlow);
  const reloaded = await loadFlow("dangling");
  assert.ok(reloaded, "dangling flow loads");
  assert.deepEqual(
    reloaded.edges.map((edge) => edge.id),
    ["e-valid"],
    "only the edge whose source and target both exist survives coercion",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
  delete process.env.COVEN_FLOWS_DIR;
}

console.log("flow-store.test.ts OK");
