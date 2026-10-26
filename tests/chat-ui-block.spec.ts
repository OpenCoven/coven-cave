import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import {
  DELIVERY_PULSE,
  FAILED_CHILD_TEXT,
  MALFORMED_DASHBOARD,
  MINI_DASHBOARD,
  PRICING_CALCULATOR,
  RELEASE_BRIEF,
  RELEASE_DRAFT,
  STATUS_TABLE,
  uiBlockFence,
} from "../src/lib/ui-block-fixtures";

// Native UI tier (docs/chat-native-ui-tier.md), daemon-less: an assistant turn
// carrying ```coven:ui fences renders Cave-native components in place, with
// local State, per-node error chips with the failed node's text beneath
// them, and a Button that only prefills the composer. Every API surface is page.route-mocked (COVEN_CAVE_E2E=1).
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

const DRAFT_REPLY = ["Here's the draft.", uiBlockFence(RELEASE_DRAFT), "Prose after the block."].join("\n\n");

const PULSE_REPLY = ["This week's pulse.", uiBlockFence(DELIVERY_PULSE), "Prose after the block."].join("\n\n");

const RELEASE_REPLY = ["Here's the release brief.", uiBlockFence(RELEASE_BRIEF), "Prose after the block."].join("\n\n");

const FAILED_CHILD_REPLY = ["Here is the release check.", uiBlockFence(FAILED_CHILD_TEXT), "Prose after the block."].join("\n\n");

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

async function setTheme(page: Page, mode: "dark" | "light", theme = "coven") {
  await page.evaluate(({ nextMode, themeId }) => {
    document.documentElement.setAttribute("data-theme", themeId);
    document.documentElement.setAttribute("data-mode", nextMode);
    window.dispatchEvent(new CustomEvent("cave:theme-changed", { detail: { themeId, mode: nextMode } }));
  }, { nextMode: mode, themeId: theme });
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
  await setTheme(page, "dark", "tide");
  await capture(pricing, testInfo, "pricing-calculator-tide-dark");
  await capture(status, testInfo, "status-table-tide-dark");
  await capture(dashboard, testInfo, "mini-dashboard-tide-dark");
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
  await expect(block.locator('[data-ui-block-error="Marquee"]')).toContainText("Unknown component <Marquee>");
  await expect(block.locator('[data-ui-block-error="Badge"]')).toContainText('Unknown prop "colour"');
  await expect(stat(block, "Valid stat")).toHaveText("6");
  await expect(block.getByText("Still rendered after the failures.")).toBeVisible();
  await expect(chat.getByText("Prose after the block.", { exact: true })).toBeVisible();
  for (const mode of ["light", "dark"] as const) {
    await setTheme(page, mode);
    await capture(block, testInfo, `malformed-dashboard-${mode}`);
  }
});

test("a failed component keeps its text readable and its markup inert", async ({ page }, testInfo) => {
  await page.setViewportSize(CAPTURE_VIEWPORT);
  const { chat } = await setup(page, FAILED_CHILD_REPLY);
  const block = chat.getByRole("group", { name: "Release check" });
  await expect(block).toBeVisible();
  await expect(block.getByRole("note")).toHaveCount(6);
  await expect(block.locator("[data-ui-block-error]")).toHaveCount(6);
  // Each failure's text reads as one line beneath its chip, in reading order.
  for (const line of ["Score: 3 of 5 checks pass", "Mood is glow today", "Trend is up"]) {
    await expect(block.locator("p.chat-ui-text").filter({ hasText: new RegExp(`^${line}$`) })).toHaveCount(1);
  }
  const text = await block.innerText();
  const order = [
    'Couldn\'t render <Text>: Unknown prop "colour" on <Text>',
    "Score: 3 of 5 checks pass",
    "Couldn't render <Text>: tone must be one of",
    "Mood is glow today",
    "Couldn't render <Marquee>",
    "Trend is up",
    "Still rendered",
  ].map((part) => text.indexOf(part));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  await expect(block.getByText("Still rendered", { exact: true })).toBeVisible();
  await expect(chat.getByText("Prose after the block.", { exact: true })).toBeVisible();
  // Script- and HTML-like markup stays text: no element is created and nothing runs.
  await expect(block.locator("script, img, iframe, b")).toHaveCount(0);
  await expect(block.getByText("Shown as <b onclick='window.__covenUiInjected = true'>text</b>", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as { __covenUiInjected?: unknown }).__covenUiInjected)).toBeUndefined();
  for (const mode of ["light", "dark"] as const) {
    await setTheme(page, mode);
    await capture(block, testInfo, `failed-child-text-${mode}`);
  }
});

