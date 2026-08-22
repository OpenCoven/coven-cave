import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Honest reconnect UX (bead cave-y482 part 2): once any surface has loaded,
// a connection drop must NOT tear the tab tree down to the Connect screen.
// The tabs stay mounted (cached data usable, offline compose keeps queueing)
// with a "Reconnecting… · last seen Xm" pill narrating recovery. Full-screen
// Connect is reserved for unconfigured / needsAuth / never-connected; an
// initial project-context bootstrap failure gets its own retryable gate.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const root = await read("apps/ios/CovenCave/CovenCave/Views/RootView.swift");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const gate = await read("apps/ios/CovenCave/CovenCave/Views/ProjectSwitcherView.swift");

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
assert.match(
  root,
  /case \.projectContextRequired where !app\.hasLoadedSurfaces:\s*\n[\s\S]*?ProjectContextGateView\(\)/,
  "a first project-context failure should stay out of MainShell and show a dedicated retry gate",
);
assert.match(
  gate,
  /struct ProjectContextGateView: View[\s\S]*?Button\("Retry"\)/,
  "the project-context gate should keep a visible retry action",
);
assert.match(
  gate,
  /struct ProjectContextGateView: View[\s\S]*?Button\("Settings"\)/,
  "the project-context gate should expose a settings escape hatch",
);
assert.match(
  gate,
  /if app\.hasLoadedSurfaces \{\s*app\.selectedTab = \.settings\s*\} else \{\s*showingSettings = true\s*\}/,
  "a warm gate routes into shell settings, while a cold gate opens modal recovery",
);
assert.match(
  gate,
  /\.sheet\(isPresented: \$showingSettings\) \{\s*SettingsView\(presentedModally: true\)\s*\}/,
  "cold gate recovery opens settings without mounting the primary shell",
);

// --- The pill: shown over mounted tabs during a drop, tap = retry now --------
assert.match(
  root,
  /private var showsReconnectPill: Bool \{[\s\S]*?guard app\.hasLoadedSurfaces else \{ return false \}[\s\S]*?case \.unreachable, \.degraded, \.checking: return true/,
  "the pill shows for unreachable/degraded/checking only once surfaces are loaded",
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

// --- While the pill is up, the shared supervisor owns recovery ---------------
// RootView must remain presentation-only. The one AppModel worker performs the
// quiet, surface-reloading probes for both degraded and unreachable states.
const rootViewType = root.slice(
  root.indexOf("struct RootView: View"),
  root.indexOf("private struct ConnectedMomentOverlay"),
);
assert.doesNotMatch(
  rootViewType,
  /\.task\(id: scenePhase\)/,
  "RootView must not launch a second scene-phase reconnect ticker",
);
assert.match(
  model,
  /func runConnectionSupervisor[\s\S]*?refreshConnection\([\s\S]*?case \.checking, \.degraded, \.unreachable:\s*\n\s*failureCount \+= 1/,
  "the shared supervisor quietly retries every recoverable reconnect-pill state",
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
  /var hasLoadedSurfaces: Bool \{\s*\n\s*familiarsLoaded \|\| sessionsLoaded \|\| tasksLoaded \|\| remindersLoaded \|\| projectsLoaded/,
  "hasLoadedSurfaces should treat successful empty familiar loads as loaded shell state",
);

console.log("ios-reconnect-pill: OK");
