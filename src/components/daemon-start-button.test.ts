// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const settingsShell = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const settingsDaemon = await readFile(new URL("./settings-daemon.tsx", import.meta.url), "utf8");
const settings = `${settingsShell}\n${settingsDaemon}`;
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(settings, /fetch\("\/api\/daemon\/start", \{ method: "POST" \}\)/);
assert.match(settings, /Start daemon/);
assert.match(settings, /Restart daemon/);
assert.match(settings, /rocket-launch-bold/);
assert.match(
  settings,
  /const canStartDaemon =[\s\S]*?status\?\.availability === undefined \|\| status\.availability === "offline"/,
  "daemon settings should offer Start only for explicit offline or legacy status",
);
assert.match(settings, /\{canStartDaemon && \(/);
assert.match(settings, /status\?\.running && \(/);
assert.match(
  settings,
  /fetch\("\/api\/daemon\/start", \{[\s\S]*method: "POST"[\s\S]*JSON\.stringify\(\{ restart: true \}\)/,
  "daemon settings should post an explicit restart request when restarting",
);

assert.match(
  workspace,
  /const refreshDaemonStatus = useCallback\([\s\S]*daemonConnectionSupervisorRef\.current\?\.refresh\(\{ fresh: opts\?\.fresh === true \|\| opts\?\.trusted === true \}\)/,
  "Workspace should expose daemon connection refresh through the shared supervisor",
);

assert.match(
  workspace,
  /const startDaemon = useCallback\(async \(\{ automatic = false \}: \{ automatic\?: boolean \} = \{\}\) => \{[\s\S]*daemonRecoveryPresentation\(current,[\s\S]*await waitForDaemonUpdateIdle\(\)[\s\S]*runWorkspaceDaemonStart\(\{[\s\S]*automatic,[\s\S]*fetchImpl: fetch[\s\S]*refreshStatus: refreshDaemonStatus/,
  "Workspace automatic and manual starts should share one flow with explicit intent",
);

const chat = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
for (const id of ["daemon-offline", "daemon-start-error"]) {
  const banner = workspace.slice(workspace.indexOf(`id: "${id}"`));
  assert.match(banner.slice(0, 650), /label: "Open setup",\s*onClick: openDaemonSetup/,
    `${id} offers guided recovery instead of a dead end`);
}
assert.match(workspace, /const openDaemonSetup = useCallback\(\(\) => \{\s*onboardingOriginRef.current = "banner";\s*setOnboardingOpen\(true\)/,
  "recovery opens the mounted setup dialog without navigating away from chat");
const metaRecovery = chat.slice(chat.indexOf("function MetaLineStartDaemon"), chat.indexOf("function MetaLineElapsed"));
assert.match(metaRecovery, /useSetupOpener\("banner"\)/);
assert.match(metaRecovery, /onClick=\{openSetup\}/);
assert.match(metaRecovery, /\{setupHost\}/, "chat recovery works even without a Workspace host");
assert.doesNotMatch(metaRecovery, /fetch\(/, "chat must not silently discard a failed start response");