test("the layout catalog renders with native semantics and stacks in a narrow pane", async ({ page }, testInfo) => {
  await page.setViewportSize(CAPTURE_VIEWPORT);
  const { chat } = await setup(page, RELEASE_REPLY);
  const block = chat.getByRole("group", { name: "Release brief" });
  await expect(block).toBeVisible();
  await expect(block.locator("[data-ui-block-error]")).toHaveCount(0);
  await expect(block.getByRole("note", { name: "Warning: Freeze starts Thursday" })).toBeVisible();
  await expect(block.getByRole("separator")).toHaveCount(1);
  const lists = block.getByRole("list");
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(0).getByRole("listitem")).toHaveText(["Native UI blocks", "Faster startup", "Quieter inbox"]);
  await expect(lists.nth(1).getByRole("listitem")).toHaveText(["Tag the release", "Publish the notes", "Watch crash reports"]);
  // Visible markers: an ordered list has to show its sequence, not just announce it.
  await expect(lists.nth(0)).toHaveCSS("list-style-type", "disc");
  await expect(lists.nth(1)).toHaveCSS("list-style-type", "decimal");
  await expect(block.locator("code")).toHaveText(["pnpm test:app", "pnpm lint"]);
  await expect(block.locator("strong")).toHaveText(["don't skip pnpm lint"]);
  const grid = block.locator(".chat-ui-grid");
  await expect(grid).toHaveCSS("grid-template-columns", /^[\d.]+px [\d.]+px [\d.]+px$/);
  await expect(chat.getByText("Prose after the block.", { exact: true })).toBeVisible();
  for (const mode of ["light", "dark"] as const) {
    await setTheme(page, mode);
    await capture(block, testInfo, `release-brief-${mode}`);
  }
  await setTheme(page, "dark", "tide");
  await capture(block, testInfo, "release-brief-tide-dark");
  // A pane narrower than 18rem stacks the grid's cells instead of clipping them.
  await block.evaluate((element) => { element.style.width = "16rem"; });
  await expect(grid).toHaveCSS("grid-template-columns", /^[\d.]+px$/);
});

test("the data catalog renders trends, a sparkline, a donut and badge cells", async ({ page }, testInfo) => {
  await page.setViewportSize(CAPTURE_VIEWPORT);
  const { chat } = await setup(page, PULSE_REPLY);
  const block = chat.getByRole("group", { name: "Delivery pulse" });
  await expect(block).toBeVisible();
  await expect(block.locator("[data-ui-block-error]")).toHaveCount(0);
  await expect(block.locator(".chat-ui-stat__trend")).toHaveText(["+12% increase", "\u22120.8 decrease", "0 unchanged"]);
  const spark = block.locator("figure.chat-ui-sparkline");
  await expect(spark.locator("figcaption")).toHaveText("Merges per day");
  await expect(spark.locator(".spark svg path")).toHaveCount(2);
  // The sparkline's own sheet loads in chat without the dashboard stylesheet.
  await expect(spark.locator(".spark")).toHaveCSS("position", "relative");
  const donut = block.locator("figure.chat-ui-donut");
  await expect(donut.getByRole("img", { name: "Review load: Cody 9 (50%), Nova 6 (33%), Val 3 (17%)" })).toBeVisible();
  await expect(donut.locator("svg path")).toHaveCount(3);
  await expect(donut.getByRole("listitem")).toHaveText(["Cody9 (50%)", "Nova6 (33%)", "Val3 (17%)"]);
  await expect(block.getByRole("table", { name: "Service health" }).locator("td .chat-ui-badge")).toHaveText(["healthy", "down"]);
  await expect(chat.getByText("Prose after the block.", { exact: true })).toBeVisible();
  for (const mode of ["light", "dark"] as const) {
    await setTheme(page, mode);
    await capture(block, testInfo, `delivery-pulse-${mode}`);
  }
  await setTheme(page, "dark", "tide");
  await capture(block, testInfo, "delivery-pulse-tide-dark");
});

test("tabs and a text input drive local State, and the draft only prefills", async ({ page }, testInfo) => {
  await page.setViewportSize(CAPTURE_VIEWPORT);
  const { chat, sends } = await setup(page, DRAFT_REPLY);
  const block = chat.getByRole("group", { name: "Release notes draft" });
  await expect(block).toBeVisible();
  await expect(block.locator("[data-ui-block-error]")).toHaveCount(0);
  const tablist = block.getByRole("tablist", { name: "Draft sections" });
  await expect(tablist.getByRole("tab")).toHaveText(["Summary", "Details"]);
  await expect(tablist.getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
  const headline = block.getByRole("textbox", { name: "Headline" });
  await expect(headline).toHaveValue("Faster startup");
  await expect(headline).toHaveAttribute("maxlength", "80");
  await headline.fill("Quicker boot");
  await expect(block.getByText("Headline: Quicker boot", { exact: true })).toBeVisible();
  for (const mode of ["light", "dark"] as const) {
    await setTheme(page, mode);
    await capture(block, testInfo, `release-draft-${mode}`);
  }
  await setTheme(page, "dark", "tide");
  await capture(block, testInfo, "release-draft-tide-dark");

  // Arrow keys move between tabs, and Enter selects one.
  await tablist.getByRole("tab", { name: "Summary" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tablist.getByRole("tab", { name: "Details" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tablist.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  await expect(block.getByRole("tabpanel").getByRole("listitem")).toHaveText(["Startup is 40% faster", "The inbox is quieter"]);

  await block.getByRole("button", { name: "Draft the announcement" }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Release headline: Quicker boot");
  expect(sends).toEqual([]);
});

test("a coven:ui example inside another fence stays literal text", async ({ page }) => {
  const { chat } = await setup(page, FENCED_EXAMPLE_REPLY);
  await expect(chat.getByText("That is example text.", { exact: true })).toBeVisible();
  await expect(chat.locator("[data-ui-block]")).toHaveCount(0);
  await expect(chat.locator("pre, code").filter({ hasText: "Should stay literal" }).first()).toBeVisible();
});
