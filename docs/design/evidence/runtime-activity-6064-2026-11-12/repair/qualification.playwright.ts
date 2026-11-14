import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import base from "../../../../../playwright.config";

// Portable equivalent of the retained local config. Build first; no compiler
// or existing server is reused. Canonical fixture headers/state remain intact.
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const output = mkdtempSync(join(tmpdir(), "c6064-browser-"));
const port = process.env.COVEN_CAVE_PORT ?? "3164";
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL("../../../../../tests", import.meta.url)),
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: process.env.C6064_REPORT_PATH ?? join(output, "report.json") }]],
  outputDir: join(output, "results"),
  use: { ...base.use, baseURL: origin, trace: "off", screenshot: "only-on-failure", video: "off" },
  projects: [
    { name: "chromium-6064", testMatch: /chat-(?:activity-acceptance|tool-cards)\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-6064", testMatch: /chat-(?:activity-acceptance|tool-cards)\.spec\.ts/, use: { ...devices["Desktop Safari"] } },
  ],
  webServer: { ...base.webServer, cwd: root, url: origin, reuseExistingServer: false,
    command: `node scripts/start-playwright-production.mjs ${port}` },
});
