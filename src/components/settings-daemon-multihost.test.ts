// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const shellEntry = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const daemonUrl = new URL("./settings-daemon.tsx", import.meta.url);
const daemon = existsSync(daemonUrl) ? readFileSync(daemonUrl, "utf8") : "";
const shell = `${shellEntry}\n${daemon}`;
const phone = readFileSync(new URL("./settings-phone.tsx", import.meta.url), "utf8");
const sections = readFileSync(new URL("./settings-sections.ts", import.meta.url), "utf8");
const daemonCssUrl = new URL("../styles/settings-daemon.css", import.meta.url);
const daemonCss = existsSync(daemonCssUrl) ? readFileSync(daemonCssUrl, "utf8") : "";

// ── Claude Design daemon control sheet ───────────────────────────────────────
assert.match(
  shellEntry,
  /import \{ DaemonSection \} from "\.\/settings-daemon"/,
  "SettingsShell should delegate the daemon control sheet to a focused component",
);
assert.match(
  daemon,
  /export function DaemonSection/,
  "the focused daemon module should export the Settings section",
);
assert.match(daemon, /className="settings-daemon"/, "the daemon page should own a responsive control-sheet container");
assert.match(daemon, /className="settings-daemon-hero"/, "the daemon page should open with the approved compact hero");
assert.match(daemon, /Settings · Daemon/, "the hero should carry the approved settings kicker");
assert.match(daemon, /className="settings-daemon-chip-list"/, "the hero should summarize target, API, queue, and uptime");
assert.match(daemon, />\s*Refresh\s*</, "the hero should expose an explicit status refresh");
assert.match(daemon, /Restart daemon/, "the hero should expose the daemon restart action");
assert.match(daemon, /Start daemon/, "the hero should make an offline local daemon actionable");

assert.match(daemon, /className="settings-daemon-status-card"/, "daemon state should render as the approved status card");
assert.match(daemon, /className="settings-daemon-status-strip"/, "the primary daemon state should lead the status card");
assert.match(daemon, /className="settings-daemon-status-grid"/, "the six daemon metrics should share a dense grid");
for (const label of [
  "AUTHORITY",
  "PENDING QUEUE",
  "LOCAL BIND",
  "STALE CACHE",
  "WAKE LOCAL",
  "HANDOFF",
]) {
  assert.match(daemon, new RegExp(`label: "${label}"`), `the status grid should include ${label}`);
}
assert.match(daemon, />HOME</, "travel state should expose the approved HOME segment");
assert.match(daemon, />AWAY</, "travel state should expose the approved AWAY segment");
assert.match(daemon, /Manual offline/, "travel state should preserve the real manual-offline action");
assert.match(daemon, /Back online/, "manual-offline state should expose the matching recovery action");

assert.match(daemon, /className="settings-daemon-target-grid"/, "runtime targets should render as selectable cards");
assert.match(daemon, /aria-pressed=\{mode === target\.id\}/, "runtime target cards should expose selection programmatically");
assert.match(daemon, /<TextInput[\s\S]*aria-label="Server hub URL"/, "the hub field should reuse the shared text-input primitive");
assert.match(daemon, /<TextArea[\s\S]*aria-label="Executor addresses, one per line"/, "executor addresses should reuse the shared textarea primitive");
assert.match(daemon, /aria-expanded=\{executorsOpen\}/, "executor addresses should use progressive disclosure");
assert.match(daemon, /optional · multi-machine setups/, "executor disclosure should explain its advanced scope");
assert.match(daemon, /const connectionDirty =/, "connection changes should remain drafts until explicitly saved");
assert.match(
  daemon,
  /const normalizedHubUrl = hubUrl\.trim\(\)/,
  "saving a connection should normalize surrounding whitespace from the hub URL",
);
assert.match(
  daemon,
  /body: JSON\.stringify\(\{ multiHost: \{ mode: nextMode, hubUrl: normalizedHubUrl, executorUrls: normalizedExecutorUrls \} \}\)/,
  "the normalized hub URL and executor list should be the values persisted to config",
);
assert.match(daemon, />\s*Revert\s*</, "connection drafts should be reversible");
assert.match(daemon, />\s*Save connection\s*</, "connection drafts should have one explicit save action");

assert.match(daemon, /className="settings-daemon-info"/, "daemon metadata should use the compact approved info table");
assert.match(daemon, /copyInfoValue/, "copyable daemon paths should share one announced copy path");
assert.match(shell, /omnigentSettings=\{<OmnigentSettingsGroup \/>\}/, "the Vault-gated Omnigent settings must remain reachable from Daemon");

