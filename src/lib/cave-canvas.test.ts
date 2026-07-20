// @ts-nocheck
import assert from "node:assert/strict";

// COVEN_CAVE_HOME must be set BEFORE cave-canvas.ts is evaluated — the module
// computes CANVAS_PATH at load. A static import would hoist above this
// assignment and point every store call at the REAL ~/.coven store (which is
// exactly how a test artifact once leaked into live data), so the module is
// imported dynamically below.
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = mkdtempSync(path.join(os.tmpdir(), "cave-canvas-test-"));
process.env.COVEN_CAVE_HOME = tmpHome;

const {
  sanitizePositions,
  upsertCanvasArtifact,
  deleteCanvasArtifact,
  loadCanvas,
  mutateCanvasArtifactAnnotation,
  nextCanvasArtifactUpdatedAt,
} = await import(
  "./cave-canvas.ts"
);

// sanitizePositions is the trust boundary for everything that reaches disk or
// arrives over the PUT body — it must drop anything that isn't a finite point.

assert.deepEqual(
  sanitizePositions({ a: { x: 1, y: 2 }, b: { x: 0, y: -5 } }),
  { a: { x: 1, y: 2 }, b: { x: 0, y: -5 } },
  "well-formed finite points pass through",
);

assert.deepEqual(
  sanitizePositions({ art: { x: 10, y: 20, width: 640, height: 420 } }),
  { art: { x: 10, y: 20, width: 640, height: 420 } },
  "artifact positions may persist finite resized dimensions",
);

assert.deepEqual(sanitizePositions(null), {}, "null is coerced to an empty map");
assert.deepEqual(sanitizePositions([1, 2, 3]), {}, "arrays are rejected (positions is an object map)");
assert.deepEqual(sanitizePositions("nope"), {}, "primitives are rejected");

assert.deepEqual(
  sanitizePositions({
    good: { x: 3, y: 4 },
    goodSize: { x: 3, y: 4, width: 500, height: 300 },
    nanX: { x: NaN, y: 0 },
    infY: { x: 0, y: Infinity },
    nanWidth: { x: 1, y: 2, width: NaN, height: 300 },
    infHeight: { x: 1, y: 2, width: 500, height: Infinity },
    missing: { x: 1 },
    stringy: { x: "1", y: "2" },
    nested: { x: { z: 1 }, y: 2 },
    notObj: 5,
  }),
  { good: { x: 3, y: 4 }, goodSize: { x: 3, y: 4, width: 500, height: 300 } },
  "only finite numeric points and finite optional dimensions survive the mixed bag",
);

console.log("cave-canvas.test.ts ✓");

// ═══════════════════════════════════════════════════════════════════════════
// upsertCanvasArtifact — content dedupe (cave-spq7). "Save to Canvas" mints a
// fresh id per click; id-only dedupe let byte-identical re-saves pile up as
// twin tiles (two dup pairs observed in a real store). Runs against the temp
// store established by COVEN_CAVE_HOME above.
// ═══════════════════════════════════════════════════════════════════════════

const art = (id, code, extra = {}) => ({
  id,
  title: `t-${id}`,
  prompt: `p-${id}`,
  code,
  kind: "html",
  createdAt: "2026-07-17T00:00:00Z",
  updatedAt: "2026-07-17T00:00:00Z",
  ...extra,
});

