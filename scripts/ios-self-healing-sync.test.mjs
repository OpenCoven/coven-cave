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
  /pathUpdateHandler = \{[\s\S]*?path\.status == \.satisfied[\s\S]*?updateConnectionPath\(available: pathAvailable\)/,
  "network-path changes should feed the shared connection supervisor",
);
assert.match(
  app,
  /\.task \{[\s\S]*?app\.startConnectionSupervisor\(\)[\s\S]*?app\.setConnectionSupervisorActive\(true\)/,
  "app launch should start and activate the connection supervisor",
);

// --- Reconnect convergence: keep stale UI, then refresh any surface the user opened
assert.match(model, /func recoverConnectionInBackground\(\) async/, "AppModel should expose background recovery");
assert.match(
  model,
  /func recoverConnectionInBackground[\s\S]*?await refreshConnection\(reloadLoadedSurfaces: true, quiet: true\)/,
  "background recovery should reload opened surfaces quietly (no .checking blink → no pill flash on healthy path changes)",
);
// Refresh became concurrent: one coherent core-resource reload (project
// context + familiars + theme + profile) runs beside the remaining already-open
// surfaces, and reconnect mirrors a failed cached project-context refresh back
// to the relevant stale-data banners instead of issuing a duplicate load.
assert.match(
  model,
  /private func refreshLoadedSurfaces\(configurationGeneration: UInt64\) async \{[\s\S]*?connectionConfigurationLeaseIsCurrent\(configurationGeneration\)[\s\S]*?let mirroredProjectContextFailures = loadedProjectContextFailureSurfaces[\s\S]*?withTaskGroup[\s\S]*?group\.addTask \{[\s\S]*?await self\.loadCoreResources\([\s\S]*?mirroringProjectContextFailuresTo: mirroredProjectContextFailures,[\s\S]*?configurationGeneration: configurationGeneration[\s\S]*?\)[\s\S]*?\}[\s\S]*?if sessionsLoaded \{ group\.addTask \{ await self\.loadSessions\(\) \} \}[\s\S]*?if tasksLoaded \{ group\.addTask \{ await self\.loadTasks\(\) \} \}[\s\S]*?if remindersLoaded \{ group\.addTask \{ await self\.loadReminders\(\) \} \}/,
  "reconnect should refresh remaining loaded surfaces while mirroring cached project-context failures once",
);
assert.match(
  model,
  /private var loadedProjectContextFailureSurfaces: ProjectContextFailureSurfaces \{[\s\S]*?if projectsLoaded \{[\s\S]*?surfaces\.insert\(\.projects\)[\s\S]*?if familiarsLoaded \{[\s\S]*?surfaces\.insert\(\.familiars\)/,
  "cached project-context failure mirroring should follow loaded-surface flags, not non-empty arrays",
);
assert.doesNotMatch(
  model,
  /private func refreshLoadedSurfaces\(configurationGeneration: UInt64\) async \{[\s\S]*?group\.addTask \{ await self\.loadProjects\(\) \}/,
  "reconnect should not duplicate the project-context refresh with a second projects request",
);
assert.match(
  model,
  /struct ProjectContextFailureSurfaces: OptionSet[\s\S]*?static let projects = Self\(rawValue: 1 << 0\)[\s\S]*?static let familiars = Self\(rawValue: 1 << 1\)/,
  "project-context failures should be mirrorable to both projects and familiars surfaces",
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
  /private func resetHostScopedStateForNewConnection\(\) \{[\s\S]*?familiars = \[\][\s\S]*?sessionsLoaded = false[\s\S]*?tasksLoaded = false[\s\S]*?remindersLoaded = false[\s\S]*?projectsLoaded = false/,
  "new-host reset should drop loaded-surface flags so .checking shows the connection flow instead of stale data",
);
assert.match(
  model,
  /private func resetHostScopedStateForNewConnection\(\) \{[\s\S]*?familiarsError = nil[\s\S]*?familiarsLoaded = false/,
  "new-host reset should clear familiar loaded state alongside the roster",
);
assert.match(
  model,
  /func loadProjectContext\([\s\S]*?familiarsError = nil[\s\S]*?familiarsLoaded = true/,
  "successful project-context loads should mark familiars as loaded even when the roster is empty",
);
assert.match(
  model,
  /func loadFamiliars\(\) async \{[\s\S]*?await loadProjectContext\(using: client, mirrorFailuresTo: \[\.familiars\]\)/,
  "direct familiar refresh should mirror project-context failures to the familiar surface",
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
  /data\(for: request\)/,
  "developer API requests should inherit the core client's connectivity wait and retry policy",
);
assert.doesNotMatch(
  devClient,
  /URLSessionConfiguration|URLSession\(/,
  "developer API requests should not bypass the resilient client with a private session",
);
assert.match(
  client,
  /func data\([\s\S]{0,120}?for req: URLRequest,[\s\S]{0,120}?retryingIdempotentMutation: Bool = false[\s\S]{0,80}?\) async throws -> \(Data, URLResponse\)/,
  "CaveClient should centralize resilient request data loading with explicit mutation retry opt-in",
);
assert.match(
  client,
  /for attempt in 0\.\.\.retryDelays\.count[\s\S]*?session\.data\(for: req\)[\s\S]*?Task\.sleep/,
  "resilient data loading should retry transient failures with bounded backoff",
);
assert.match(
  client,
  /defaultIdempotentMutationRetryBudget: Duration = \.seconds\(20\)/,
  "mutation retries should remain inside the existing 20-second request budget",
);
assert.match(
  client,
  /withThrowingTaskGroup\(of: RequestResult\.self\)[\s\S]*?Task\.sleep\(for: budget\)[\s\S]*?group\.cancelAll\(\)/,
  "the mutation budget should cancel the active URLSession operation at its wall-clock deadline",
);

console.log("ios-self-healing-sync: OK");
