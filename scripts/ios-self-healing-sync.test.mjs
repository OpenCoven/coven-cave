import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The native app should feel like a modern companion client: transient network
// loss waits/retries instead of immediately failing, reconnects happen on real
// network recovery, and already-open surfaces refresh after the desktop comes
// back without throwing the user back through setup.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const client = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift");
const devClient = await read("apps/ios/CovenCave/CovenCave/Networking/CaveClient+Dev.swift");
const connection = await read("apps/ios/CovenCave/CovenCave/Networking/CaveConnection.swift");
const app = await read("apps/ios/CovenCave/CovenCave/CovenCaveApp.swift");

// --- Network supervision: real connectivity changes trigger a background recover
assert.match(model, /import Network/, "AppModel should watch iOS network reachability");
assert.match(model, /private let connectionMonitor = NWPathMonitor\(\)/, "AppModel should own an NWPathMonitor");
assert.match(model, /func startConnectionSupervisor\(\)/, "AppModel should expose a connection supervisor starter");
assert.match(
  model,
  /pathUpdateHandler = \{[\s\S]*?path\.status == \.satisfied[\s\S]*?recoverConnectionInBackground\(\)/,
  "a satisfied network path should trigger background connection recovery",
);
assert.match(
  app,
  /\.task \{[\s\S]*?app\.startConnectionSupervisor\(\)[\s\S]*?await app\.connectWithRetry\(\)/,
  "app launch should start the connection supervisor before the initial retry",
);

// --- Reconnect convergence: keep stale UI, then refresh any surface the user opened
assert.match(model, /func recoverConnectionInBackground\(\) async/, "AppModel should expose background recovery");
assert.match(
  model,
  /func recoverConnectionInBackground[\s\S]*?await refreshConnection\(reloadLoadedSurfaces: true\)/,
  "background recovery should ask refreshConnection to reload opened surfaces",
);
assert.match(
  model,
  /private func refreshLoadedSurfaces\(\) async \{[\s\S]*?await loadFamiliars\(\)[\s\S]*?if sessionsLoaded \{ await loadSessions\(\) \}[\s\S]*?if tasksLoaded \{ await loadTasks\(\) \}[\s\S]*?if remindersLoaded \{ await loadReminders\(\) \}[\s\S]*?if projectsLoaded \{ await loadProjects\(\) \}[\s\S]*?if journalLoaded \{ await loadJournal\(\) \}[\s\S]*?await loadTheme\(\)/,
  "reconnect should refresh all already-opened surfaces plus familiars/theme",
);
assert.match(
  model,
  /func connectWithRetry[\s\S]*?await refreshConnection\(reloadLoadedSurfaces: shouldReloadLoadedSurfaces\)/,
  "foreground retry should also converge loaded surfaces after a successful reconnect",
);

// --- New host handoff: do not show stale old-host data while probing the new one
assert.match(
  model,
  /func configure\(host: String, token: String\? = nil\) async \{[\s\S]*?let isSameEndpoint[\s\S]*?if !isSameEndpoint \{[\s\S]*?resetHostScopedStateForNewConnection\(\)/,
  "configuring a different host should clear host-scoped data before probing it",
);
assert.match(
  model,
  /private func resetHostScopedStateForNewConnection\(\) \{[\s\S]*?familiars = \[\][\s\S]*?sessionsLoaded = false[\s\S]*?tasksLoaded = false[\s\S]*?remindersLoaded = false[\s\S]*?projectsLoaded = false[\s\S]*?journalLoaded = false/,
  "new-host reset should drop loaded-surface flags so .checking shows the connection flow instead of stale data",
);

// --- Auth failures: expired pairing goes to pairing guidance, not generic offline
assert.match(model, /private func handleSurfaceError\(_ error: Error\) -> String/, "surface loads should share error handling");
assert.match(
  model,
  /handleSurfaceError[\s\S]*?CaveError\.isAuthFailure\(error\)[\s\S]*?connectionState = \.needsAuth\(pairingMessage\(\)\)/,
  "401/403 from an opened surface should route to the pairing-expired state",
);
assert.match(
  connection,
  /static func isAuthFailure\(_ error: Error\) -> Bool/,
  "CaveError should expose an auth-failure classifier",
);

// --- Transport resilience: waits for connectivity and retries transient request failures
assert.match(
  client,
  /config\.waitsForConnectivity = true/,
  "core API requests should wait briefly for connectivity instead of failing instantly",
);
assert.match(
  devClient,
  /config\.waitsForConnectivity = true/,
  "developer API requests should wait briefly for connectivity too",
);
assert.match(client, /func data\(for req: URLRequest\) async throws -> \(Data, URLResponse\)/, "CaveClient should centralize resilient request data loading");
assert.match(
  client,
  /for attempt in 0\.\.\.retryDelays\.count[\s\S]*?session\.data\(for: req\)[\s\S]*?Task\.sleep/,
  "resilient data loading should retry transient failures with bounded backoff",
);

console.log("ios-self-healing-sync: OK");
