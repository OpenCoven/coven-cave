// @ts-nocheck
import assert from "node:assert/strict";
import {
  scopeMemoryFilesToFamiliar,
  visibleMemoryFilesForFamiliar,
} from "./memory-file-scope.ts";

const entry = (id, familiarId) => ({ id, familiarId });

// ── The core guarantee: a chat with one familiar never surfaces another's memory.
{
  const entries = [
    entry("echo-1", "echo"),
    entry("sage-1", "sage"),
    entry("echo-2", "echo"),
    entry("global-1", null),
    entry("nova-1", "nova"),
  ];
  const res = scopeMemoryFilesToFamiliar(entries, "echo");
  const ids = res.visible.map((e) => e.id);
  assert.deepEqual(ids, ["echo-1", "echo-2", "global-1"], "owned first, then shared; foreign dropped");
  assert.ok(!ids.includes("sage-1"), "another familiar's memory is excluded");
  assert.ok(!ids.includes("nova-1"), "another familiar's memory is excluded");
  assert.equal(res.ownedCount, 2);
  assert.equal(res.sharedCount, 1);
  assert.equal(res.hiddenForeignCount, 2, "both foreign entries counted as hidden");
}

// ── Ownership labels are correct.
{
  const res = scopeMemoryFilesToFamiliar(
    [entry("a", "echo"), entry("b", null), entry("c", "sage")],
    "echo",
  );
  assert.deepEqual(
    res.visible.map((e) => [e.id, e.ownership]),
    [["a", "owned"], ["b", "shared"]],
    "owned for the active familiar, shared for ownerless; foreign absent",
  );
}

// ── Ordering: every owned entry precedes every shared entry, input order kept.
{
  const res = scopeMemoryFilesToFamiliar(
    [entry("g1", null), entry("o1", "echo"), entry("g2", null), entry("o2", "echo")],
    "echo",
  );
  assert.deepEqual(res.visible.map((e) => e.id), ["o1", "o2", "g1", "g2"]);
}

// ── No active familiar → no scoping, everything visible as "shared", nothing hidden.
for (const none of [null, undefined, "", "   "]) {
  const res = scopeMemoryFilesToFamiliar([entry("a", "echo"), entry("b", "sage"), entry("c", null)], none);
  assert.equal(res.visible.length, 3, `passthrough when active familiar is ${JSON.stringify(none)}`);
  assert.ok(res.visible.every((e) => e.ownership === "shared"));
  assert.equal(res.hiddenForeignCount, 0, "no boundary to enforce ⇒ nothing hidden");
}

// ── Whitespace + nullish owner ids are normalized (no accidental foreign match).
{
  const res = scopeMemoryFilesToFamiliar(
    [entry("a", " echo "), entry("b", "echo"), entry("c", undefined), entry("d", "")],
    "echo",
  );
  assert.deepEqual(res.visible.map((e) => e.id), ["a", "b", "c", "d"], "trimmed owner matches; empty/undefined owner ⇒ shared");
  assert.equal(res.hiddenForeignCount, 0);
}

// ── The active id is trimmed too, so a padded active familiar still scopes right.
{
  const res = scopeMemoryFilesToFamiliar([entry("a", "echo"), entry("b", "sage")], "  echo ");
  assert.deepEqual(res.visible.map((e) => e.id), ["a"]);
  assert.equal(res.hiddenForeignCount, 1);
}

// ── Empty input is safe.
{
  const res = scopeMemoryFilesToFamiliar([], "echo");
  assert.deepEqual(res.visible, []);
  assert.equal(res.ownedCount, 0);
  assert.equal(res.sharedCount, 0);
  assert.equal(res.hiddenForeignCount, 0);
}

// ── All-foreign input → nothing visible, all hidden (the strongest leak guard).
{
  const res = scopeMemoryFilesToFamiliar([entry("a", "sage"), entry("b", "nova")], "echo");
  assert.deepEqual(res.visible, []);
  assert.equal(res.hiddenForeignCount, 2);
}

// ── The function does not mutate input entries; it returns annotated copies.
{
  const input = [entry("a", "echo")];
  const res = scopeMemoryFilesToFamiliar(input, "echo");
  assert.equal("ownership" in input[0], false, "original entry left untouched");
  assert.equal(res.visible[0].ownership, "owned");
  assert.notEqual(res.visible[0], input[0], "returns a copy");
}

// ── visibleMemoryFilesForFamiliar is the convenience projection of `.visible`.
{
  const entries = [entry("a", "echo"), entry("b", "sage"), entry("c", null)];
  assert.deepEqual(
    visibleMemoryFilesForFamiliar(entries, "echo").map((e) => e.id),
    scopeMemoryFilesToFamiliar(entries, "echo").visible.map((e) => e.id),
  );
}

console.log("memory-file-scope.test.ts passed");
