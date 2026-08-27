import { expect, test, type Page } from "@playwright/test";

const FAMILIARS = [
  { id: "cody", display_name: "Cody", role: "Implementer", status: "active", icon: "ph:code" },
  { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
];

const sessions = [
  {
    id: "cody-old",
    project_root: "/repo",
    harness: "copilot",
    title: "Older Cody chat",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-07T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
    familiarId: "cody",
    hasLocalConversation: true,
  },
  {
    id: "cody-new",
    project_root: "/repo",
    harness: "copilot",
    title: "Newest Cody chat",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-02T10:00:00.000Z",
    updated_at: "2026-08-08T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
    familiarId: "cody",
    hasLocalConversation: true,
  },
  {
    id: "nova-newest",
    project_root: "/repo",
    harness: "copilot",
    title: "Nova must not be selected",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-03T10:00:00.000Z",
    updated_at: "2026-08-09T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
    familiarId: "nova",
    hasLocalConversation: true,
  },
];

async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
    localStorage.setItem("cave:shell:right-chat-open", "0");
    localStorage.setItem("cave:shell:right-chat-width", "360");
    localStorage.removeItem("cave.shell.widths.v3");
    localStorage.removeItem("cave.shell.widths.v3.right-chat");
    localStorage.removeItem("cave.shell.widths.v3.persistent-list.right-chat");
    localStorage.removeItem("cave.shell.widths.v3.two-pane.right-chat");
    localStorage.removeItem("cave.shell.widths.v3.chat-contextual.right-chat");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: FAMILIARS } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions } }),
  );
  await page.route("**/api/chat/conversation**", (route) => {
    const sessionId = new URL(route.request().url()).searchParams.get("sessionId");
    return route.fulfill({
      json: {
        ok: true,
        conversation: {
          sessionId,
          familiarId: "cody",
          turns: [],
          activeLeafId: null,
        },
      },
    });
  });
  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
}

test("desktop keeps the panel across surfaces and supports a second Chat conversation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await boot(page);

  const toggle = page.getByRole("button", { name: "Open Chat panel" });
  await toggle.click();
  const panel = page.locator(".right-chat").first();
  const outerPanel = page.locator('[data-panel="true"]#right-chat');
  await expect(page.getByRole("button", { name: "Close Chat panel" }).first()).toBeVisible();
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect(panel.locator(".right-chat__rail")).toBeVisible();
  await expect(panel.locator(".right-chat__header")).toHaveCount(0);
  await expect(panel).toContainText("Newest Cody chat");
  await expect(panel).not.toContainText("Nova must not be selected");

  const titlebarContext = page.locator(".workspace-titlebar-context");
  await expect(titlebarContext).toBeVisible();

  const chooseFamiliar = async (name: string) => {
    await titlebarContext.locator('button[aria-label^="Switch familiar"]').click();
    await page.getByRole("dialog", { name: "Familiars" }).getByText(name, { exact: true }).last().click();
  };

  const panelDraft = panel.getByRole("textbox", { name: "Message" });
  await panelDraft.fill("Keep this Cody draft");
  await chooseFamiliar("Nova");
  await expect(panel).toHaveAttribute("data-session-id", "nova-newest");
  await chooseFamiliar("Cody");
  await expect(panel).toHaveAttribute("data-session-id", "cody-new");
  await expect(panel.getByRole("textbox", { name: "Message" })).toHaveValue("Keep this Cody draft");

  await chooseFamiliar("All familiars");
  await expect(panel.getByText("Choose a familiar", { exact: true })).toBeVisible();
  await expect(panel).not.toContainText("Nova must not be selected");
  await panel.getByRole("button", { name: "Cody", exact: true }).click();
  await expect(panel).toHaveAttribute("data-session-id", "cody-new");

  const before = await outerPanel.boundingBox();
  const handle = outerPanel.locator("xpath=preceding-sibling::*[1]");
  const box = await handle.boundingBox();
  if (!before || !box) throw new Error("Right Chat panel or separator did not render");
  await handle.focus();
  for (let i = 0; i < 8; i += 1) await page.keyboard.press("ArrowLeft");
  let after = await outerPanel.boundingBox();
  if (Math.abs((after?.width ?? 0) - before.width) < 10) {
    for (let i = 0; i < 8; i += 1) await page.keyboard.press("ArrowRight");
    after = await outerPanel.boundingBox();
  }
  expect(Math.abs((after?.width ?? 0) - before.width)).toBeGreaterThan(10);

  const chatTab = page.getByRole("tablist", { name: "Workspace sections" }).getByRole("tab", { name: "Chat" });
  // The keyboard resize above can leave the separator's expanded pointer
  // target armed, so the first pointerdown here is swallowed as a zero-delta
  // drag. A harmless first click (still on "Home", a no-op) clears that state
  // so the real navigation click below lands normally.
  await chatTab.click();
  await chatTab.click();
  await expect(page.locator(".chat-surface")).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Newest Cody chat");

  const persistedWidth = (await outerPanel.boundingBox())?.width ?? 0;
  await page.goto("/#chat-cody-new");
  await expect(page.locator(".chat-surface")).toBeVisible({ timeout: 30_000 });
  const reopenedPanel = page.locator(".right-chat").first();
  const reopenedOuterPanel = page.locator('[data-panel="true"]#right-chat');
  await expect(page.getByRole("button", { name: "Close Chat panel" }).first()).toBeVisible();
  await expect(reopenedPanel).toHaveAttribute("aria-hidden", "false");
  expect(Math.abs(((await reopenedOuterPanel.boundingBox())?.width ?? 0) - persistedWidth)).toBeLessThan(4);

  await panel.locator('button[aria-label^="Switch Chat panel thread, current:"]').click();
  await page.getByRole("menu", { name: /^Switch Chat panel thread, current: .* options$/ }).getByText("Older Cody chat", { exact: true }).click();
  await expect(reopenedPanel).toHaveAttribute("data-session-id", "cody-old");
  await expect(page).toHaveURL(/#chat-cody-new$/);

  await page.getByRole("button", { name: "Close Chat panel" }).first().click();
  await expect(reopenedPanel).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "Open Chat panel" }).click();
  await expect(page.getByRole("button", { name: "Close Chat panel" }).first()).toBeVisible();
  const reopenedAgainPanel = page.locator(".right-chat").first();
  await expect(reopenedAgainPanel).toHaveAttribute("aria-hidden", "false");
  await expect(reopenedAgainPanel).toHaveAttribute("data-session-id", "cody-old");
  await expect(reopenedAgainPanel.getByRole("textbox", { name: "Message" })).toHaveValue("Keep this Cody draft");

  await page.getByRole("button", { name: "Close Chat panel" }).first().click();
  await page.reload();
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  await expect(page.locator(".right-chat").first()).toHaveAttribute("aria-hidden", "true");
});

