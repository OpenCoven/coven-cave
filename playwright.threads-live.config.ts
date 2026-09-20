import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Preserve first-attempt evidence across invocations, including failed runs.
const invocation = process.env.COVEN_THREADS_E2E_INVOCATION ?? randomUUID();
if (!/^[a-f0-9-]{36}$/.test(invocation)) throw new Error("Invalid Threads invocation ID");
process.env.COVEN_THREADS_E2E_INVOCATION = invocation;
const output = `test-results/threads-live-daemon/${invocation}`;
const browser = process.env.COVEN_THREADS_E2E_BROWSER ?? "chromium";
const profiles = { chromium: "Desktop Chrome", firefox: "Desktop Firefox", webkit: "Desktop Safari" } as const;
if (!Object.hasOwn(profiles, browser)) throw new Error("COVEN_THREADS_E2E_BROWSER must be chromium, firefox or webkit");

export default defineConfig({
  testDir: "./tests/threads-live-daemon",
  testMatch: "**/*.journey.ts",
  outputDir: output,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: `${output}/results.json` }],
    ["junit", { outputFile: `${output}/junit.xml` }]],
  use: { trace: "off", screenshot: "only-on-failure" },
  projects: [{ name: browser === "chromium" ? "threads-live-daemon" : `threads-live-daemon-${browser}`, use: { ...devices[profiles[browser as keyof typeof profiles]] } }],
});
