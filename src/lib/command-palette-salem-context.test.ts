import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSalemSearchContext,
  isSalemContextRow,
} from "./command-palette-salem-context.ts";

test("Salem context preserves local result labels and caps the handoff", () => {
  const rows = [
    { kind: "familiar" as const, familiar: { display_name: "Nova", role: "Research" } },
    { kind: "session" as const, session: { title: "Investigate", familiarId: "nova", harness: "codex" }, familiar: { display_name: "Nova" } },
    ...Array.from({ length: 8 }, (_, index) => ({ kind: "fs-memory" as const, entry: { relPath: `note-${index}`, rootLabel: "Vault" } })),
  ];
  const context = buildSalemSearchContext(rows, "investigate");
  assert.equal(context.source, "top-search");
  assert.equal(context.query, "investigate");
  assert.equal(context.matches.length, 8);
  assert.deepEqual(context.matches.slice(0, 3), [
    { type: "familiar", title: "Nova", detail: "Research" },
    { type: "chat", title: "Investigate", detail: "Nova · codex" },
    { type: "memory-file", title: "note-0", detail: "Vault" },
  ]);
});

// The canonical vault is gone, and with it the `coven-memory` row kind. These
// two cases used to prove that such a row entered Salem's context ONLY through
// an approved safe-field allowlist — the boundary existed because a canonical
// summary could otherwise leak where a memory was stored.
//
// The boundary is now simpler and stricter: the kind is not in the allowlist at
// all, so no shape of it is sendable. Asserted rather than deleted, because a
// retired row kind quietly becoming acceptable again by omission is exactly the
// regression this function exists to prevent.
test("a retired coven-memory row cannot enter Salem context, whatever its shape", () => {
  assert.equal(
    isSalemContextRow({
      kind: "coven-memory",
      entry: {
        id: "018f0f77-2f49-7c18-9e52-437b312f8a60",
        title: "Verified finding",
        familiarId: "nova",
        excerpt: "A safe summary",
        source: { kind: "canonical", label: "Familiar memory" },
        verification: { state: "verified" },
        relativeUpdatedAt: "today",
      },
      familiar: { display_name: "Nova" },
    }),
    false,
    "a well-formed vault row is still refused — the kind itself is retired",
  );
});

test("legacy path-bearing memory rows cannot enter Salem context", () => {
  assert.equal(
    isSalemContextRow({
      kind: "coven-memory",
      entry: {
        title: "Legacy row",
        familiar_id: "nova",
        path: "/private/memory.md",
      },
      familiar: { display_name: "Nova" },
    }),
    false,
  );
});

test("file-memory rows still reach Salem", () => {
  assert.equal(
    isSalemContextRow({
      kind: "fs-memory",
      entry: { relPath: "notes/today.md", rootLabel: "Vault" },
    }),
    true,
  );
});
