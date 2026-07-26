// @ts-nocheck
//
// Guard: chat-router fallback-familiar selection must skip archived familiars.
//
// `fallbackFamiliar` and `fallbackFamiliarId` are consulted whenever the user
// arrives at chat without a specific familiar selected (e.g. the "Start a new
// chat" flow, switching from another mode, or after deleting the active
// familiar). Defaulting to `familiars[0]` regardless of archive state means
// the user can be silently dropped into a session against an archived agent.
//
// Same source-string pattern as chat-router-switching.test.ts — keeps the
// guard light and matches the existing convention.
//
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");

// 1. Imports the archive hook.
assert.match(
  source,
  /useArchivedFamiliars/,
  "chat-router should import useArchivedFamiliars to know which familiars are archived",
);

assert.match(
  source,
  /from\s+["']@\/lib\/cave-familiar-archive["']/,
  "chat-router should import the archive hook from cave-familiar-archive",
);

// 2. Uses the hook in the component body.
assert.match(
  source,
  /const\s+archivedFamiliars\s*=\s*useArchivedFamiliars\(\)/,
  "chat-router should call useArchivedFamiliars() to read the archive map",
);

// 3. Builds a non-archived list of familiars.
assert.match(
  source,
  /const\s+visibleFamiliars\s*=/,
  "chat-router should derive a visibleFamiliars list (non-archived)",
);

// 4. fallbackFamiliar no longer defaults to raw familiars[0] (which could be archived).
assert.doesNotMatch(
  source,
  /const\s+fallbackFamiliar\s*=\s*familiars\[0\]/,
  "chat-router should not default fallbackFamiliar to familiars[0] (could be archived)",
);

assert.match(
  source,
  /const\s+fallbackFamiliar\s*=\s*visibleFamiliars\[0\]/,
  "chat-router should default fallbackFamiliar to the first non-archived familiar",
);

// 5. fallbackFamiliarId same story.
assert.doesNotMatch(
  source,
  /fallbackFamiliarId\s*=\s*familiar\?\.id\s*\?\?\s*familiars\[0\]\?\.id/,
  "chat-router should not derive fallbackFamiliarId from raw familiars[0] (could be archived)",
);

assert.match(
  source,
  /fallbackFamiliarId\s*=\s*familiar\?\.id\s*\?\?\s*visibleFamiliars\[0\]\?\.id/,
  "chat-router should derive fallbackFamiliarId from the first non-archived familiar",
);

console.log("chat-router-hide-archived.test.ts: ok");
