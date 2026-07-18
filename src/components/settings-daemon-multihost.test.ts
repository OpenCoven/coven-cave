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

// ── Omnigent vault-URL gate ──────────────────────────────────────────────────
// The whole "Omnigent fleet" group is invisible in the Daemon tab unless
// OMNIGENT_SERVER_URL is set up in the user's Cave Vault; the Vault value is
// also the active server URL (it wins over Cave config), so the group never
// offers an editable URL nor persists one.
const statusRoute = readFileSync(
  new URL("../app/api/omnigent/status/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  shell,
  /if \(serverUrlInVault !== true\) return null;/,
  "Omnigent group renders nothing unless the status probe proves OMNIGENT_SERVER_URL is in the Vault (fail closed while loading)",
);
assert.match(
  shell,
  /setServerUrlInVault\(j\.serverUrlInVault === true\)/,
  "Omnigent group derives its visibility from /api/omnigent/status serverUrlInVault",
);
assert.match(
  shell,
  /\.catch\(\(\) => \{\s*if \(!ctl\.signal\.aborted\) setServerUrlInVault\(false\);\s*\}\)/,
  "a failed status probe hides the Omnigent group instead of leaving it in limbo",
);
assert.doesNotMatch(
  shell,
  /omnigent: \{[^}]*baseUrl/,
  "the Omnigent save payload must not write baseUrl — the Vault env supplies the server URL",
);
assert.match(
  statusRoute,
  /const serverUrlInVault = isOmnigentServerUrlConfigured\(\);/,
  "/api/omnigent/status must report whether OMNIGENT_SERVER_URL exists in the Vault",
);
assert.match(
  statusRoute,
  /resolveOmnigentBaseUrl\(config\.omnigent\.baseUrl\)/,
  "the status probe resolves the base URL Vault-first",
);

console.log("settings-daemon-multihost.test.ts: ok");
