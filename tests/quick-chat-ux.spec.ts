import { expect, test, type Page } from "@playwright/test";

// Quick Chat tray UX (#6421): a held send explains itself, the project pick
// hands focus back to the waiting message, the composer controls share one
// height in the narrow desktop tray, the cold thread shows keycap hints, and
// the footer only shows controls that can act.
//
// Daemon-less: every API the tray touches is mocked, including the chat stream.

test.use({ serviceWorkers: "block" });

const FAMILIAR = { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", harness: "codex", icon: "ph:sparkle-fill" };
const PROJECT = { id: "qc-project", name: "Cave", root: "/tmp/quick-chat-ux", access: "write" };
const HELD_REASON = "Choose a project this familiar can access before starting chat.";

type Seed = { sends: string[] };

async function seed(page: Page): Promise<Seed> {
  const sends: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave.quick-chat.last-familiar", "nova");
    // The shared announcer clears its polite region 250ms after each message,
    // so record every announcement as it lands instead of racing the clear.
    const announcements: string[] = [];
    const current = new WeakMap<Element, string>();
    Object.assign(window, { caveAnnouncements: announcements });
    new MutationObserver(() => {
      for (const region of document.querySelectorAll('[aria-live="polite"]')) {
        const text = region.textContent?.trim() ?? "";
        // A message counts each time it is (re)written; the clear in between
        // resets the region so an identical repeat still registers.
        if (text && current.get(region) !== text) announcements.push(text);
        current.set(region, text);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [FAMILIAR] } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [PROJECT] } }));
  await page.route("**/api/queue/project", (route) => route.fulfill({ json: { ok: true, projectId: PROJECT.id, project: PROJECT } }));
  await page.route("**/api/daemon/connection**", (route) => route.fulfill({ json: { ok: true, running: true, connected: true, target: { mode: "local" } } }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({
    json: { ok: true, state: {
      familiarId: "nova", runtime: null, harness: "codex", effectiveModel: "unknown",
      source: "runtime-default", applicationState: "saved", reason: "e2e",
    } },
  }));
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postData() ?? "");
    const frames = [
      { kind: "assistant_chunk", text: "Two reviews are waiting on you." },
      { kind: "done", sessionId: "s-quick-chat-ux" },
    ];
    return route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""),
    });
  });
  return { sends };
}

const announcementsOf = (page: Page, text: string) =>
  page.evaluate((needle) => (window as unknown as { caveAnnouncements: string[] }).caveAnnouncements.filter((entry) => entry === needle).length, text);

async function openQuickChat(page: Page) {
  await page.goto("/quick-chat", { waitUntil: "domcontentloaded" });
  const pane = page.locator(".tray-quick-chat__pane");
  const message = pane.getByRole("combobox", { name: "Message", exact: true });
  await expect(message).toBeVisible({ timeout: 45_000 });
  await expect(pane.locator(".quick-chat-empty__title")).toHaveText("Ask Nova anything", { timeout: 20_000 });
  return { pane, message };
}

test("a starter waiting on a project names why, then sends after the pick", async ({ page }, testInfo) => {
  const { sends } = await seed(page);
  const { pane, message } = await openQuickChat(page);
  const send = pane.getByRole("button", { name: "Send", exact: true });
  const projectPicker = page.getByRole("button", { name: "Project", exact: true });

  // Nothing to send yet: no reason, no attention on the picker.
  await expect(pane.locator(".quick-chat-send-hint")).toHaveCount(0);
  await expect(projectPicker).not.toHaveClass(/quick-chat-select--attention/);

  // A starter fills the composer, but no project is chosen: the held send says
  // why, and the reason describes Send, the message field and the picker.
  await pane.getByRole("button", { name: "Summarize what needs my attention", exact: true }).click();
  await expect(message).toHaveValue("Summarize what needs my attention");
  const hint = pane.locator(".quick-chat-send-hint");
  await expect(hint).toHaveText(HELD_REASON);
  const hintId = await hint.getAttribute("id");
  expect(hintId).toBeTruthy();
  await expect(send).toBeDisabled();
  await expect(send).toHaveAttribute("aria-describedby", hintId!);
  await expect(message).toHaveAttribute("aria-describedby", hintId!);
  await expect(projectPicker).toHaveAttribute("aria-describedby", hintId!);
  await expect(projectPicker).toHaveClass(/quick-chat-select--attention/);
  // Announced once when it appears, not again for every further keystroke.
  await expect.poll(() => announcementsOf(page, HELD_REASON)).toBe(1);
  await message.press("End");
  await message.pressSequentially(" now");
  await message.press("Backspace");
  await message.press("Backspace");
  await message.press("Backspace");
  await message.press("Backspace");
  expect(await announcementsOf(page, HELD_REASON)).toBe(1);
  await testInfo.attach("held-send", { body: await page.screenshot(), contentType: "image/png" });

  // Enter on the held message keeps the draft, sends nothing, and repeats the
  // reason for anyone who pressed it without seeing the text. The shared
  // announcer holds a message for 250ms, and an identical re-announcement
  // inside that window is (correctly) a no-op, so wait for the clear first.
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll('[aria-live="polite"]')].every((region) => !region.textContent?.trim()),
  )).toBe(true);
  await message.focus();
  await message.press("Enter");
  await expect(message).toHaveValue("Summarize what needs my attention");
  await expect.poll(() => announcementsOf(page, HELD_REASON)).toBe(2);
  expect(sends).toHaveLength(0);

  // A local /command is never held by the project gate.
  await message.fill("/help");
  await expect(hint).toHaveCount(0);
  await expect(projectPicker).not.toHaveClass(/quick-chat-select--attention/);
  await message.fill("Summarize what needs my attention");
  await expect(hint).toHaveText(HELD_REASON);

  // Choosing the project releases the hold and hands focus back to the
  // waiting message, so one Enter sends it.
  await projectPicker.click();
  await page.getByRole("menu", { name: "Project options" }).getByText("Cave · Full", { exact: true }).click();
  await expect(hint).toHaveCount(0);
  await expect(message).toBeFocused();
  await expect(message).toHaveValue("Summarize what needs my attention");
  await expect(send).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toContain("Summarize what needs my attention");
  await expect(pane.locator(".quick-chat-turn--familiar").last()).toContainText("Two reviews are waiting on you.");
});

