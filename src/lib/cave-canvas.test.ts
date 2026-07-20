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

const { sanitizePositions, upsertCanvasArtifact, deleteCanvasArtifact, loadCanvas } = await import(
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
  /artifacts: file\.artifacts, savedId/,
  "POST /api/canvas reports the id the save settled under (dedupe may land on the incumbent)",
);

const addTileSource = readFileSync(new URL("../components/canvas-add-tile.tsx", import.meta.url), "utf8");
assert.match(
  addTileSource,
  /onArtifactsChanged\(data\.artifacts \?\? \[\], savedId\)/,
  "the add tile highlights the settled tile, not the client-minted id a dedupe discarded",
);

console.log("cave-canvas upsert dedupe tests ✓");