{
  const first = await upsertCanvasArtifact(art("art-one", "<!doctype html>same"));
  assert.equal(first.savedId, "art-one", "a fresh save settles under its own id");
  assert.equal(first.file.artifacts.length, 1);

  const annotated = await upsertCanvasArtifact(art("art-annotated", "<!doctype html>annotated", {
    annotations: [
      {
        id: " comment-1 ",
        target: {
          selector: " main > button ",
          label: " Primary action ",
          excerpt: " Save ",
        },
        note: " Increase contrast ",
        createdAt: "2026-07-17T00:00:00Z",
        updatedAt: "not-a-date",
      },
      {
        id: "",
        target: { selector: "", label: "bad", excerpt: "bad" },
        note: "must not persist",
        createdAt: "bad",
        updatedAt: "bad",
      },
    ],
  }));
  assert.deepEqual(
    annotated.file.artifacts.find((artifact) => artifact.id === "art-annotated")?.annotations,
    [{
      id: "comment-1",
      target: { selector: "main > button", label: "Primary action", excerpt: "Save" },
      note: "Increase contrast",
      createdAt: "2026-07-17T00:00:00Z",
      updatedAt: "2026-07-17T00:00:00Z",
    }],
    "upsert sanitizes annotations before returning the persisted file",
  );
  assert.deepEqual(
    (await loadCanvas()).artifacts.find((artifact) => artifact.id === "art-annotated")?.annotations,
    annotated.file.artifacts.find((artifact) => artifact.id === "art-annotated")?.annotations,
    "sanitized annotations survive a disk round trip",
  );
  const persisted = JSON.parse(readFileSync(path.join(tmpHome, "canvas.json"), "utf8"));
  assert.equal(
    persisted.artifacts.find((artifact) => artifact.id === "art-annotated").annotations.length,
    1,
    "malformed annotations never reach disk",
  );

  const annotationPreservingUpdate = await upsertCanvasArtifact(
    art("art-annotated", "<!doctype html>annotated-updated", {
      title: "updated without annotations",
    }),
  );
  assert.deepEqual(
    annotationPreservingUpdate.file.artifacts.find((artifact) => artifact.id === "art-annotated")
      ?.annotations,
    annotated.file.artifacts.find((artifact) => artifact.id === "art-annotated")?.annotations,
    "same-id updates preserve incumbent annotations when the raw payload omits annotations",
  );

  for (const [label, malformedAnnotations] of [
    ["null", null],
    ["an object", { id: "not-an-array" }],
    ["an all-invalid array", [{ id: "", target: { selector: "" } }]],
  ]) {
    const malformedUpdate = await upsertCanvasArtifact(
      art("art-annotated", "<!doctype html>annotated-updated", {
        annotations: malformedAnnotations,
      }),
    );
    assert.deepEqual(
      malformedUpdate.file.artifacts.find((artifact) => artifact.id === "art-annotated")
        ?.annotations,
      annotated.file.artifacts.find((artifact) => artifact.id === "art-annotated")?.annotations,
      `same-id updates preserve incumbent annotations when raw annotations is ${label}`,
    );
  }

  const annotationClearingUpdate = await upsertCanvasArtifact(
    art("art-annotated", "<!doctype html>annotated-updated", {
      annotations: [],
    }),
  );
  assert.equal(
    annotationClearingUpdate.file.artifacts.find((artifact) => artifact.id === "art-annotated")
      ?.annotations,
    undefined,
    "same-id updates explicitly clear annotations when the raw payload provides an empty array",
  );

  // Byte-identical re-save under a NEW id must update the incumbent, not twin it.
  const resave = await upsertCanvasArtifact(
    art("art-two", "<!doctype html>same", {
      title: "renamed",
      updatedAt: "2026-07-17T01:00:00Z",
      annotations: [{
        id: "deduped-comment",
        target: { selector: "button", label: "Button", excerpt: "Save" },
        note: "Keep this comment",
        createdAt: "2026-07-17T00:30:00Z",
        updatedAt: "2026-07-17T00:30:00Z",
      }],
    }),
  );
  assert.equal(resave.file.artifacts.length, 2, "unchanged content must not mint a twin tile");
  assert.equal(resave.savedId, "art-one", "the save settles into the incumbent's id");
  const settled = resave.file.artifacts.find((artifact) => artifact.id === "art-one");
  assert.equal(settled.id, "art-one", "incumbent id survives (saved position stays keyed to it)");
  assert.equal(settled.createdAt, "2026-07-17T00:00:00Z", "incumbent createdAt survives");
  assert.equal(settled.updatedAt, "2026-07-17T01:00:00Z", "caller's updatedAt is taken");
  assert.equal(settled.title, "renamed", "caller's title is taken");
  assert.equal(settled.annotations?.[0]?.id, "deduped-comment", "annotations survive content dedupe");

  const annotationPreservingResave = await upsertCanvasArtifact(
    art("art-two-without-annotations", "<!doctype html>same", {
      title: "renamed again",
      updatedAt: "2026-07-17T02:00:00Z",
    }),
  );
  assert.equal(annotationPreservingResave.savedId, "art-one");
  assert.equal(
    annotationPreservingResave.file.artifacts.find((artifact) => artifact.id === "art-one")
      ?.annotations?.[0]?.id,
    "deduped-comment",
    "newly minted byte-identical saves preserve incumbent annotations when annotations are omitted",
  );

  // Same code but a DIFFERENT kind is a different artifact — no dedupe.
  const otherKind = await upsertCanvasArtifact(art("art-react", "<!doctype html>same", { kind: "react" }));
  assert.equal(otherKind.file.artifacts.length, 3, "same code under another kind stays separate");
  assert.equal(otherKind.savedId, "art-react");

  // Different content is a plain insert.
  const different = await upsertCanvasArtifact(art("art-three", "<!doctype html>other"));
  assert.equal(different.file.artifacts.length, 4, "distinct content inserts normally");

  // Same-id replace (the refine/update path) still wins over content dedupe.
  const replaced = await upsertCanvasArtifact(art("art-three", "<!doctype html>edited"));
  assert.equal(replaced.savedId, "art-three", "same-id update replaces in place");
  assert.equal(replaced.file.artifacts.length, 4, "same-id update does not grow the store");

  // Same-id replacement remains authoritative even if the replacement now
  // matches another artifact's content. It must not delete the edited record
  // and settle under the other id.
  const matchingReplace = await upsertCanvasArtifact(art("art-three", "<!doctype html>same"));
  assert.equal(matchingReplace.savedId, "art-three", "same-id update does not settle under a twin");
  assert.equal(matchingReplace.file.artifacts.length, 4, "same-id update does not collapse distinct records");
  assert.equal(
    matchingReplace.file.artifacts.find((artifact) => artifact.id === "art-three")?.code,
    "<!doctype html>same",
  );

  // Unusable payload leaves the store untouched and reports no saved id.
  const junk = await upsertCanvasArtifact({ nope: true });
  assert.equal(junk.savedId, null, "an unusable payload settles nowhere");
  assert.equal(junk.file.artifacts.length, 4);

  await deleteCanvasArtifact("art-react");
  assert.equal((await loadCanvas()).artifacts.length, 3, "delete by id still works");
}

