import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const repoRoot = process.cwd();
const SAFE_CAUGHT_MESSAGE = "A workspace pane render error was caught.";
let harnessBundle = "";

test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, "tests/fixtures/workspace-pane-page-harness.tsx")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    write: false,
    tsconfig: path.join(repoRoot, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
  });
  harnessBundle = result.outputFiles[0]?.text ?? "";
  if (!harnessBundle) throw new Error("Workspace pane harness bundle was empty");
});

async function mountHarness(page: Page) {
  await page.setContent("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  await page.addScriptTag({ content: harnessBundle });
  await expect(page.getByTestId("ready-child")).toBeVisible();
}

test("isolates pane failures and restores focus through retries, resets, and states", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await mountHarness(page);

  const pane = page.locator('section[aria-label="Board pane"]');
  const readyChild = page.getByTestId("ready-child");
  await expect(page.getByRole("button", { name: "Sibling survives" })).toBeVisible();
  await expect(readyChild).toContainText("Ready pane content");
  const firstMountId = await readyChild.getAttribute("data-mount-id");

  const crashButton = page.getByRole("button", { name: "Crash pane" });
  await crashButton.focus();
  await expect(crashButton).toBeFocused();
  await crashButton.click();

  const retry = page.getByRole("button", { name: "Try again" });
  const alert = page.getByRole("alert");
  await expect(retry).toBeFocused();
  await expect(alert).toContainText("Board pane could not load");
  await expect(alert).toContainText("This page hit an unexpected error. Try again.");
  await expect(alert).not.toContainText("sk-pane-secret");
  await expect(alert).not.toContainText("/Users/operator");
  await expect(page.getByRole("button", { name: "Sibling survives" })).toBeVisible();
  await expect.poll(() => consoleErrors).toContain(SAFE_CAUGHT_MESSAGE);
  expect(consoleErrors.join("\n")).not.toContain("sk-pane-secret");
  expect(consoleErrors.join("\n")).not.toContain("/Users/operator");
  expect(consoleErrors.join("\n")).not.toContain("internal.example.test");

  await retry.click();
  await expect(retry).toBeFocused();

  await page.getByRole("button", { name: "Prepare successful retry" }).click();
  await retry.click();
  await expect(pane).toBeFocused();
  await expect(readyChild).toBeVisible();
  expect(await readyChild.getAttribute("data-mount-id")).not.toBe(firstMountId);

  await page.getByRole("button", { name: "Crash pane" }).click();
  await expect(retry).toBeFocused();
  await page.getByRole("button", { name: "Reset identity successfully" }).click();
  await expect(pane).toHaveAttribute("data-pane-instance", "pane-reset-1");
  await expect(pane).toBeFocused();
  await expect(readyChild).toBeVisible();
  await expect(retry).toHaveCount(0);

  await page.getByRole("button", { name: "Show loading" }).click();
  await expect(page.getByRole("status", { name: "Board pane is loading" })).toHaveAttribute("aria-live", "polite");
  await expect(readyChild).toHaveCount(0);
  await expect(page.getByText("Board pane is unavailable")).toHaveCount(0);

  await page.getByRole("button", { name: "Show unavailable" }).click();
  const unavailable = page.getByRole("status").filter({ hasText: "Board pane is unavailable" });
  await expect(unavailable).toContainText("The board is temporarily offline.");
  await expect(readyChild).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Board pane is loading" })).toHaveCount(0);

  await page.getByRole("button", { name: "Recover pane" }).click();
  await expect(page.getByLabel("Recovery count")).toHaveText("1");
  await expect(readyChild).toBeVisible();
  await expect(unavailable).toHaveCount(0);

  await page.getByRole("button", { name: "Show loading" }).click();
  await page.getByRole("button", { name: "Show ready" }).click();
  await expect(readyChild).toBeVisible();
  await expect(page.locator('.workspace-pane-page__state[role="status"]')).toHaveCount(0);
});

test("focuses an initial-mount failure without stealing focus on ordinary updates", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await mountHarness(page);

  const ordinaryUpdate = page.getByRole("button", { name: /Ordinary sibling update/ });
  await ordinaryUpdate.click();
  await expect(ordinaryUpdate).toBeFocused();
  await expect(page.getByLabel("Ordinary update count")).toHaveText("1");

  await page.getByRole("button", { name: "Mount failing pane" }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeFocused();
  await expect.poll(() => consoleErrors).toContain(SAFE_CAUGHT_MESSAGE);
  expect(consoleErrors.join("\n")).not.toContain("sk-pane-secret");
  expect(consoleErrors.join("\n")).not.toContain("/Users/operator");
  expect(consoleErrors.join("\n")).not.toContain("internal.example.test");
});
