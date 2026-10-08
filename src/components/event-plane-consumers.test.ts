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
// Phase 4b (#5858): the board poll and focus refresh pause only while the
// board topic is ready in primary mode. Mount load and !interacting stay.
assert.match(board, /const boardEvents = useCaveEventPlane\("board",/, "the gate reads the subscription's own health");
assert.match(
  board,
  /const boardEventPrimary = boardEvents\.rolloutMode === "primary" && boardEvents\.ready;/,
  "covered only when ready in primary mode",
);
assert.match(board, /useRefreshOnFocus\(\(\) => load\(\{ force: true \}\), \{ enabled: !boardEventPrimary \}\);/);
assert.match(
  board,
  /usePausablePoll\(\s*\(\) => \{ void load\(\{ quiet: true, force: true \}\); \},\s*15_000,\s*\{\s*enabled: !interacting,\s*pauseWhileInputActive: true,\s*intervalEnabled: !boardEventPrimary,[\s\S]*?onIntervalPaused: noteCaveEventPollAvoided,\s*\},\s*\);/,
  "the interval pauses while covered, the interaction gate is kept, and skipped ticks are counted (#5862)",
);
assert.doesNotMatch(workspace, /intervalEnabled/, "sessions and daemon polling stay authoritative (Val, 2026-10-08)");
console.log("event-plane-consumers.test.ts: ok");