test("mobile uses one focus-trapped right drawer and returns focus", async ({ page }, testInfo) => {
  test.skip(!["pixel-5", "iphone-13"].includes(testInfo.project.name));
  await boot(page);

  const toggle = page.getByRole("button", { name: "Open Chat panel" });
  await toggle.focus();
  await toggle.click();

  const drawer = page.getByRole("dialog", { name: "Chat panel" });
  await expect(drawer).toBeVisible();
  await expect(page.locator('[data-panel="true"]#right-chat')).toHaveCount(0);

  await page.keyboard.press("Shift+Tab");
  await expect(drawer.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();

  // The drawer intentionally spans the full viewport width on narrow phones
  // (`.mobile-right-chat-drawer` under `@media (max-width: 480px)`), so on
  // Pixel 5 (393px) and iPhone 13 (390px) it covers the backdrop button at
  // EVERY coordinate once its slide-in has settled — its own header is what
  // sits at the top-left pixel.
  //
  // `force: true` does not rescue that, and believing it did is what kept
  // this line flaky across three CI runs (cave-m1mgi). `force` only skips
  // the actionability checks; Playwright still delivers a real mouse event
  // at real viewport coordinates, so the click lands on whatever is topmost
  // there, not on the located element. Whether that was the backdrop or the
  // drawer depended on how far `mobile-right-chat-in` (translateX(100%) → 0
  // over `--duration-base`, 180ms) had advanced at the instant the event was
  // delivered: a fast round trip caught the drawer still off-screen and
  // passed, a slow one hit the settled drawer and failed, which is why CI
  // lost both the first attempt and the in-process retry but passed on a
  // fresh job. Measured on this viewport with CDP CPU throttling, which is
  // what a loaded runner looks like: 0/10 failures unthrottled, 7/10 at 2×,
  // 10/10 at 4× and at 8×. The dispatch below was 0/40 across all four.
  //
  // So invoke the backdrop button's own click instead of aiming a pointer at
  // a pixel this layout never exposes. The assertion below is unchanged —
  // this is still "the backdrop's close handler dismisses the drawer" — it
  // just no longer races an animation to ask the question.
  await toggle.click();
  await expect(drawer).toBeVisible();
  const backdrop = page.getByRole("button", { name: "Close drawer" });
  await expect
    .poll(
      () =>
        page.evaluate(
          () => !!document.elementFromPoint(2, 2)?.closest("#shell-right-chat-drawer"),
        ),
      {
        message:
          "the full-width drawer should cover the backdrop at the top-left pixel; if it no longer does, a real pointer click on the backdrop is available again and should replace the dispatch below",
      },
    )
    .toBe(true);
  await backdrop.dispatchEvent("click");
  await expect(drawer).toBeHidden();
  await expect(backdrop).toHaveCount(0);
  await expect(toggle).toBeFocused();

  await toggle.click();
  await drawer.getByRole("button", { name: "Close Chat panel" }).click();
  await expect(drawer).toBeHidden();
});
