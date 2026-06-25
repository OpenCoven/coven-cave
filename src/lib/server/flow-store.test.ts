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
} finally {
  await rm(dir, { recursive: true, force: true });
  delete process.env.COVEN_FLOWS_DIR;
}

console.log("flow-store.test.ts OK");
