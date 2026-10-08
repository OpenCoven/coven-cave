import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Phase 4a (#5854): web surfaces subscribe to the event plane through their
// existing refresh owners. Polls are unchanged. In `shadow` mode the client
// manager calls no listener (pinned by cave-event-plane-client.test.ts), so
// shadow adds no event-triggered REST reads.
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const board = readFileSync(new URL("./board-view.tsx", import.meta.url), "utf8");

assert.match(workspace, /useCaveEventPlane\("sessions", \(\) => void loadSessions\(\)\);/, "Workspace subscribes the session list owner");
assert.match(workspace, /useCaveEventPlane\("familiars", \(\) => void loadFamiliars\(\)\);/, "Workspace subscribes the familiar roster owner");
assert.match(
  workspace,
  /useCaveEventPlane\("daemon", \(\) => void daemonConnectionSupervisorRef\.current\?\.refresh\(\{ fresh: true \}\)\);/,
  "Workspace subscribes the daemon supervisor's fresh refresh",
);
assert.doesNotMatch(workspace, /useCaveEventPlane\("runs"/, "runs isn't published (#5843), so nothing subscribes to it");
assert.match(
  workspace,
  /usePausablePoll\(\(\) => loadSessions\(\), sessionsPollIntervalMs\(sessionsFailureStreak\), \{\s*serialize: true,\s*pauseWhileInputActive: true,\s*\}\);/,
  "the sessions poll is unchanged in this phase",
);

assert.match(
  board,
  /useCaveEventPlane\("board", \(\) => \{\s*invalidateSurfaceResources\("board:cards"\);\s*if \(interactingRef\.current\) \{\s*boardEventDirtyRef\.current = true;\s*return;\s*\}\s*void load\(\{ quiet: true, force: true \}\);\s*\}\);/,
  "a board invalidation drops the warm cache, and defers while the user interacts",
);
assert.match(board, /interactingRef\.current = interacting;/, "the ref follows the existing interaction gate, not a second state");
assert.match(
  board,
  /useEffect\(\(\) => \{\s*if \(interacting \|\| !boardEventDirtyRef\.current\) return;\s*boardEventDirtyRef\.current = false;\s*void load\(\{ quiet: true, force: true \}\);\s*\}, \[interacting, load\]\);/,
  "a deferred invalidation reloads exactly once when the interaction ends",
);
assert.match(
  board,
  /usePausablePoll\(\s*\(\) => \{ void load\(\{ quiet: true, force: true \}\); \},\s*15_000,\s*\{ enabled: !interacting, pauseWhileInputActive: true \},\s*\);/,
  "the board poll is unchanged in this phase",
);
console.log("event-plane-consumers.test.ts: ok");