// ── Incremental annotation mutations ────────────────────────────────────────

{
  const initialAnnotations = Array.from({ length: 100 }, (_, index) => ({
    id: `annotation-${index}`,
    target: {
      selector: `#target-${index}`,
      label: `Target ${index}`,
      excerpt: `<div>${index}</div>`,
    },
    note: `Note ${index}`,
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt: "2026-07-20T00:00:00Z",
  }));
  await upsertCanvasArtifact(art("annotation-target", "<main>newer code</main>", {
    title: "Server title",
    prompt: "Server prompt",
    kind: "react",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-07-20T00:00:00Z",
    annotations: initialAnnotations,
  }));

  const boundedUpdate = await mutateCanvasArtifactAnnotation({
    id: "annotation-target",
    annotation: {
      id: "annotation-99",
      target: {
        selector: " #target-99 ",
        label: ` ${"L".repeat(250)} `,
        excerpt: ` ${"E".repeat(1_100)} `,
      },
      note: ` ${"N".repeat(4_100)} `,
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T01:00:00Z",
    },
  });
  assert.equal(boundedUpdate.status, "updated");
  assert.equal(boundedUpdate.artifact?.annotations?.length, 100, "annotation updates preserve the count cap");
  const bounded = boundedUpdate.artifact?.annotations?.find((entry) => entry.id === "annotation-99");
  assert.equal(bounded?.target.label.length, 200, "annotation labels are bounded");
  assert.equal(bounded?.target.excerpt.length, 1_000, "annotation excerpts are bounded");
  assert.equal(bounded?.note.length, 4_000, "annotation notes are bounded");

  const cappedInsert = await mutateCanvasArtifactAnnotation({
    id: "annotation-target",
    annotation: {
      id: "annotation-over-cap",
      target: { selector: "#over-cap", label: "Over cap", excerpt: "<div />" },
      note: "Do not insert",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T00:00:00Z",
    },
  });
  assert.equal(cappedInsert.status, "updated");
  assert.equal(cappedInsert.artifact?.annotations?.length, 100, "a new annotation cannot exceed the count cap");
  assert.ok(
    !cappedInsert.artifact?.annotations?.some((entry) => entry.id === "annotation-over-cap"),
    "over-cap annotation is not persisted",
  );

  const selectorUpdate = await mutateCanvasArtifactAnnotation({
    id: "annotation-target",
    annotation: {
      id: "replacement-id",
      target: { selector: "#target-98", label: "Replaced by selector", excerpt: "<button />" },
      note: "Updated",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T02:00:00Z",
    },
  });
  assert.equal(selectorUpdate.artifact?.annotations?.length, 100);
  assert.equal(
    selectorUpdate.artifact?.annotations?.find((entry) => entry.target.selector === "#target-98")?.id,
    "replacement-id",
    "upsert matches an incumbent by selector as well as id",
  );

  const removed = await mutateCanvasArtifactAnnotation({
    id: "annotation-target",
    removeAnnotationId: "replacement-id",
  });
  assert.equal(removed.status, "updated");
  assert.equal(removed.artifact?.annotations?.length, 99, "remove deletes one annotation");

  const beforeMetadata = removed.artifact;
  const added = await mutateCanvasArtifactAnnotation({
    id: "annotation-target",
    annotation: {
      id: "fresh",
      target: { selector: "#fresh", label: "Fresh", excerpt: "<div />" },
      note: "Fresh note",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T03:00:00Z",
    },
  });
  assert.equal(added.status, "updated");
  assert.equal(added.artifact?.code, beforeMetadata?.code, "annotation add never replaces artifact code");
  assert.equal(added.artifact?.title, beforeMetadata?.title, "annotation add never replaces artifact title");
  assert.equal(added.artifact?.prompt, beforeMetadata?.prompt, "annotation add never replaces artifact prompt");
  assert.equal(added.artifact?.kind, beforeMetadata?.kind, "annotation add never replaces artifact kind");
  assert.equal(added.artifact?.createdAt, beforeMetadata?.createdAt, "annotation add never replaces createdAt");

  const concurrentMutation = mutateCanvasArtifactAnnotation({
    id: "annotation-target",
    annotation: {
      id: "fresh",
      target: { selector: "#fresh", label: "Concurrent", excerpt: "<div />" },
      note: "Keep",
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-20T04:00:00Z",
    },
  });
  const concurrentRevision = upsertCanvasArtifact(art("annotation-target", "<main>newest code</main>", {
    title: "Newest title",
    prompt: "Newest prompt",
    kind: "html",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-07-20T05:00:00Z",
  }));
  await Promise.all([concurrentMutation, concurrentRevision]);
  const newest = (await loadCanvas()).artifacts.find((entry) => entry.id === "annotation-target");
  assert.equal(newest?.code, "<main>newest code</main>", "a concurrent newer code revision survives annotation persistence");
  assert.equal(newest?.title, "Newest title", "a concurrent newer title survives annotation persistence");
  assert.equal(
    newest?.annotations?.find((entry) => entry.id === "fresh")?.note,
    "Keep",
    "the serialized annotation update also survives",
  );

  const cleared = await mutateCanvasArtifactAnnotation({ id: "annotation-target", clearAnnotations: true });
  assert.equal(cleared.status, "updated");
  assert.equal(cleared.artifact?.annotations, undefined, "explicit clear removes all annotations");
  assert.equal(cleared.artifact?.code, "<main>newest code</main>", "clear leaves current code untouched");

  const unknown = await mutateCanvasArtifactAnnotation({
    id: "missing-artifact",
    removeAnnotationId: "anything",
  });
  assert.equal(unknown.status, "not_found", "unknown artifacts produce an explicit safe not-found result");

  const storePath = path.join(tmpHome, "canvas.json");
  for (const malformed of [
    null,
    {},
    { id: "annotation-target" },
    { id: "annotation-target", clearAnnotations: true, removeAnnotationId: "ambiguous" },
    { id: "annotation-target", removeAnnotationId: "" },
    { id: "annotation-target", annotation: { id: "", target: {}, note: "" } },
    { id: "annotation-target", annotation: initialAnnotations[0], code: "forged" },
  ]) {
    const before = readFileSync(storePath, "utf8");
    const result = await mutateCanvasArtifactAnnotation(malformed);
    assert.equal(result.status, "invalid", "malformed or ambiguous annotation mutations are rejected");
    assert.equal(readFileSync(storePath, "utf8"), before, "invalid annotation mutations do not alter disk");
  }
}

