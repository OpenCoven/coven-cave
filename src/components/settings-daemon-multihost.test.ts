// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const sections = readFileSync(new URL("./settings-sections.ts", import.meta.url), "utf8");

assert.match(
  shell,
  /type MultiHostMode = "local" \| "hub"/,
  "SettingsShell should model local vs server hub mode explicitly",
);

assert.match(
  shell,
  /fetch\("\/api\/config", \{ cache: "no-store", signal: ctl\.signal \}\)/,
  "Daemon settings should load Cave config before rendering connection controls",
);

assert.match(
  shell,
  /body: JSON\.stringify\(\{ multiHost: \{ mode: nextMode, hubUrl, executorUrls: parseExecutorUrls\(executorText\) \} \}\)/,
  "Daemon settings should persist the selected connection mode through cave-config",
);

assert.match(
  shell,
  /placeholder="http:\/\/server\.tailnet:8787"/,
  "Hub URL input should make the expected private-network HTTP target concrete",
);

assert.match(
  shell,
  /placeholder=\{"executor-1\.tailnet:8787\\nexecutor-2\.tailnet:8787"\}/,
  "Executor address control should support multiple private-network executor targets",
);

assert.match(
  shell,
  /status\?\.target\?\.mode === "hub"/,
  "Daemon status UI should distinguish remote hub mode from local daemon mode",
);

assert.match(
  shell,
  /Executor nodes/,
  "Daemon status UI should label configured executor node availability",
);

assert.match(
  shell,
  /status\?\.executors\?\.map/,
  "Daemon status UI should render every executor availability row returned by /api/daemon/status",
);

assert.match(
  shell,
  /Travel mode/,
  "Daemon settings should expose the travel/offline state beside hub status",
);

assert.match(
  shell,
  /status\?\.travel\?\.pendingQueueCount/,
  "Daemon settings should show queued offline work as a visible pending state",
);

assert.match(
  shell,
  /\/api\/travel\/client/,
  "Daemon settings should let the user toggle manual offline mode through the travel-client API",
);

assert.match(
  shell,
  /127\.0\.0\.1/,
  "Travel mode UI should make the localhost-only sub-daemon bind explicit",
);

assert.match(
  sections,
  /daemon: \["Runtime health", "Local\/hub routing", "Socket & version"\]/,
  "Daemon settings overview should advertise local/hub routing",
);

assert.match(
  sections,
  /keywords: "daemon status running start stop restart hub server executor private network tailscale"/,
  "Settings search should route hub/server/executor queries to the Daemon section",
);

// ── Fetch guards (cave-dgac) ─────────────────────────────────────────────────
// Start/Restart/Manual-Offline each trigger a status refresh; without
// cancellation a slow earlier response can land after a newer one and flash a
// stale pre-action status. Once-on-mount loads abort on unmount too.
assert.match(shell, /refreshCtlRef\.current\?\.abort\(\);/, "each daemon-status refresh aborts the in-flight one");
assert.match(shell, /fetch\("\/api\/daemon\/status", \{ cache: "no-store", signal: ctl\.signal \}\)/, "daemon-status fetches carry an abort signal");
assert.match(shell, /fetch\("\/api\/config", \{ cache: "no-store", signal: ctl\.signal \}\)/, "the multi-host config load carries an abort signal");
assert.doesNotMatch(shell, /getItem\("coven-custom-theme"\)/, "the custom-theme key goes through COVEN_CUSTOM_THEME_KEY, never a string literal");

console.log("settings-daemon-multihost.test.ts: ok");
