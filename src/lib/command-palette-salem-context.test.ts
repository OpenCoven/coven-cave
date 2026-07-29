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
    {
      kind: "coven-memory" as const,
      entry: {
        id: "018f0f77-2f49-7c18-9e52-437b312f8a60",
        title: "Verified finding",
        familiarId: "nova",
        excerpt: "A safe summary",
        source: { kind: "canonical", label: "Familiar memory" },
        verification: { state: "verified" as const },
        relativeUpdatedAt: "today",
      },
      familiar: { display_name: "Nova" },
    },
    ...Array.from({ length: 8 }, (_, index) => ({ kind: "fs-memory" as const, entry: { relPath: `note-${index}`, rootLabel: "Vault" } })),
  ];
  const context = buildSalemSearchContext(rows, "investigate");
  assert.equal(context.source, "top-search");
  assert.equal(context.query, "investigate");
  assert.equal(context.matches.length, 8);
  assert.deepEqual(context.matches.slice(0, 3), [
    { type: "familiar", title: "Nova", detail: "Research" },
    { type: "chat", title: "Investigate", detail: "Nova · codex" },
    {
      type: "memory",
      title: "Verified finding",
      detail: "Nova · Familiar memory · verified",
    },
  ]);
});

test("canonical summaries enter Salem context only through approved safe fields", () => {
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
    true,
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
