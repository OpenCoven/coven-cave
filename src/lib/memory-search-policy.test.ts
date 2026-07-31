// @ts-nocheck
import assert from "node:assert/strict";
import {
  canonicalMemoryMatches,
  canonicalSearchFields,
  fileMemoryMatches,
  fileSearchFields,
} from "./memory-search-policy.ts";

const canonicalEntry = {
  id: "mem-1",
  title: "Release ritual",
  excerpt: "Bump eight files before tagging",
  familiarId: "sage",
  source: { kind: "conversation", label: "Chat with Sage" },
  privacy: { classification: "internal" },
  verification: { state: "verified" },
  updatedAt: "2026-07-31T00:00:00Z",
  // Fields a canonical summary may carry but search must NEVER see:
  fullPath: "/Users/someone/.coven/memory/secret-location.md",
  raw: "unredacted body text",
  privateDetail: "do not leak",
};

// ── canonical: the safe-field allowlist is the whole story ──────────────────

assert.deepEqual(
  canonicalSearchFields(canonicalEntry),
  ["Release ritual", "Bump eight files before tagging", "sage", "conversation", "Chat with Sage", "internal", "verified"],
  "canonical search sees exactly the seven safe fields",
);

// The strongest guard: a proxy records every property canonical search READS.
// If a future edit sneaks a path/raw/private field into the policy, this
// fails even if the value happens not to match the query.
{
  const accessed = new Set();
  const record = (target, prefix = "") =>
    new Proxy(target, {
      get(t, key) {
        if (typeof key === "string") accessed.add(`${prefix}${key}`);
        const value = t[key];
        return value && typeof value === "object" ? record(value, `${prefix}${String(key)}.`) : value;
      },
    });
  canonicalMemoryMatches(record(canonicalEntry), "anything");
  const allowed = new Set([
    "title", "excerpt", "familiarId",
    "source", "source.kind", "source.label",
    "privacy", "privacy.classification",
    "verification", "verification.state",
  ]);
  const leaked = [...accessed].filter((key) => !allowed.has(key));
  assert.deepEqual(leaked, [], `canonical search read fields outside the allowlist: ${leaked.join(", ")}`);
}

assert.equal(canonicalMemoryMatches(canonicalEntry, "ritual"), true);
assert.equal(canonicalMemoryMatches(canonicalEntry, "secret-location"), false, "paths are not searchable on canonical entries");
assert.equal(canonicalMemoryMatches(canonicalEntry, "unredacted"), false, "raw bodies are not searchable on canonical entries");
assert.equal(canonicalMemoryMatches(canonicalEntry, ""), true, "empty query matches everything");

// Per-field semantics: a query spanning two adjacent fields must NOT match.
// (The old master-detail matcher joined fields with spaces, so
// "tagging sage" — excerpt end + familiarId — matched with no single field
// justifying it. That drift is retired.)
assert.equal(
  canonicalMemoryMatches(canonicalEntry, "tagging sage"),
  false,
  "queries cannot span field boundaries",
);

// ── files: the unified union keeps every historically-findable entry ────────

const fileEntry = {
  relPath: "memory/notes.md",
  fullPath: "/home/x/.coven/workspaces/familiars/opal/memory/notes.md",
  sourceKind: "coven-origin",
  sourceKindLabel: "Coven workspace files",
  rootLabel: "Opal workspace",
  title: "Standup notes",
  excerpt: "Discussed the release",
  familiarId: "opal",
  harnessId: "openclaw",
  runtimeId: "codex",
  origin: "coven",
  sourceContext: "workspace scan",
};

assert.equal(fileSearchFields(fileEntry).length, 12, "file search unions both views' historical field sets");
// Master-detail historically matched these; the compact view must too now:
assert.equal(fileMemoryMatches(fileEntry, "standup"), true, "title stays searchable");
assert.equal(fileMemoryMatches(fileEntry, "discussed"), true, "excerpt stays searchable");
assert.equal(fileMemoryMatches(fileEntry, "coven-origin"), true, "sourceKind stays searchable");
// The compact view historically matched these; master-detail must too now:
assert.equal(fileMemoryMatches(fileEntry, "openclaw"), true, "harnessId stays searchable");
assert.equal(fileMemoryMatches(fileEntry, "workspace scan"), true, "sourceContext stays searchable");
// Paths are fair game for local files (unlike canonical summaries).
assert.equal(fileMemoryMatches(fileEntry, "familiars/opal"), true, "file paths stay searchable");
// Optional fields absent → no crash, no phantom match.
assert.equal(
  fileMemoryMatches({ ...fileEntry, title: undefined, excerpt: undefined, harnessId: undefined }, "standup"),
  false,
);

console.log("memory-search-policy.test.ts: ok");
