import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Honest reconnect UX (bead cave-y482 part 2): once any surface has loaded,
// a connection drop must NOT tear the tab tree down to the Connect screen.
// The tabs stay mounted (cached data usable, offline compose keeps queueing)
// with a "Reconnecting… · last seen Xm" pill narrating recovery. Full-screen
// Connect is reserved for unconfigured / needsAuth / never-connected.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const root = await read("apps/ios/CovenCave/CovenCave/Views/RootView.swift");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");

// --- RootView: teardown only when there's nothing worth keeping -------------
assert.match(
  root,
  /case \.unconfigured, \.needsAuth:\s*\n[\s\S]*?ConnectionView\(\)/,
  "unconfigured and needsAuth take the full Connect screen — only the user can fix those",
);
assert.match(
  root,
  /case \.unreachable where !app\.hasLoadedSurfaces:\s*\n[\s\S]*?ConnectionView\(\)/,
  "unreachable falls to the Connect screen ONLY before any surface has loaded",
);
assert.match(
  root,
  /case \.checking where app\.connection != nil && !app\.hasLoadedSurfaces:\s*\n\s*ConnectingView\(\)/,
  "the Connecting screen is a cold-launch state, not a reconnect state",
);

// --- The pill: shown over mounted tabs during a drop, tap = retry now --------
assert.match(
  root,
  /private var showsReconnectPill: Bool \{[\s\S]*?guard app\.hasLoadedSurfaces else \{ return false \}[\s\S]*?case \.unreachable, \.checking: return true/,
  "the pill shows for unreachable/checking only once surfaces are loaded",
);
assert.match(
  root,
  /ReconnectPill\(lastSeenAt: app\.lastConnectedAt\) \{\s*\n\s*Task \{ await app\.refreshConnection\(reloadLoadedSurfaces: true, quiet: true\) \}/,
  "tapping the pill fires an immediate quiet probe",
);
assert.match(
  root,
  /struct ReconnectPill: View[\s\S]*?Text\(lastSeenAt, style: \.relative\)/,
  "the pill shows an auto-updating 'last seen' relative clock",
);
assert.match(
  root,
  /struct ReconnectPill: View[\s\S]*?\.glass\(\.elevated, in: Capsule\(\)\)/,
  "the pill uses the shared elevated glass capsule (theme + accessibility aware)",
);
assert.match(
  root,
  /struct ReconnectPill: View[\s\S]*?accessibilityLabel/,
  "the pill announces itself to VoiceOver",
);

// --- While the pill is up, something must actually retry ---------------------
// The Connect screen's own 10s ticker no longer runs for unreachable-with-
// surfaces (that screen isn't mounted), so RootView carries its own quiet
// re-probe, mutually exclusive via the hasLoadedSurfaces guard.
assert.match(
  root,
  /\.task\(id: scenePhase\) \{[\s\S]*?guard app\.hasLoadedSurfaces,\s*\n\s*case \.unreachable = app\.connectionState else \{ continue \}[\s\S]*?await app\.refreshConnection\(reloadLoadedSurfaces: true, quiet: true\)/,
  "RootView quietly re-probes while the pill covers an unreachable desktop",
);

// --- AppModel: honest 'last seen' + shared surfaces gate ---------------------
assert.match(
  model,
  /private\(set\) var lastConnectedAt: Date\?/,
  "AppModel tracks when the desktop was last known reachable",
);
assert.match(
  model,
  /didSet \{\s*\n\s*if oldValue == \.connected, connectionState != \.connected \{\s*\n\s*lastConnectedAt = Date\(\)/,
  "lastConnectedAt is stamped the moment the state LEAVES .connected — the last instant the desktop was seen",
);
assert.match(
  model,
  /var hasLoadedSurfaces: Bool \{\s*\n\s*!familiars\.isEmpty \|\| sessionsLoaded \|\| tasksLoaded \|\| remindersLoaded \|\| projectsLoaded \|\| journalLoaded/,
  "hasLoadedSurfaces is the single gate for 'the tab tree holds real data'",
);

console.log("ios-reconnect-pill: OK");