// ── Optimistic content revisions ─────────────────────────────────────────────

{
  const originalUpdatedAt = "2026-07-20T06:00:00Z";
  const clientUpdatedAt = "2099-07-20T07:00:00Z";
  await upsertCanvasArtifact(art("revision-target", "<main>original</main>", {
    updatedAt: originalUpdatedAt,
    annotations: [{
      id: "revision-comment",
      target: { selector: "main", label: "Main", excerpt: "<main />" },
      note: "Change this",
      createdAt: originalUpdatedAt,
      updatedAt: originalUpdatedAt,
    }],
  }));

  const annotationOnly = await mutateCanvasArtifactAnnotation({
    id: "revision-target",
    annotation: {
      id: "revision-comment",
      target: { selector: "main", label: "Main", excerpt: "<main />" },
      note: "Change this safely",
      createdAt: originalUpdatedAt,
      updatedAt: "2026-07-20T06:30:00Z",
    },
  });
  assert.equal(annotationOnly.status, "updated");
  assert.equal(
    annotationOnly.artifact?.updatedAt,
    originalUpdatedAt,
    "annotation-only PATCH does not advance the content revision",
  );

  const exact = await upsertCanvasArtifact(
    art("revision-target", "<main>revised</main>", { updatedAt: clientUpdatedAt }),
    { expectedUpdatedAt: originalUpdatedAt },
  );
  assert.equal(exact.status, "saved", "the exact content revision may be replaced");
  assert.equal(exact.file.artifacts.find((entry) => entry.id === "revision-target")?.code, "<main>revised</main>");
  assert.ok(
    Date.parse(exact.artifact.updatedAt) > Date.parse(originalUpdatedAt),
    "a guarded save receives a server revision strictly newer than the incumbent",
  );
  assert.notEqual(
    exact.artifact.updatedAt,
    clientUpdatedAt,
    "a guarded save does not trust the client-submitted revision",
  );

  const beforeConflict = readFileSync(path.join(tmpHome, "canvas.json"), "utf8");
  const conflict = await upsertCanvasArtifact(
    art("revision-target", "<main>stale overwrite</main>", {
      updatedAt: "2026-07-20T08:00:00Z",
    }),
    { expectedUpdatedAt: originalUpdatedAt, resolvedAnnotations: [] },
  );
  assert.equal(conflict.status, "conflict", "a stale content revision is rejected");
  assert.equal(conflict.currentUpdatedAt, exact.artifact.updatedAt, "the second client conflicts against the first server revision");
  assert.equal(readFileSync(path.join(tmpHome, "canvas.json"), "utf8"), beforeConflict, "conflict writes nothing");

  await deleteCanvasArtifact("revision-target");
  const beforeMissing = readFileSync(path.join(tmpHome, "canvas.json"), "utf8");
  const missing = await upsertCanvasArtifact(
    art("revision-target", "<main>must not resurrect</main>", {
      updatedAt: "2026-07-20T09:00:00Z",
    }),
    { expectedUpdatedAt: exact.artifact.updatedAt, resolvedAnnotations: [] },
  );
  assert.equal(missing.status, "not_found", "a preconditioned update cannot recreate a deleted artifact");
  assert.equal(readFileSync(path.join(tmpHome, "canvas.json"), "utf8"), beforeMissing, "not-found writes nothing");
  assert.ok(
    !(await loadCanvas()).artifacts.some((entry) => entry.id === "revision-target"),
    "delete-during-generation remains deleted",
  );

  const unguardedCreate = await upsertCanvasArtifact(art("unguarded-create", "<main>new</main>"));
  assert.equal(unguardedCreate.status, "saved", "new creates remain unaffected without a precondition");
  const unguardedDedupe = await upsertCanvasArtifact(
    art("unguarded-twin", "<main>new</main>", { updatedAt: "2026-07-20T10:00:00Z" }),
  );
  assert.equal(unguardedDedupe.status, "saved", "content dedupe remains unaffected without a precondition");
  assert.equal(unguardedDedupe.savedId, "unguarded-create");
}

