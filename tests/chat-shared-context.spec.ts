import { expect, test } from "@playwright/test";
import { setup, openThread } from "./chat-context-fixture";
import { openChatFilter } from "./fixtures/chat-filter";

const bar = (page: import("@playwright/test").Page) => page.locator(".workspace-titlebar-context");
async function project(page: import("@playwright/test").Page, name: string) {
  await bar(page).getByRole("button", { name: /^Switch project:/ }).click();
  await page.locator(".cave-project-picker__row").filter({ hasText: name }).first().locator(".ui-popover-item").click();
}

test("Chat and Tasks share project and familiar selections in both directions", async ({ page }) => {
  await setup(page);
  const navigation = page.getByRole("region", { name: "Navigation", exact: true });
  await navigation.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.locator(".chat-surface")).toBeVisible();
  await project(page, "Context alpha");
  await bar(page).getByRole("button", { name: /^Switch familiar/ }).click();
  await page.getByRole("option").filter({ hasText: "Cody" }).click();
  await navigation.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(bar(page).getByRole("button", { name: /^Switch project: Context alpha/ })).toBeVisible();
  await expect(bar(page).getByRole("button", { name: /Switch familiar — current: Cody/ })).toBeVisible();
  await project(page, "Context beta");
  await navigation.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(bar(page).getByRole("button", { name: /^Switch project: Context beta/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("shared-context.png") });
});

test("shared familiar selection preserves the open conversation, draft and route", async ({ page }) => {
  await setup(page);
  await openThread(page, "B");
  const composer = page.getByTestId("chat-main").getByRole("textbox", { name: "Message", exact: true });
  await composer.fill("Keep this draft in the existing conversation");
  const hash = await page.evaluate(() => location.hash);
  await bar(page).getByRole("button", { name: /^Switch familiar/ }).click();
  await page.getByRole("option").filter({ hasText: "Sage" }).click();
  await expect(composer).toHaveValue("Keep this draft in the existing conversation");
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  await expect(page.getByTestId("chat-main").getByRole("button", { name: /^Project: Context beta/ })).toBeVisible();
  await page.getByRole("region", { name: "Navigation", exact: true }).getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(bar(page).getByRole("button", { name: /Switch familiar — current: Sage/ })).toBeVisible();
});


test("multi-familiar and All scope remain shared after page changes", async ({ page }) => {
  await setup(page);
  await bar(page).getByRole("button", { name: /^Switch familiar/ }).click();
  await page.getByRole("option").filter({ hasText: "Sage" }).locator(".familiar-switcher__checkbox").click();
  await page.keyboard.press("Escape");
  await expect(bar(page).getByRole("button", { name: "Switch familiar — scope: 2 familiars", exact: true })).toBeVisible();
  await page.getByRole("region", { name: "Navigation", exact: true }).getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(bar(page).getByRole("button", { name: "Switch familiar — scope: 2 familiars", exact: true })).toBeVisible();
  await bar(page).getByRole("button", { name: /^Switch familiar/ }).click();
  await page.getByRole("option").filter({ hasText: "All familiars" }).click();
  await page.getByRole("region", { name: "Navigation", exact: true }).getByRole("button", { name: "Chat", exact: true }).click();
  await expect(bar(page).getByRole("button", { name: "Switch familiar — scope: all familiars", exact: true })).toBeVisible();
});

test("narrow Chat controls update the same project shown by the desktop title bar", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 900, height: 800 });
  const filter = await openChatFilter(page);
  await filter.controls.getByRole("button", { name: /^Switch project:/ }).click();
  await page.locator(".cave-project-picker__row").filter({ hasText: "Context alpha" }).first().locator(".ui-popover-item").click();
  await filter.close();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("region", { name: "Navigation", exact: true }).getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(bar(page).getByRole("button", { name: /^Switch project: Context alpha/ })).toBeVisible();
});
