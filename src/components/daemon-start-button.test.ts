// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(settings, /fetch\("\/api\/daemon\/start", \{ method: "POST" \}\)/);
assert.match(settings, /Start daemon/);
assert.match(settings, /Restart daemon/);
assert.match(settings, /rocket-launch-bold/);
assert.match(settings, /!loading && !status\?\.running/);
assert.match(settings, /status\?\.running && \(/);
assert.match(
  settings,
  /fetch\("\/api\/daemon\/start", \{[\s\S]*method: "POST"[\s\S]*JSON\.stringify\(\{ restart: true \}\)/,
  "daemon settings should post an explicit restart request when restarting",
);

assert.match(
  workspace,
  /const refreshDaemonStatus = useCallback\([\s\S]*fetch\("\/api\/daemon\/status", \{ cache: "no-store" \}\)/,
  "Workspace should expose daemon status refresh outside the polling effect",
);

assert.match(
  workspace,
  /const startDaemon = useCallback\([\s\S]*await waitForDaemonUpdateIdle\(\)[\s\S]*runWorkspaceDaemonStart\(\{[\s\S]*fetchImpl: fetch[\s\S]*refreshStatus: refreshDaemonStatus/,
  "Workspace automatic and manual starts should share the behaviorally tested start flow",
);

assert.match(
  workspace,
  /cta: \{[\s\S]*label: "Start daemon"[\s\S]*onClick: \(\) => \{[\s\S]*void startDaemon\(\)/,
  "Workspace offline banner should use the shared daemon start handler",
);
