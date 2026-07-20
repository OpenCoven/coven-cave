import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSalemSearchContext } from "./command-palette-salem-context.ts";

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
  assert.deepEqual(context.matches.slice(0, 2), [
    { type: "familiar", title: "Nova", detail: "Research" },
    { type: "chat", title: "Investigate", detail: "Nova · codex" },
  ]);
});