test("the footer shows only controls that can act and names its chips", async ({ page }) => {
  await seed(page);
  const { pane, message } = await openQuickChat(page);

  // Before any reply there is no chat to open, so no dead disabled button.
  await expect(pane.getByRole("button", { name: "Open in CovenCave", exact: true })).toHaveCount(0);
  const chips = pane.getByRole("group", { name: /Model Auto/ });
  await expect(chips).toBeVisible();
  await expect(chips.locator(".quick-chat-meta-chip").last()).toHaveText("ModelAuto");
  await expect(chips.locator(".quick-chat-meta-chip__key").last()).toHaveText("Model");

  // Once a reply settles there is a session, and the hand-off appears.
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("menu", { name: "Project options" }).getByText("Cave · Full", { exact: true }).click();
  await message.fill("What changed recently?");
  await pane.getByRole("button", { name: "Send", exact: true }).click();
  await expect(pane.locator(".quick-chat-turn--familiar").last()).toContainText("Two reviews are waiting on you.");
  await expect(pane.getByRole("button", { name: "Open in CovenCave", exact: true })).toBeEnabled();
});

test("the cold thread shows whole keycap hints that wrap between hints", async ({ page }, testInfo) => {
  await seed(page);
  const { pane } = await openQuickChat(page);
  const hints = pane.locator(".quick-chat-empty__key");
  await expect(hints).toHaveText(["@switch familiar", "/commands", "Entersend"]);
  await expect(pane.locator(".quick-chat-empty__keys kbd")).toHaveText(["@", "/", "Enter"]);

  // Narrow enough to force a wrap: every hint still sits on one line.
  for (const width of [580, 300]) {
    await page.setViewportSize({ width, height: 640 });
    const heights = await hints.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    const kbdHeight = await pane.locator(".quick-chat-empty__keys kbd").first().evaluate((element) => element.getBoundingClientRect().height);
    for (const height of heights) expect(height).toBeLessThan(kbdHeight * 1.8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach(`empty-state-${width}`, { body: await page.screenshot(), contentType: "image/png" });
  }
});

test("the narrow desktop tray keeps Enhance at Send's height", async ({ page }, testInfo) => {
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  test.skip(coarse, "touch pointers keep the 44px touch target by design");
  await seed(page);
  // The tray window's own size: below the 768px phone breakpoint, mouse-driven.
  await page.setViewportSize({ width: 580, height: 640 });
  const { pane, message } = await openQuickChat(page);
  await message.fill("Draft a short status update");
  const enhance = pane.locator(".composer-enhance-control");
  const send = pane.getByRole("button", { name: "Send", exact: true });
  await expect(enhance).toBeVisible();
  const enhanceBox = (await enhance.boundingBox())!;
  const sendBox = (await send.boundingBox())!;
  // The control's 1px hairline frame may add up to 2px around 26px segments.
  expect(Math.abs(enhanceBox.height - sendBox.height)).toBeLessThanOrEqual(2);
  expect(enhanceBox.height).toBeLessThan(36);
  await testInfo.attach("narrow-actions", { body: await pane.locator(".quick-chat-overlay__actions").screenshot(), contentType: "image/png" });
});
