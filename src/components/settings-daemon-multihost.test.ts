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
  /fetch\("\/api\/config", \{ cache: "no-store" \}\)/,
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
  sections,
  /daemon: \["Runtime health", "Local\/hub routing", "Socket & version"\]/,
  "Daemon settings overview should advertise local/hub routing",
);

assert.match(
  sections,
  /keywords: "daemon status running start stop restart hub server executor private network tailscale"/,
  "Settings search should route hub/server/executor queries to the Daemon section",
);

console.log("settings-daemon-multihost.test.ts: ok");
