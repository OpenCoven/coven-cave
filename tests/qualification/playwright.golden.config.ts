// Golden-13/15 qualification projects (#6061, #6066). Reuses the repository
// config (server command, fixture environment, timeouts) and replaces the
// project list so the acceptance specs run on Chromium and on the WebKit engine
// against the same production build. Service workers are blocked, as in the
// sidecar config: an installed PWA worker can take over the page and stop
// page.route fixtures from applying. Retries are disabled so a first failure is
// never hidden. Run from the repository root:
//   CI=true COVEN_CAVE_PORT=<free port> pnpm exec playwright test \
//     --config tests/qualification/playwright.golden.config.ts
import { devices } from "@playwright/test";
import path from "node:path";
import base from "../../playwright.config";

const SPEC = /chat-activity-(?:acceptance|legacy-history)\.spec\.ts/;
const root = process.cwd();
export default {
  ...base,
  testDir: path.join(root, "tests"),
  use: { ...base.use, serviceWorkers: "block" as const },
  retries: 0,
  projects: [
    { name: "golden-chromium", testMatch: SPEC, use: { ...devices["Desktop Chrome"] } },
    { name: "golden-webkit", testMatch: SPEC, use: { ...devices["Desktop Safari"] } },
  ],
  webServer: { ...base.webServer, cwd: root },
};
