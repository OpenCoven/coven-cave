// @ts-nocheck
import assert from "node:assert/strict";
import { matchPath } from "./pathfinder-match.ts";

// Each canonical intent maps to its path with high confidence (home mode covers all five).
const CANON = [
  ["i want a familiar on my machine", "first-familiar-cave"],
  ["i want a desktop ai coding workspace", "castcodes-workspace"],
  ["i want a terminal agent", "coven-code-terminal"],
  ["i want to understand or build the runtime", "coven-runtime-builder"],
  ["i want to define a familiar properly", "familiar-contract-spec"],
];
for (const [msg, id] of CANON) {
  const r = matchPath({ mode: "home", userMessage: msg });
  assert.equal(r.pathId, id, `"${msg}" → ${id} (got ${r.pathId})`);
  assert.equal(r.confidence, "high", `"${msg}" is a high-confidence match`);
}

// Vague input → low confidence + at most one clarifying assumption, still a safe pathId.
{
  const r = matchPath({ mode: "home", userMessage: "help" });
  assert.equal(r.confidence, "low", "vague input is low confidence");
  assert.ok(r.assumptions.length <= 1, "low-confidence yields at most one clarifying assumption");
  assert.ok(typeof r.pathId === "string" && r.pathId.length > 0, "still returns a safe default path");
}

// Setup mode excludes home-only paths: a CastCodes-flavored request in setup mode
// must NOT return the home-only castcodes path.
{
  const r = matchPath({ mode: "setup", userMessage: "i want a desktop ai coding workspace" });
  assert.notEqual(r.pathId, "castcodes-workspace", "setup mode excludes the home-only CastCodes path");
  assert.ok(["first-familiar-cave", "familiar-contract-spec"].includes(r.pathId), "setup falls back to a setup-eligible path");
}

// machineState influences assumptions (CLI missing → an install assumption surfaces).
{
  const r = matchPath({
    mode: "setup",
    userMessage: "i want a familiar on my machine",
    machineState: { covenCli: "missing", platform: "macos" },
  });
  assert.equal(r.pathId, "first-familiar-cave", "still matches the first-familiar path");
  assert.ok(r.assumptions.some((a) => /install|cli/i.test(a)), "surfaces a CLI-install assumption");
}

console.log("pathfinder-match.test.ts OK");