{
  const incumbent = "2026-07-20T06:00:00.123Z";
  const incumbentMs = Date.parse(incumbent);
  assert.equal(
    nextCanvasArtifactUpdatedAt(incumbent, incumbentMs),
    "2026-07-20T06:00:00.124Z",
    "an equal server clock advances the revision by one millisecond",
  );
  assert.equal(
    nextCanvasArtifactUpdatedAt(incumbent, incumbentMs - 60_000),
    "2026-07-20T06:00:00.124Z",
    "a server clock behind the incumbent still advances the revision by one millisecond",
  );
  assert.equal(
    nextCanvasArtifactUpdatedAt(incumbent, incumbentMs + 60_000),
    "2026-07-20T06:01:00.123Z",
    "the helper uses and normalizes a newer server clock",
  );
}

// ── Guarded comment resolution preserves concurrent annotations ──────────────

{
  const contentRevision = "2026-07-20T11:00:00.000Z";
  const revisedContentRevision = "2026-07-20T12:00:00.000Z";
  const appliedAt = "2026-07-20T11:01:00.000Z";
  const concurrentAt = "2026-07-20T11:02:00.000Z";
  const annotation = (id: string, updatedAt: string, note = id) => ({
    id,
    target: { selector: `#${id}`, label: id, excerpt: `<div id="${id}" />` },
    note,
    createdAt: appliedAt,
    updatedAt,
  });

  await upsertCanvasArtifact(art("resolution-new", "<main>original</main>", {
    updatedAt: contentRevision,
    annotations: [annotation("applied", appliedAt)],
  }));
  await mutateCanvasArtifactAnnotation({
    id: "resolution-new",
    annotation: annotation("concurrent", concurrentAt),
  });
  const preservesConcurrent = await upsertCanvasArtifact(
    art("resolution-new", "<main>revised</main>", {
      updatedAt: revisedContentRevision,
      annotations: [],
    }),
    {
      expectedUpdatedAt: contentRevision,
      resolvedAnnotations: [{ id: "applied", updatedAt: appliedAt }],
    },
  );
  assert.equal(preservesConcurrent.status, "saved");
  assert.deepEqual(
    preservesConcurrent.file.artifacts.find((entry) => entry.id === "resolution-new")?.annotations?.map((entry) => entry.id),
    ["concurrent"],
    "a concurrent new annotation survives while the unchanged applied annotation is cleared",
  );

  await upsertCanvasArtifact(art("resolution-modified", "<main>original</main>", {
    updatedAt: contentRevision,
    annotations: [annotation("same-id", appliedAt, "Original request")],
  }));
  await mutateCanvasArtifactAnnotation({
    id: "resolution-modified",
    annotation: annotation("same-id", concurrentAt, "Edited concurrently"),
  });
  const preservesModified = await upsertCanvasArtifact(
    art("resolution-modified", "<main>revised</main>", {
      updatedAt: revisedContentRevision,
      annotations: [],
    }),
    {
      expectedUpdatedAt: contentRevision,
      resolvedAnnotations: [{ id: "same-id", updatedAt: appliedAt }],
    },
  );
  assert.equal(preservesModified.status, "saved");
  assert.equal(
    preservesModified.file.artifacts.find((entry) => entry.id === "resolution-modified")?.annotations?.[0]?.note,
    "Edited concurrently",
    "a same-id annotation edited during generation survives an old resolution token",
  );

  const storePath = path.join(tmpHome, "canvas.json");
  for (const resolvedAnnotations of [
    null,
    {},
    Array.from({ length: 101 }, (_, index) => ({ id: `id-${index}`, updatedAt: appliedAt })),
    [{ id: "x".repeat(201), updatedAt: appliedAt }],
    [{ id: "valid", updatedAt: "2026-07-20T11:01:00Z" }],
    [{ id: "valid", updatedAt: "not-a-date" }],
    [{ id: "valid", updatedAt: appliedAt, extra: true }],
  ]) {
    const before = readFileSync(storePath, "utf8");
    const invalid = await upsertCanvasArtifact(
      art("resolution-modified", "<main>must not write</main>", {
        updatedAt: "2026-07-20T13:00:00.000Z",
        annotations: [],
      }),
      { expectedUpdatedAt: contentRevision, resolvedAnnotations },
    );
    assert.equal(invalid.status, "invalid", "malformed resolution tokens are rejected");
    assert.equal(readFileSync(storePath, "utf8"), before, "malformed resolution tokens write nothing");
  }

  const beforeUnguardedTokens = readFileSync(storePath, "utf8");
  const unguardedTokens = await upsertCanvasArtifact(
    art("resolution-modified", "<main>must not write</main>"),
    { resolvedAnnotations: [] },
  );
  assert.equal(unguardedTokens.status, "invalid", "resolution tokens require a guarded content revision");
  assert.equal(readFileSync(storePath, "utf8"), beforeUnguardedTokens, "unguarded resolution tokens write nothing");
}

