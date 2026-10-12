import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function boot(page: Page, code = "not-connected") {
  const actions: string[] = [];
  const oauthStarts: Array<Record<string, unknown>> = [];
  let saved = false;
  let settingsReads = 0;
  let connected = false;
  let revoked = false;
  const draft = {
    id: "11111111-1111-4111-8111-111111111111", text: "A considered update.", status: "draft",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "echo");
  });
  await page.route("**/api/familiars**", route => route.fulfill({ json: { ok: true, familiars: [{
    id: "echo", display_name: "Echo", role: "Messenger", status: "active", icon: "ph:sparkle-fill", xPublishEnabled: true,
  }] } }));
  await page.route("**/api/sessions/list**", route => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route(/\/api\/roles(?:\?|$)/, route => route.fulfill({ json: { roles: [] } }));
  await page.route("**/api/x/connection", route => {
    settingsReads++;
    return route.fulfill({ json: code === "capability-disabled" || code === "missing-scope"
      ? { configured: true, connected: true, activeFlow: false, account: { id: "val", username: "val", name: "Val" }, scopes: ["tweet.read", "users.read", "offline.access", ...(code === "missing-scope" ? [] : ["tweet.write"])] }
      : { configured: true, connected: false, activeFlow: false } });
  });
  await page.route("**/api/x/oauth/start", route => {
    if (route.request().method() === "POST") oauthStarts.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { ok: false, error: "Authorization stopped by test fixture." } });
  });
  await page.route("**/api/x/publish**", route => {
    if (route.request().method() === "GET") return revoked
      ? route.fulfill({ status: 403, json: { ok: false, code, error: "Enable X publishing for this familiar" } })
      : route.fulfill({ json: { ok: true, publications: saved ? [draft] : [] } });
    const body = route.request().postDataJSON();
    actions.push(body.action);
    if (body.action === "draft") {
      saved = true;
      return route.fulfill({ json: { ok: true, publication: draft, confirmationToken: connected ? "fresh-account-token" : "old-token", ...(connected ? { account: { username: "val" } } : {}) } });
    }
    revoked = code === "capability-disabled";
    return route.fulfill({ status: 409, json: { ok: false, code, error: "X account is not connected", retryAt: "2030-01-01T12:30:00.000Z" } });
  });
  await page.goto("/");
  await page.locator("#shell-main-content").waitFor({ timeout: 60_000 });
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "surface:x-comms" } })));
    await expect(page.getByRole("button", { name: "Live publishing", exact: true })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("button", { name: "Live publishing", exact: true }).click();
  await page.getByRole("textbox", { name: "Post text" }).fill(draft.text);
  await page.getByRole("button", { name: "Review this wording", exact: true }).click();
  await page.getByRole("button", { name: "Publish to X", exact: true }).click();
  return { actions, oauthStarts, settingsReads: () => settingsReads, connect: () => { connected = true; revoked = false; } };
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
  test(`connection recovery preserves the draft and modal focus at ${viewport.width}px`, async ({ page, browserName }, testInfo) => {
    await page.setViewportSize(viewport);
    const fixture = await boot(page);
    await page.evaluate(({ theme, mode }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.mode = mode;
    }, { theme: viewport.width === 768 ? "tide" : "coven", mode: viewport.width === 390 ? "light" : "dark" });
    const confirm = page.getByRole("dialog", { name: "Confirm X post", exact: true });
    await expect(confirm.getByText("Connect X to publish", { exact: true })).toBeVisible();
    expect(fixture.settingsReads()).toBe(0);
    const openSettings = confirm.getByRole("button", { name: "Open X settings" });
    await openSettings.click();
    const settings = page.getByRole("dialog", { name: "X connection settings", exact: true });
    await expect(settings.getByRole("button", { name: "Connect X", exact: true })).toBeVisible();
    await expect.poll(() => settings.evaluate(el => el.contains(document.activeElement))).toBe(true);
    // Keyboard navigation stays in the top modal; closing returns to its trigger.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
      await expect.poll(() => settings.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
    await expect(openSettings).toBeFocused();
    await expect(confirm.getByRole("button", { name: "Review again" })).toBeVisible();
    expect(fixture.actions).toEqual(["draft", "publish"]);
    await expect(page.getByRole("textbox", { name: "Post text" })).toHaveValue("A considered update.");
    await expect.poll(() => confirm.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`recovery-${viewport.width}.png`), fullPage: true });
    fixture.connect();
    await confirm.getByRole("button", { name: "Review again" }).click();
    await expect(confirm.getByText("@val", { exact: true })).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Publish to X", exact: true })).toBeEnabled();
    expect(fixture.actions).toEqual(["draft", "publish", "draft"]);
    await confirm.getByRole("button", { name: "Publish to X", exact: true }).click();
    await expect(confirm.getByText("Connect X to publish", { exact: true })).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByText("Connect X to publish", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open X settings" }).click();
    await expect(settings.getByRole("button", { name: "Connect X", exact: true })).toBeVisible();
    await settings.getByRole("button", { name: "Back to draft" }).click();
    await expect(page.getByRole("button", { name: "Open X settings" })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Post text" })).toHaveValue("A considered update.");
    expect(fixture.actions).toEqual(["draft", "publish", "draft", "publish"]);
    await page.screenshot({ path: testInfo.outputPath(`inline-recovery-${viewport.width}.png`), fullPage: true });
  });
}


test("a revoked grant keeps recovery reachable and connected settings styled on fresh entry", async ({ page }, testInfo) => {
  const fixture = await boot(page, "capability-disabled");
  await expect(page.getByText("Allow publishing on X", { exact: true })).toBeVisible();
  await expect(page.getByText("Your draft wording", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Post text" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open X settings" }).click();
  const settings = page.getByRole("dialog", { name: "X connection settings", exact: true });
  const toggle = settings.getByRole("switch", { name: "Allow X publishing for Echo", exact: true });
  await expect(toggle).toBeVisible();
  await expect.poll(() => toggle.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(30);
  await expect.poll(() => toggle.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(18);
  await expect.poll(() => toggle.locator("span").evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(12);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => toggle.evaluate(el => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.001);
  await page.screenshot({ path: testInfo.outputPath("connected-settings.png"), fullPage: true });
  await settings.getByRole("button", { name: "Back to draft" }).click();
  fixture.connect();
  await page.getByRole("button", { name: "Refresh post history" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm X post", exact: true });
  await expect(confirm.getByRole("button", { name: "Review again", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Post text" })).toHaveValue("A considered update.");
  expect(fixture.actions).toEqual(["draft", "publish"]);
});


test("reconnecting with a missing write scope requests publishing access without reposting", async ({ page }) => {
  const fixture = await boot(page, "missing-scope");
  await page.getByRole("button", { name: "Open X settings" }).click();
  const settings = page.getByRole("dialog", { name: "X connection settings", exact: true });
  await expect(settings.getByRole("switch", { name: "Allow X publishing for Echo" })).toBeChecked();
  await settings.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect.poll(() => fixture.oauthStarts.length).toBe(1);
  expect(fixture.oauthStarts[0].capability).toBe("publish");
  await expect(settings.getByText("Authorization stopped by test fixture.")).toBeVisible();
  await settings.getByRole("button", { name: "Back to draft" }).click();
  await expect(page.getByRole("textbox", { name: "Post text" })).toHaveValue("A considered update.");
  expect(fixture.actions).toEqual(["draft", "publish"]);
});
