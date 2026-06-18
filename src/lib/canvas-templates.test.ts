// @ts-nocheck
import assert from "node:assert/strict";

const { CANVAS_TEMPLATES, buildPreviewSrcDoc, sanitizeArtifact, clampArtifactCode } = await import("./canvas-artifacts.ts");

// A non-empty, well-formed set of starter templates.
assert.ok(Array.isArray(CANVAS_TEMPLATES) && CANVAS_TEMPLATES.length >= 3, "several templates offered");

const ids = new Set();
for (const t of CANVAS_TEMPLATES) {
  assert.ok(t.id && !ids.has(t.id), `unique id: ${t.id}`);
  ids.add(t.id);
  assert.ok(typeof t.label === "string" && t.label.trim(), `${t.id} has a label`);
  assert.ok(typeof t.description === "string" && t.description.trim(), `${t.id} has a description`);
  assert.ok(t.kind === "html" || t.kind === "react", `${t.id} kind is html|react`);
  assert.ok(typeof t.code === "string" && t.code.length > 40, `${t.id} has real code`);
  // Renders through the preview pipeline without throwing, and survives the
  // storage clamp + sanitize round-trip a created artifact goes through.
  assert.ok(buildPreviewSrcDoc(t.code).includes("<"), `${t.id} previews as HTML`);
  assert.equal(clampArtifactCode(t.code), t.code, `${t.id} code within storage cap`);
  const art = sanitizeArtifact({ id: `art-${t.id}`, prompt: "", code: t.code, kind: t.kind, title: t.label, createdAt: "x", updatedAt: "x" });
  assert.ok(art && art.code.length > 40, `${t.id} survives sanitizeArtifact`);
}

// Expected curated set is present.
for (const id of ["landing", "dashboard", "signin", "pricing"]) {
  assert.ok(CANVAS_TEMPLATES.some((t) => t.id === id), `template '${id}' present`);
}

console.log("canvas-templates.test.ts: ok");
