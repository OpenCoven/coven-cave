import assert from "node:assert/strict";

import {
  adoptCanvasContentSnapshot,
  reconcileCanvasAnnotationSnapshot,
} from "./canvas-content-sync.ts";
import type { CanvasAnnotation, CanvasArtifact } from "./canvas-artifacts.ts";

const oldUpdatedAt = "2026-07-20T10:00:00.000Z";
const newUpdatedAt = "2026-07-20T11:00:00.000Z";
const annotation = {
  id: "annotation-1",
  target: { selector: "button", label: "Button", excerpt: "<button />" },
  note: "Increase contrast",
  createdAt: oldUpdatedAt,
  updatedAt: newUpdatedAt,
};
const pendingAnnotation = {
  ...annotation,
  id: "annotation-2",
  target: { selector: "main", label: "Main", excerpt: "<main />" },
  note: "Tighten spacing",
};
const artifact = (
  code: string,
  updatedAt = oldUpdatedAt,
  kind: "html" | "react" = "html",
  annotations: CanvasAnnotation[] = [],
): CanvasArtifact => ({
  id: "artifact-1",
  title: "Artifact",
  prompt: "Build it",
  code,
  kind,
  createdAt: oldUpdatedAt,
  updatedAt,
  annotations,
});

{
  const accepted = artifact("<main>saved</main>");
  const result = reconcileCanvasAnnotationSnapshot({
    acceptedArtifact: accepted,
    incomingArtifact: artifact("<main>saved</main>", oldUpdatedAt, "html", [annotation]),
    localCode: "<main>manually edited</main>",
    localKind: "html",
    pendingOperations: [{ id: "artifact-1", annotation: pendingAnnotation }],
  });
  assert.equal(result.code, "<main>manually edited</main>", "annotation PATCH preserves manually edited code");
  assert.equal(result.kind, "html");
  assert.equal(result.contentDirty, true, "manual content differences remain dirty");
  assert.equal(result.contentConflict, false, "the same persisted content revision is not a conflict");
  assert.equal(result.acceptedArtifact.updatedAt, oldUpdatedAt, "the expected content revision stays accepted");
  assert.deepEqual(
    result.annotations,
    [annotation, pendingAnnotation],
    "server annotations merge with later pending operations without replacing dirty local content",
  );
}

{
  const accepted = artifact("<main>saved</main>");
  const result = reconcileCanvasAnnotationSnapshot({
    acceptedArtifact: accepted,
    incomingArtifact: artifact("<main>saved</main>", oldUpdatedAt, "html", [annotation]),
    localCode: "export default function App(){return <main>refined</main>}",
    localKind: "react",
    pendingOperations: [],
  });
  assert.equal(result.kind, "react", "a successful ordinary Refine kind change survives annotation PATCH");
  assert.match(result.code, /refined/, "a successful ordinary Refine code change survives annotation PATCH");
  assert.equal(result.contentDirty, true, "refined local content remains dirty until it is saved");
}

{
  const accepted = artifact("<main>saved</main>");
  const result = reconcileCanvasAnnotationSnapshot({
    acceptedArtifact: accepted,
    incomingArtifact: artifact("<main>changed elsewhere</main>", newUpdatedAt, "react", [annotation]),
    localCode: "<main>local draft</main>",
    localKind: "html",
    pendingOperations: [],
  });
  assert.equal(result.code, "<main>local draft</main>", "newer persisted content never overwrites a dirty draft");
  assert.equal(result.kind, "html");
  assert.equal(result.contentConflict, true, "newer persisted content creates an explicit conflict");
  assert.equal(
    result.acceptedArtifact.updatedAt,
    oldUpdatedAt,
    "a conflict never pairs stale local content with the newer expected revision",
  );
  assert.equal(result.reportedArtifact.updatedAt, newUpdatedAt, "the parent still receives the real server snapshot");
  assert.deepEqual(result.annotations, [annotation], "conflicting PATCH annotations still merge locally");
}

{
  const accepted = artifact("<main>saved</main>");
  const result = reconcileCanvasAnnotationSnapshot({
    acceptedArtifact: accepted,
    incomingArtifact: artifact("<main>changed elsewhere</main>", newUpdatedAt, "react", [annotation]),
    localCode: accepted.code,
    localKind: "html",
    pendingOperations: [],
  });
  assert.equal(result.code, "<main>changed elsewhere</main>", "a clean viewer adopts newer server code");
  assert.equal(result.kind, "react", "a clean viewer adopts the complete newer server kind");
  assert.equal(result.acceptedArtifact.updatedAt, newUpdatedAt, "clean adoption advances the expected revision");
  assert.equal(result.contentDirty, false);
  assert.equal(result.contentConflict, false);
}

{
  const saved = artifact("<main>comments applied</main>", newUpdatedAt, "react");
  const result = adoptCanvasContentSnapshot(saved, []);
  assert.equal(result.code, saved.code, "successful same-artifact Apply adopts returned code");
  assert.equal(result.kind, "react");
  assert.equal(result.acceptedArtifact.updatedAt, newUpdatedAt);
  assert.equal(result.contentDirty, false, "successful same-artifact Apply marks content clean");
  assert.equal(result.contentConflict, false, "successful same-artifact Apply clears content conflict");
}

console.log("canvas content synchronization: ok");
