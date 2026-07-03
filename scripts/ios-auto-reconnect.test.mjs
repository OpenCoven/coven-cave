import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The app should recover from a slow/blipping desktop on its own: retry the
// connection with backoff on launch (instead of dumping straight to the setup
// screen), and re-probe when it returns to the foreground after being offline.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const app = await read("apps/ios/CovenCave/CovenCave/CovenCaveApp.swift");

// --- AppModel.connectWithRetry: bounded backoff, holds .checking between tries -
assert.match(
  model,
  /func connectWithRetry\(\) async \{/,
  "AppModel should expose connectWithRetry()",
);
assert.match(
  model,
  /func connectWithRetry[\s\S]*?let backoffSeconds: \[UInt64\] = \[1, 2, 4\]/,
  "connectWithRetry should use a bounded backoff schedule",
);
assert.match(
  model,
  /func connectWithRetry[\s\S]*?while connectionState != \.connected[\s\S]*?connectionState = \.checking[\s\S]*?Task\.sleep[\s\S]*?await refreshConnection\(reloadLoadedSurfaces: shouldReloadLoadedSurfaces\)/,
  "connectWithRetry should retry refreshConnection while held at .checking (no unreachable flash)",
);
assert.match(
  model,
  /func connectWithRetry[\s\S]*?if Task\.isCancelled \{ return \}/,
  "connectWithRetry should bail out if the task is cancelled mid-wait",
);

// --- CovenCaveApp: launch uses the retry, and foreground re-probes when offline -
assert.match(
  app,
  /@Environment\(\\\.scenePhase\) private var scenePhase/,
  "the app should observe scenePhase",
);
assert.match(
  app,
  /\.task \{[\s\S]*?await app\.connectWithRetry\(\)/,
  "launch should connect with retry (not a single probe)",
);
assert.match(
  app,
  /\.onChange\(of: scenePhase\) \{[\s\S]*?phase == \.active[\s\S]*?connectionState != \.connected[\s\S]*?connectionState != \.checking[\s\S]*?connectWithRetry\(\)/,
  "returning to the foreground while offline should re-probe the connection",
);

console.log("ios-auto-reconnect: OK");
