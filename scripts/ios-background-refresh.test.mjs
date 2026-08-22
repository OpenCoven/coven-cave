import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const base = "apps/ios/CovenCave/CovenCave";

const [refresh, info, app, model, root, connect, coordinator] = await Promise.all([
  read(`${base}/State/ConnectionBackgroundRefresh.swift`),
  read(`${base}/Info.plist`),
  read(`${base}/CovenCaveApp.swift`),
  read(`${base}/State/AppModel.swift`),
  read(`${base}/Views/RootView.swift`),
  read(`${base}/Views/ConnectionView.swift`),
  read(`${base}/State/ConnectionRefreshCoordinator.swift`),
]);
const notifications = await read(`${base}/Notifications/ChatNotifications.swift`);

const identifier = "ai.opencoven.cave.connection-refresh";
assert.match(info, new RegExp(`<string>${identifier.replaceAll(".", "\\.")}</string>`));
assert.match(info, /<key>UIBackgroundModes<\/key>\s*<array>\s*<string>fetch<\/string>/);
assert.match(refresh, new RegExp(`static let identifier = "${identifier.replaceAll(".", "\\.")}"`));
assert.match(app, /ConnectionBackgroundRefresh\.shared\.register\(app: app\)/);
assert.match(app, /setConnectionSupervisorActive\(scenePhase == \.active\)/);
assert.match(app, /case \.background:[\s\S]*?setConnectionSupervisorActive\(false\)[\s\S]*?ConnectionBackgroundRefresh\.shared\.schedule\(\)/);
assert.match(app, /case \.active:[\s\S]*?cancelRunningForForeground\(\)[\s\S]*?setConnectionSupervisorActive\(true\)/);

// The successor request lands before the network operation starts; expiration
// cancels work and both completion paths converge on one identity-guarded finish.
assert.ok(refresh.indexOf("schedule()", refresh.indexOf("private func handle")) < refresh.indexOf("operation = Task", refresh.indexOf("private func handle")));
assert.match(refresh, /expirationHandler = \{[\s\S]*?operation\?\.cancel\(\)[\s\S]*?finish\(task, success: false\)/);
assert.match(refresh, /guard activeTask === task else \{ return \}[\s\S]*?setTaskCompleted\(success: success\)/);
assert.match(refresh, /earliestRefreshInterval: TimeInterval = 12 \* 60 \* 60/);

// A background grant is maintenance, never a fifth retry/discovery driver.
const maintenance = model.slice(
  model.indexOf("func performBackgroundConnectionMaintenance"),
  model.indexOf("/// Project context", model.indexOf("func performBackgroundConnectionMaintenance")),
);
assert.match(maintenance, /await client\.ping\(\)/);
assert.match(maintenance, /await refreshAccessTokenIfNeeded \{[\s\S]{0,160}connectionConfigurationLeaseIsCurrent\(configurationGeneration\)/);
assert.match(
  maintenance,
  /await refreshAccessTokenIfNeeded[\s\S]*?guard connectionConfigurationLeaseIsCurrent\(configurationGeneration\) else \{ return false \}[\s\S]*?await ConnectionNotifications\.postReconnected\(\)[\s\S]*?guard connectionConfigurationLeaseIsCurrent\(configurationGeneration\)/,
  "expiration or endpoint replacement must fence both notification and completion after token refresh",
);
const reconnectNotification = notifications.slice(
  notifications.indexOf("enum ConnectionNotifications"),
);
assert.match(
  reconnectNotification,
  /let settings = await center\.notificationSettings\(\)[\s\S]{0,240}guard !Task\.isCancelled, canNotify else \{ return \}[\s\S]{0,500}guard !Task\.isCancelled else \{ return \}[\s\S]{0,100}center\.add\(request\)/,
  "a notification permission await must not outlive the background task that requested it",
);
assert.match(
  maintenance,
  /case \.degraded, \.unreachable:[\s\S]*?shouldNotifyReconnect = true[\s\S]*?default:[\s\S]*?shouldNotifyReconnect = false/,
  "background reconnect notifications should require an actual prior transport failure",
);
assert.doesNotMatch(maintenance, /while |connectWithRetry|refreshConnection|loadCoreResources|flushQueuedMessages/);

// All automatic foreground signals feed one jittered worker. The old view
// tickers and scene-owned retry tasks must stay gone.
assert.match(model, /connectionSupervisorTask: Task<Void, Never>\?/);
assert.match(model, /ConnectionRetryPolicy\.delaySeconds[\s\S]*?Double\.random\(in: 0\.8\.\.\.1\.2\)/);
assert.match(coordinator, /afterFailureCount[\s\S]*?pow\(2,[\s\S]*?min\(base \* boundedJitter, 60\)/);
const rootConnectionShell = root.slice(0, root.indexOf("private struct ConnectedMomentOverlay"));
assert.doesNotMatch(rootConnectionShell, /connectedTicks|maintainConnectionWhileActive|\.task\(id: scenePhase\)/);
assert.doesNotMatch(connect, /case \.unreachable = app\.connectionState else \{ continue \}/);
assert.doesNotMatch(app, /validateConnectionOnForeground|Task \{ await app\.connectWithRetry\(\) \}/);

console.log("ios-background-refresh: OK");
