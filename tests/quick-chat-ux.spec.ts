import { expect, test, type Page } from "@playwright/test";
import { installCompletedFirstUse } from "./fixtures/first-use";

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
  // A removed saved project leaves this already-introduced installation in
  // repair. The held-project cases make a fresh, explicit actor choice below.
  await installCompletedFirstUse(page, { project: { id: "retired-qc-project", name: "Previous project", root: "/tmp/retired-quick-chat" }, familiarIds: ["nova"], actingFamiliarId: "nova", permissionMode: "full", repairReason: "project" });
  return { sends };
}

const announcementsOf = (page: Page, text: string) =>
  page.evaluate((needle) => (window as unknown as { caveAnnouncements: string[] }).caveAnnouncements.filter((entry) => entry === needle).length, text);

async function openQuickChat(page: Page) {
  await page.goto("/quick-chat", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("complementary", { name: "Compact chat guidance" })).toContainText("The saved project is unavailable.");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  const pane = page.locator(".tray-quick-chat__pane:visible");
  const message = pane.getByRole("combobox", { name: "Message", exact: true });
  await expect(message).toBeVisible({ timeout: 45_000 });
  await pane.getByRole("button", { name: "Familiar", exact: true }).click();
  await page.getByRole("menu", { name: "Familiar options", exact: true }).getByRole("menuitemradio", { name: /Nova$/ }).click();
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

test("an attachment-only message held on a project points the picker at the same hint", async ({ page }) => {
  const { sends } = await seed(page);
  const { pane, message } = await openQuickChat(page);
  const send = pane.getByRole("button", { name: "Send", exact: true });
  const projectPicker = page.getByRole("button", { name: "Project", exact: true });
  const hint = pane.locator(".quick-chat-send-hint");

  // Hold the text read open so the in-between "reading" state is observable.
  await page.evaluate(() => {
    const slice = File.prototype.slice;
    File.prototype.slice = function (...args: Parameters<typeof slice>) {
      const blob = slice.apply(this, args);
      blob.text = () => new Promise((resolve) => {
        window.addEventListener("release-attachment-read", () => resolve("Evidence"), { once: true });
      });
      return blob;
    };
  });
  await expect(message).toHaveValue("");
  await message.evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(new File(["Evidence"], "notes.txt", { type: "text/plain" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  });

  // Still reading: nothing can send yet, so neither the hint nor the picker's
  // description exists — the picker never points at a hint that isn't there.
  await expect(pane.getByRole("status").filter({ hasText: "Reading attachments…" })).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(hint).toHaveCount(0);
  await expect(projectPicker).not.toHaveClass(/quick-chat-select--attention/);
  await expect(projectPicker).not.toHaveAttribute("aria-describedby", /.+/);

  // Read settles: a file with no text is something to send, held by the
  // project gate — the hint shows and the picker is marked and described by it.
  await page.evaluate(() => window.dispatchEvent(new Event("release-attachment-read")));
  const remove = pane.getByRole("button", { name: "Remove notes.txt", exact: true });
  await expect(remove).toBeVisible();
  await expect(message).toHaveValue("");
  await expect(hint).toHaveText(HELD_REASON);
  const hintId = await hint.getAttribute("id");
  expect(hintId).toBeTruthy();
  await expect(send).toBeDisabled();
  await expect(send).toHaveAttribute("aria-describedby", hintId!);
  await expect(projectPicker).toHaveAttribute("aria-describedby", hintId!);
  await expect(projectPicker).toHaveClass(/quick-chat-select--attention/);

  // Removing the only file leaves nothing to send: hint and attention go together.
  await remove.click();
  await expect(remove).toHaveCount(0);
  await expect(hint).toHaveCount(0);
  await expect(projectPicker).not.toHaveClass(/quick-chat-select--attention/);
  await expect(projectPicker).not.toHaveAttribute("aria-describedby", /.+/);
  expect(sends).toHaveLength(0);
});

// Design language §9: the new hint, the picker's attention ring and the
// labelled chips must hold in dark and light and on a non-default palette.
const PALETTES: ReadonlyArray<{ theme: string; mode: "dark" | "light" }> = [
  { theme: "coven", mode: "dark" },
  { theme: "coven", mode: "light" },
  { theme: "tide", mode: "dark" },
  { theme: "ember", mode: "light" },
];

test("the held hint, picker attention and chips stay legible across palettes", async ({ page }, testInfo) => {
  await seed(page);
  await page.setViewportSize({ width: 580, height: 640 });
  const { pane } = await openQuickChat(page);
  await pane.getByRole("button", { name: "Summarize what needs my attention", exact: true }).click();
  await expect(pane.locator(".quick-chat-send-hint")).toHaveText(HELD_REASON);
  await expect(page.locator(".quick-chat-select--attention")).toBeVisible();

  for (const { theme, mode } of PALETTES) {
    await page.evaluate(({ theme, mode }) => {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.setAttribute("data-mode", mode);
      window.dispatchEvent(new CustomEvent("cave:theme-changed", { detail: { themeId: theme, mode } }));
    }, { theme, mode });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
    const contrast = await page.evaluate(() => {
      const rgba = (color: string) => {
        const context = document.createElement("canvas").getContext("2d")!;
        context.fillStyle = "#000";
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      // Composite every translucent layer from the root down to the element.
      const backdrop = (element: Element) => {
        const chain: Element[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
        return chain.reduce((under, node) => {
          const [r, g, b, a] = rgba(getComputedStyle(node).backgroundColor);
          return [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a)];
        }, [255, 255, 255]);
      };
      const luminance = ([r, g, b]: number[]) => {
        const channel = (value: number) => {
          const v = value / 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const ratio = (selector: string, property: "color" | "borderTopColor") => {
        const element = document.querySelector(selector)!;
        const under = backdrop(element);
        const [r, g, b, a] = rgba(getComputedStyle(element)[property]);
        const over = [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a)];
        const [light, dark] = [luminance(over), luminance(under)].sort((x, y) => y - x);
        return (light + 0.05) / (dark + 0.05);
      };
      return {
        hint: ratio(".quick-chat-send-hint", "color"),
        attention: ratio(".quick-chat-select--attention", "borderTopColor"),
        chipKey: ratio(".quick-chat-meta-chip__key", "color"),
        chipValue: ratio(".quick-chat-meta-chip__value", "color"),
      };
    });
    const label = `${theme}/${mode}`;
    expect(contrast.hint, `${label}: hint text`).toBeGreaterThanOrEqual(4.5);
    expect(contrast.attention, `${label}: attention border (non-text)`).toBeGreaterThanOrEqual(3);
    expect(contrast.chipKey, `${label}: chip key`).toBeGreaterThanOrEqual(4.5);
    expect(contrast.chipValue, `${label}: chip value outranks its key`).toBeGreaterThan(contrast.chipKey);
    await testInfo.attach(`palette-${theme}-${mode}`, { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" });
    await testInfo.attach(`palette-${theme}-${mode}-contrast`, { body: JSON.stringify(contrast), contentType: "application/json" });
  }
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
