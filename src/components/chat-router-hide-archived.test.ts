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

// 5. The new-chat paths now satisfy this guard by a STRONGER route: they do not
// substitute a familiar at all. `fallbackFamiliarId` existed to be the
// archive-aware default for "Start a new chat"; that default is gone, so the
// user cannot be dropped onto an archived familiar there because they are not
// dropped onto ANY familiar — the NewChatLaunch picker asks instead. Not
// dropping the guard, restating it at the strength the code now holds.
assert.doesNotMatch(
  source,
  /fallbackFamiliarId/,
  "the new-chat default is retired entirely — no fallback to be archived or otherwise",
);
assert.match(
  source,
  /const next = familiarId \? selectFamiliarForChat\(familiarId\) : null;/,
  "an unspecified familiar stays unspecified, so no archived familiar can be adopted",
);
assert.match(
  source,
  /const nextFamiliarId = group\?\.defaultFamiliarId \?\? familiar\?\.id \?\? null;/,
  "the project-grouped new chat asks rather than defaulting",
);

// `fallbackFamiliar` (no Id) survives for the OTHER flows that still resolve a
// familiar — resuming a session that recorded none, and boot-compose — so the
// archive-aware derivation asserted in (4) above is still load-bearing there.

console.log("chat-router-hide-archived.test.ts: ok");
