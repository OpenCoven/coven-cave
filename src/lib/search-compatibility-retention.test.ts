// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCompatibilityProvider } from "./search-indexed-providers.ts";
import { runSearch } from "./search-coordinator.ts";
import { parseSearchQuery } from "./search-query.ts";

// Unit 7: the compatibility providers retire ONLY once permanent adapters
// cover their corpora. No permanent adapter exists yet for commands,
// destinations, settings, or memories — so the compatibility rows must
// still answer searches, and the client surface must still serve them.
// These pins flip when a permanent adapter lands, which is exactly when
// retirement becomes due.

const ROWS = [
  { id: "/help", kind: "command", title: "/help", body: "show help for the chat" },
  { id: "chat", kind: "destination", title: "Chat", body: "open the chat surface" },
  { id: "appearance", kind: "setting", title: "Appearance", body: "theme, typography, reading controls" },
  { id: "m1", kind: "memory", title: "Memory entry", body: "a canonical memory row" },
];

const provider = createCompatibilityProvider({ loadRows: async () => ROWS });
const context = { allowedProjectIds: null, allowedProjectRoots: null, familiarId: null };
const readIndexed = async (p, query, limit) => {
  const fingerprint = await p.fingerprint();
  const docs = await p.collect(context);
  const typeFilter = query.filters.find((f) => f.key === "type");
  const rows = docs
    .filter((d) => !typeFilter || String(typeFilter.value) === d.entityType)
    .filter((d) => !query.text || d.title.toLowerCase().includes(query.text.toLowerCase()) || d.body.toLowerCase().includes(query.text.toLowerCase()))
    .slice(0, limit)
    .map((d) => ({ document: d, relevance: 1, providerId: "compatibility" }));
  return { rows, stale: false };
};

// Every compatibility corpus is still searchable through the coordinator.
// These corpora are not in the type: enum (they were never first-class
// entity types) — the palette finds them by free text, and so does the
// coordinator path.
const searches = [
  { query: "help", expect: "command" },
  { query: "chat surface", expect: "destination" },
  { query: "appearance", expect: "setting" },
  { query: "canonical memory", expect: "memory" },
];
for (const probe of searches) {
  const outcome = await runSearch(
    { query: parseSearchQuery(probe.query, { scopes: [], naturalLanguage: false }).state, context, now: 0 },
    { providers: [provider], readIndexed },
  );
  assert.ok(
    outcome.results.some((r) => r.document.entityType === probe.expect),
    "free text finds the " + probe.expect + " corpus (" + probe.query + ")",
  );
}

// Free text still finds compatibility rows (the palette experience).
const textOutcome = await runSearch({ query: parseSearchQuery("help", { scopes: [], naturalLanguage: false }).state, context, now: 0 }, { providers: [provider], readIndexed });
assert.ok(textOutcome.results.some((r) => r.document.id === "command:/help"), "free text still finds commands");

// The provider still emits every compatibility entity type — retirement is
// not due because no permanent adapter covers these corpora yet.
const indexedSource = readFileSync(new URL("./search-indexed-providers.ts", import.meta.url), "utf8");
assert.match(
  indexedSource,
  /kind: "command" | "destination" | "setting" | "memory"/,
  "the compatibility row kinds are still declared",
);
assert.match(
  indexedSource,
  /entityType: row\.kind/,
  "the compatibility provider still maps rows to entity types",
);
assert.match(
  indexedSource,
  /createCompatibilityProvider/,
  "the compatibility provider is still wired",
);

// The client palette still serves these corpora directly (relocation,
// not removal).
const paletteSource = readFileSync(new URL("../components/command-palette.tsx", import.meta.url), "utf8");
assert.match(paletteSource, /SETTINGS_INDEX/, "settings search stays reachable from the palette");
assert.match(paletteSource, /SLASH_COMMANDS/, "commands stay reachable from the palette");
assert.match(paletteSource, /paletteDestinations\(\)/, "destinations stay reachable from the palette");

console.log("search-compatibility-retention.test.ts: ok");
