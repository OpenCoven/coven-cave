// Golden-13/15 qualification against the packaged sidecar (#6061, #6066).
//
// The desktop shell runs the bundled Node on src-tauri/resources/server/server.mjs
// with COVEN_CAVE_BUNDLE=1 and a per-launch token (src-tauri/src/sidecar_startup.rs).
// This config starts that same artifact the same way and points the acceptance
// specs at it, on Chromium and on the WebKit engine. It is the packaged server
// and client bundle in a browser engine, not the Tauri window: the shell's
// WKWebView, its IPC bridge and the URL-token handoff are not exercised. The
// harness presents the sidecar token as the x-coven-cave-token header.
// Build first with `bash scripts/sidecar-bundle.sh`, then from the repository root:
//   CI=true COVEN_CAVE_PORT=<free port> GOLDEN_SIDECAR_HOME=<scratch dir> pnpm exec playwright test \
//     --config tests/qualification/playwright.golden-sidecar.config.ts
import { devices } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import base from "../../playwright.config";

const SPEC = /chat-activity-(?:acceptance|legacy-history)\.spec\.ts/;
const root = process.cwd();
const sidecarRoot = path.join(root, "src-tauri", "resources", "server");
const bundledNode = path.join(root, "src-tauri", "resources", "node", "bin", "node");
const sidecarServer = path.join(sidecarRoot, "server.mjs");
for (const required of [bundledNode, sidecarServer]) {
  if (!existsSync(required)) throw new Error(`Missing packaged sidecar artifact: ${required}. Run bash scripts/sidecar-bundle.sh first.`);
}
const home = process.env.GOLDEN_SIDECAR_HOME;
if (!home || !path.isAbsolute(home)) throw new Error("GOLDEN_SIDECAR_HOME must be an absolute scratch directory");
mkdirSync(home, { recursive: true });
const TOKEN = "golden-sidecar-fixture-token";
const server = base.webServer as { url: string; env: Record<string, string> };
const port = new URL(server.url).port;
// The fixture environment keeps every Cave and Coven path inside this run's
// synthetic state. The e2e-only switches are removed so the server runs as the
// shell starts it; the local-peer secret is left for server.mjs to mint.
const { COVEN_CAVE_E2E: _e2e, COVEN_CAVE_LOCAL_PEER_SECRET: _peer, NEXT_PUBLIC_CAVE_ROOMS: _rooms,
  NEXT_PUBLIC_CAVE_CRAFTS: _crafts, NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS: _agentic, ...isolated } = server.env;

export default {
  ...base,
  testDir: path.join(root, "tests"),
  retries: 0,
  // The Tauri webview never installs the PWA service worker
  // (src/components/pwa-register.tsx skips it when __TAURI_INTERNALS__ exists).
  // A plain browser engine would install it against this server, and WebKit
  // then stops applying route fixtures to the controlled page, so it is
  // blocked here to match the shell.
  use: { ...base.use, serviceWorkers: "block" as const, extraHTTPHeaders: { "x-coven-cave-token": TOKEN } },
  projects: [
    { name: "sidecar-chromium", testMatch: SPEC, use: { ...devices["Desktop Chrome"] } },
    { name: "sidecar-webkit", testMatch: SPEC, use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `"${bundledNode}" "${sidecarServer}"`,
    cwd: sidecarRoot,
    url: server.url,
    stdout: "pipe",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...isolated,
      HOME: home,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: port,
      COVEN_CAVE_BUNDLE: "1",
      COVEN_CAVE_AUTH_TOKEN: TOKEN,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
};
