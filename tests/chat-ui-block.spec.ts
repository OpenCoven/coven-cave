import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import {
  MALFORMED_DASHBOARD,
  MINI_DASHBOARD,
  PRICING_CALCULATOR,
  STATUS_TABLE,
  uiBlockFence,
} from "../src/lib/ui-block-fixtures";

// Native UI tier (docs/chat-native-ui-tier.md), daemon-less: an assistant turn
// carrying ```coven:ui fences renders Cave-native components in place, with
// local State, per-node error chips, and a Button that only prefills the
// composer. Every API surface is page.route-mocked (COVEN_CAVE_E2E=1).
//
// Screenshots: set CAVE_UI_BLOCK_SHOT_DIR to keep light/dark captures outside
// the working tree; otherwise they go to this test's output folder.

test.use({ serviceWorkers: "block" });

const SESSION = "native-ui-tier";
const ISO = "2026-10-11T09:00:00.000Z";

const SHOWCASE_REPLY = [
  "Here's a seat calculator you can play with.",
  uiBlockFence(PRICING_CALCULATOR),
  "And the current service status:",
  uiBlockFence(STATUS_TABLE),
  "Plus this week's delivery numbers:",
  uiBlockFence(MINI_DASHBOARD),
  "Tell me which one you want expanded.",
].join("\n\n");

const MALFORMED_REPLY = ["Some of this block is broken on purpose.", uiBlockFence(MALFORMED_DASHBOARD), "Prose after the block."].join("\n\n");

// A tilde outer fence: the shipped Markdown renderer closes a backtick fence
// at the next backtick fence of any length (see fencedRanges), so a ````
// wrapper would render the example as split blocks. sliceUiBlocks treats both
// shapes as literal; src/lib/ui-blocks.test.ts covers the backtick wrapper.
const FENCED_EXAMPLE_REPLY = [
  "This is how the syntax looks:",
  "~~~markdown",
  uiBlockFence('<Badge tone="danger">Should stay literal</Badge>'),
  "~~~",
  "That is example text.",
].join("\n");

