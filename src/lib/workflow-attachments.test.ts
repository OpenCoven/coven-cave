import assert from "node:assert/strict";
import test from "node:test";

import { coerceManifest } from "./workflow-source.ts";
import { workflowToManifest, workflowToYaml } from "./workflow-edit.ts";
import {
  inheritedWorkflowPermissions,
  effectiveWorkflowPermissions,
  redundantOwnPermissions,
} from "./workflow-permissions.ts";

const MANIFEST = {
  id: "demo",
  version: "0.1.0",
  permissions: ["repo.read"],
  skills: ["deep-research", "brainstorming"],
  mcp: ["github", "linear"],
  http: [
    { id: "ping", name: "Ping", method: "GET", url: "https://example.com/health", note: "liveness" },
    { url: "https://example.com/data" }, // id defaulted, no method
    { name: "no url - dropped" },
  ],
  steps: [
    { id: "input", kind: "input", summary: "in" },
    { id: "output", kind: "output", summary: "out", requires: ["input"] },
  ],
};

test("coerceManifest parses skills, mcp and http attachments", () => {
  const wf = coerceManifest(MANIFEST, "demo");
  assert.deepEqual(wf.skills, ["deep-research", "brainstorming"]);
  assert.deepEqual(wf.mcp, ["github", "linear"]);
  assert.equal(wf.http?.length, 2, "the url-less call is dropped");
  assert.deepEqual(wf.http?.[0], { id: "ping", name: "Ping", method: "GET", url: "https://example.com/health", note: "liveness" });
  assert.equal(wf.http?.[1].id, "call-2", "missing id is defaulted by index");
  assert.equal(wf.http?.[1].url, "https://example.com/data");
});

test("attachments round-trip through the manifest serializer", () => {
  const wf = coerceManifest(MANIFEST, "demo");
  const manifest = workflowToManifest(wf) as Record<string, unknown>;
  assert.deepEqual(manifest.skills, ["deep-research", "brainstorming"]);
  assert.deepEqual(manifest.mcp, ["github", "linear"]);
  assert.equal((manifest.http as unknown[]).length, 2);
  // http call keys are ordered for stable diffs
  assert.deepEqual(Object.keys((manifest.http as Record<string, unknown>[])[0]), ["id", "name", "method", "url", "note"]);
  const yaml = workflowToYaml(wf);
  assert.match(yaml, /skills:/);
  assert.match(yaml, /mcp:/);
  assert.match(yaml, /url: https:\/\/example\.com\/health/);
  // empty attachment arrays don't serialize
  const bare = coerceManifest({ id: "x", version: "0", steps: [{ id: "input", kind: "input" }, { id: "output", kind: "output" }] }, "x");
  assert.doesNotMatch(workflowToYaml(bare), /skills:|mcp:|http:/);
});

test("inheritedWorkflowPermissions surfaces skill permissions with provenance", () => {
  const skills: Record<string, { name: string; permissions: string[] }> = {
    "deep-research": { name: "Deep Research", permissions: ["web.fetch", "file.read"] },
    brainstorming: { name: "Brainstorming", permissions: ["memory.read"] },
  };
  const wf = coerceManifest(MANIFEST, "demo");
  const inherited = inheritedWorkflowPermissions(wf, (id) => skills[id]);
  // web.fetch appears from deep-research AND from the API call — distinct sources
  assert.deepEqual(
    inherited.map((i) => `${i.permission}@${i.source}`),
    ["web.fetch@Deep Research", "file.read@Deep Research", "memory.read@Brainstorming", "web.fetch@API calls"],
  );
  assert.deepEqual(inherited.filter((i) => i.kind === "http"), [
    { permission: "web.fetch", source: "API calls", kind: "http" },
  ]);
});

test("effective + redundant permission helpers", () => {
  const wf = coerceManifest({ ...MANIFEST, permissions: ["repo.read", "web.fetch"] }, "demo");
  const inherited = inheritedWorkflowPermissions(wf, (id) =>
    id === "deep-research" ? { name: "Deep Research", permissions: ["web.fetch"] } : undefined,
  );
  assert.deepEqual(effectiveWorkflowPermissions(wf.permissions, inherited).sort(), ["repo.read", "web.fetch"]);
  // web.fetch is declared AND inherited → redundant
  assert.deepEqual(redundantOwnPermissions(wf.permissions, inherited), ["web.fetch"]);
});

test("a skill with no declared permissions contributes nothing", () => {
  const wf = coerceManifest({ ...MANIFEST, http: [], skills: ["plain"] }, "demo");
  const inherited = inheritedWorkflowPermissions(wf, () => ({ name: "Plain" }));
  assert.deepEqual(inherited, []);
});

console.log("workflow-attachments.test.ts: ok (node:test)");