// ═══════════════════════════════════════════════════════════════════════════
// Corrupt-store protection (cave-byr5). loadCanvas once read ANY failure as
// an empty store — written when the file held only cosmetic positions. The
// file now holds user sketches with no undo: reading a torn file as empty
// meant the NEXT save destroyed every sketch. A provably-bad file must be
// moved aside (bytes preserved) instead.
// ═══════════════════════════════════════════════════════════════════════════

{
  const storePath = path.join(tmpHome, "canvas.json");
  const corruptFiles = () => readdirSync(tmpHome).filter((f) => f.startsWith("canvas.json.corrupt-"));

  // Torn JSON: moved aside, bytes preserved, store reads empty.
  writeFileSync(storePath, "{{{ not json");
  const afterCorrupt = await loadCanvas();
  assert.equal(afterCorrupt.artifacts.length, 0, "a corrupt store reads as empty");
  assert.equal(corruptFiles().length, 1, "the corrupt file is moved aside, not deleted");
  assert.equal(
    readFileSync(path.join(tmpHome, corruptFiles()[0]), "utf8"),
    "{{{ not json",
    "the original bytes survive for recovery",
  );

  // A save after the corruption starts a fresh store and leaves the preserved
  // file alone — this exact sequence used to destroy every sketch.
  const saved = await upsertCanvasArtifact(art("art-after-corrupt", "<!doctype html>x"));
  assert.equal(saved.file.artifacts.length, 1, "saving after corruption starts a fresh store");
  assert.equal(corruptFiles().length, 1, "the preserved corrupt file is untouched by the save");

  // Valid-JSON-wrong-shape (an array) is just as unreadable — same treatment.
  writeFileSync(storePath, "[1,2,3]");
  await loadCanvas();
  assert.equal(corruptFiles().length, 2, "shape-invalid JSON is also preserved aside");

  // ENOENT is a genuine fresh start: no corrupt file is minted.
  rmSync(storePath, { force: true });
  const fresh = await loadCanvas();
  assert.equal(fresh.artifacts.length, 0, "a missing file is an empty fresh start");
  assert.equal(corruptFiles().length, 2, "a missing file mints no corrupt-aside");
}

