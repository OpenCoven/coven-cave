import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /embedded-adapters\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: { ...devices["Desktop Chrome"] },
});