async function setup(page: Page, text: string) {
  const turns = [
    { id: "u1", parentId: null, role: "user", text: "Show me the numbers.", createdAt: ISO },
    { id: "a1", parentId: "u1", role: "assistant", text, createdAt: ISO },
  ];
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "cody");
    localStorage.setItem("cave:familiar:cody:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true,
    familiars: [{ id: "cody", display_name: "Cody", role: "Code familiar", status: "active", icon: "ph:code" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: {
    ok: true,
    sessions: [{
      id: SESSION, title: "Native UI tier", status: "idle", project_root: "/tmp/coven-cave",
      harness: "claude", familiarId: "cody", model: "test", runtime: "local:/tmp/coven-cave",
      exit_code: null, archived_at: null, created_at: ISO, updated_at: ISO,
    }],
  } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: {
    ok: true, projects: [{ id: "p1", name: "Cave", root: "/tmp/coven-cave", access: "write" }],
  } }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({ json: {
    ok: true, state: { familiarId: "cody", harness: "claude", effectiveModel: "test", source: "session", applicationState: "saved" },
  } }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({ json: {
    ok: true,
    conversation: { activeLeafId: "a1", turns },
  } }));
  // A scratch home's first-run toasts (daily summary, milestones, inbox items)
  // would float over the captured blocks, so the spec starts from a quiet inbox.
  await page.route(/\/api\/inbox\/daily-summary(?:\?.*)?$/, (route) => route.fulfill({ json: { ok: true, created: false, updated: false } }));
  await page.route(/\/api\/milestones(?:\?.*)?$/, (route) => route.fulfill({ json: { ok: true, awarded: ["summon:first"] } }));
  await page.route(/\/api\/inbox\/stream(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    headers: { "cache-control": "no-cache" },
    body: `data: ${JSON.stringify({ type: "snapshot", items: [] })}\n\n`,
  }));
  const sends: string[] = [];
  await page.route("**/api/chat/send**", (route) => {
    sends.push(route.request().postData() ?? "");
    return route.fulfill({ status: 409, json: { ok: false, error: "blocked by test" } });
  });
  await page.goto(`/?mode=chat#chat-${SESSION}`, { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  await expect(chat.getByText("Show me the numbers.", { exact: true })).toBeVisible({ timeout: 45_000 });
  return { chat, sends };
}

async function setTheme(page: Page, mode: "dark" | "light") {
  await page.evaluate((nextMode) => {
    document.documentElement.setAttribute("data-theme", "coven");
    document.documentElement.setAttribute("data-mode", nextMode);
    window.dispatchEvent(new CustomEvent("cave:theme-changed", { detail: { themeId: "coven", mode: nextMode } }));
  }, mode);
  await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
}

function shotPath(testInfo: TestInfo, name: string): string {
  const dir = process.env.CAVE_UI_BLOCK_SHOT_DIR;
  if (!dir) return testInfo.outputPath(`${name}.png`);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.png`);
}

async function capture(block: Locator, testInfo: TestInfo, name: string) {
  await block.scrollIntoViewIfNeeded();
  const path = shotPath(testInfo, name);
  await block.screenshot({ path, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

function stat(block: Locator, label: string): Locator {
  return block.locator(".chat-ui-stat").filter({ hasText: label }).locator(".chat-ui-stat__value");
}

// Tall enough that every block sits wholly between the sticky chat header and
// the composer dock, so an element capture never includes chrome over it.
const CAPTURE_VIEWPORT = { width: 1280, height: 2600 };

test("three coven:ui fixtures render natively in light and dark", async ({ page }, testInfo) => {
  await page.setViewportSize(CAPTURE_VIEWPORT);
  const { chat } = await setup(page, SHOWCASE_REPLY);
  const blocks = chat.locator('[data-ui-block="settled"]');
  await expect(blocks).toHaveCount(3);
  const pricing = chat.getByRole("group", { name: "Seat pricing" });
  const status = chat.getByRole("group", { name: "Service status" });
  const dashboard = blocks.nth(2);
  await expect(pricing).toBeVisible();
  await expect(stat(pricing, "Monthly")).toHaveText("$232.00");
  await expect(status.getByRole("columnheader", { name: "p95 latency" })).toBeVisible();
  await expect(status.getByRole("row")).toHaveCount(7);
  await expect(dashboard.getByRole("heading", { name: "Weekly delivery" })).toBeVisible();
  await expect(dashboard.locator("progress")).toHaveAttribute("value", "68");
  await expect(dashboard.locator(".cave-chart svg")).toBeVisible();
  // Prose between blocks survives; no raw fence or markup leaks into the turn.
  await expect(chat.getByText("And the current service status:", { exact: true })).toBeVisible();
  await expect(chat).not.toContainText("```coven:ui");
  await expect(chat).not.toContainText("<Card");
  await expect(chat.locator("[data-ui-block-error]")).toHaveCount(0);

  for (const mode of ["light", "dark"] as const) {
    await setTheme(page, mode);
    await capture(pricing, testInfo, `pricing-calculator-${mode}`);
    await capture(status, testInfo, `status-table-${mode}`);
    await capture(dashboard, testInfo, `mini-dashboard-${mode}`);
  }
});

test("local State drives values and a Button only prefills the composer", async ({ page }) => {
  const { chat, sends } = await setup(page, SHOWCASE_REPLY);
  const pricing = chat.getByRole("group", { name: "Seat pricing" });
  const seats = pricing.getByRole("slider", { name: "Seats" });
  await seats.focus();
  for (let i = 0; i < 4; i += 1) await seats.press("ArrowRight");
  await expect(seats).toHaveValue("12");
  await expect(stat(pricing, "Monthly")).toHaveText("$348.00");

  const annual = pricing.getByRole("switch", { name: /Bill annually/ });
  await annual.click();
  await expect(annual).toHaveAttribute("aria-checked", "true");
  await expect(stat(pricing, "Monthly")).toHaveText("$290.00");
  await expect(pricing.getByText("12 seats at $29 each. Annual billing applied.")).toBeVisible();

  const dashboard = chat.locator('[data-ui-block="settled"]').nth(2);
  await dashboard.getByRole("button", { name: "Range" }).click();
  await page.getByRole("menuitemradio", { name: "Last week" }).click();
  await expect(stat(dashboard, "Merged PRs")).toHaveText("17");

  await pricing.getByRole("button", { name: "Draft upgrade request" }).click();
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(composer).toHaveValue("Upgrade our workspace to 12 seats, billed annually.");
  await expect(composer).toBeFocused();
  // Prefill never sends: no send request, and the transcript still has one reply.
  await page.waitForTimeout(500);
  expect(sends).toEqual([]);
  await expect(chat.getByText("Show me the numbers.", { exact: true })).toHaveCount(1);

  await pricing.getByRole("button", { name: "Reset" }).click();
  await expect(seats).toHaveValue("8");
});

test("a malformed block shows per-node error chips and renders the rest", async ({ page }, testInfo) => {
  await page.setViewportSize(CAPTURE_VIEWPORT);
  const { chat } = await setup(page, MALFORMED_REPLY);
  const block = chat.getByRole("group", { name: "Partly broken" });
  await expect(block).toBeVisible();
  await expect(block.locator("[data-ui-block-error]")).toHaveCount(6);
  await expect(block.locator('[data-ui-block-error="Sparkline"]')).toContainText("Unknown component <Sparkline>");
  await expect(block.locator('[data-ui-block-error="Badge"]')).toContainText('Unknown prop "colour"');
  await expect(stat(block, "Valid stat")).toHaveText("6");
  await expect(block.getByText("Still rendered after the failures.")).toBeVisible();
  await expect(chat.getByText("Prose after the block.", { exact: true })).toBeVisible();
  for (const mode of ["light", "dark"] as const) {
    await setTheme(page, mode);
    await capture(block, testInfo, `malformed-dashboard-${mode}`);
  }
});

test("a coven:ui example inside another fence stays literal text", async ({ page }) => {
  const { chat } = await setup(page, FENCED_EXAMPLE_REPLY);
  await expect(chat.getByText("That is example text.", { exact: true })).toBeVisible();
  await expect(chat.locator("[data-ui-block]")).toHaveCount(0);
  await expect(chat.locator("pre, code").filter({ hasText: "Should stay literal" }).first()).toBeVisible();
});