rmSync(tmpHome, { recursive: true, force: true });

// ── Wiring pins ──────────────────────────────────────────────────────────────

const routeSource = readFileSync(new URL("../app/api/canvas/route.ts", import.meta.url), "utf8");
assert.match(
  routeSource,
  /artifacts: result\.file\.artifacts,[\s\S]*savedId: result\.savedId/,
  "POST /api/canvas reports the id the save settled under (dedupe may land on the incumbent)",
);
assert.match(
  routeSource,
  /upsertCanvasArtifact\(body\.artifact,[\s\S]{0,180}?expectedUpdatedAt: body\.expectedUpdatedAt/,
  "POST forwards the optional optimistic content revision to the locked store helper",
);
assert.match(routeSource, /result\.status === "not_found"[\s\S]*status: 404/, "preconditioned missing updates return 404");
assert.match(routeSource, /result\.status === "conflict"[\s\S]*status: 409/, "stale content updates return 409");
assert.match(routeSource, /export async function PATCH\(/, "Canvas exposes an incremental annotation mutation route");
assert.match(
  routeSource,
  /mutateCanvasArtifactAnnotation\(body\)/,
  "PATCH delegates validation and locked merging to the Canvas store helper",
);
assert.match(routeSource, /status === "invalid"[\s\S]*status: 400/, "invalid annotation mutations return 400");
assert.match(routeSource, /status === "not_found"[\s\S]*status: 404/, "unknown artifacts return 404");

const addTileSource = readFileSync(new URL("../components/canvas-add-tile.tsx", import.meta.url), "utf8");
assert.match(
  addTileSource,
  /onArtifactsChanged\(\[\.\.\.generation\.artifacts\], generation\.savedId\)/,
  "the add tile adopts the registry's settled server id and artifact list",
);

console.log("cave-canvas upsert dedupe tests ✓");