assert.match(
  daemonCss,
  /@container settings-daemon \(max-width:/,
  "the control sheet should adapt to its pane with a container query",
);
assert.match(
  daemonCss,
  /@media \(prefers-reduced-motion: reduce\)/,
  "daemon-specific motion should have an explicit reduced-motion treatment",
);
assert.doesNotMatch(
  daemonCss,
  /(?:gap|padding|width|height):\s*(?:2|3|6|8|12)px|box-shadow:\s*inset\s+2px/,
  "daemon micro-spacing should use the design-system spacing tokens",
);
assert.doesNotMatch(
  shell,
  /bg-red-400/,
  "daemon error states should use the semantic danger token across every theme",
);

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
  /placeholder="http:\/\/server\.tailnet:8787"/,
  "Hub URL input should make the expected private-network HTTP target concrete",
);

assert.match(shell, /fetch\("\/api\/tailscale\/devices"/, "hub mode should discover tailnet devices");
assert.match(shell, /devicesCtlRef\.current\?\.abort\(\)/, "device discovery refreshes should abort stale requests");
assert.match(shell, /Tailnet devices/, "hub mode should label the discovery picker");
assert.match(shell, /device\.isSelf \? " · This device"/, "the self device should be visibly identified");
assert.match(shell, /http:\/\/\$\{host\}:8787/, "selecting a device should build the standard hub URL");
assert.match(shell, /fetch\("\/api\/daemon\/probe"/, "hub URL saves should probe daemon health first");
assert.match(shell, /Save anyway/, "an unreachable hub should require an explicit override");
assert.match(shell, /Configured but unreachable/, "hub status should distinguish configured from connected");
assert.match(phone, /Use this device as hub/, "phone pairing should offer its known tailnet host to Server Hub");
assert.match(
  daemon,
  /import \{ classifyTailscaleFailureKind \} from "@\/lib\/tailscale-failure"/,
  "device discovery should use the shared Tailscale failure classifier",
);
assert.match(
  phone,
  /import \{ classifyTailscaleFailureKind \} from "@\/lib\/tailscale-failure"/,
  "phone pairing should use the shared Tailscale failure classifier",
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
const fleetGateHook = readFileSync(
  new URL("../lib/omnigent/use-fleet-gate.ts", import.meta.url),
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
  /setEnabled\(j\.enabled === true\)/,
  "Omnigent group derives the master-switch state from /api/omnigent/status enabled",
);
assert.match(
  shell,
  /JSON\.stringify\(\{ omnigent: \{ enabled: next \} \}\)/,
  "the enable toggle PATCHes exactly omnigent.enabled — nothing else",
);
assert.match(
  shell,
  /if \(!next\) publishFleetTokenStatus\(null\);/,
  "disabling immediately hides Fleet controls that are already mounted",
);
assert.match(
  shell,
  /publishFleetTokenStatus\(st\);/,
  "a successful enable refresh publishes the new gate to mounted Fleet controls",
);
assert.match(
  shell,
  /The config PATCH already succeeded[\s\S]*setStatusLine\("Status unavailable · try again later"\);/,
  "a failed follow-up status refresh does not report the already-persisted toggle as failed",
);
assert.match(
  fleetGateHook,
  /for \(const listener of listeners\) listener\(enabled\);/,
  "published gate changes update every mounted Fleet control instead of leaving the page-load cache stale",
);
assert.match(
  shell,
  /\{enabled \? \(/,
  "connection fields render only after the fleet is explicitly enabled — vault key alone shows just the toggle",
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
  /const enabled = config\.omnigent\.enabled === true;\s*\n\s*if \(!serverUrlInVault \|\| !enabled\) \{/,
  "the status probe short-circuits as unconfigured until BOTH the Vault key and the enable toggle hold — no secret resolution, no network",
);
assert.match(
  statusRoute,
  /resolveOmnigentBaseUrl\(config\.omnigent\.baseUrl\)/,
  "the status probe resolves the base URL Vault-first",
);
// Every fleet entry point refuses while the master switch is off: the three
// omnigent proxies, the /api/hosts fleet options, and createOmnigentRun.
for (const rel of [
  "../app/api/omnigent/hosts/route.ts",
  "../app/api/omnigent/sessions/route.ts",
  "../app/api/omnigent/agents/route.ts",
  "../app/api/hosts/route.ts",
  "../lib/omnigent/run.ts",
]) {
  const src = readFileSync(new URL(rel, import.meta.url), "utf8");
  assert.match(
    src,
    /if \(!isOmnigentFleetActive\(config\.omnigent\)\)/,
    `${rel} must gate on isOmnigentFleetActive (vault URL + explicit enable toggle)`,
  );
}

console.log("settings-daemon-multihost.test.ts: ok");
