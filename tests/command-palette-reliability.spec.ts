import { expect, test, type Page } from "@playwright/test";

async function openPalette(page: Page) {
  await page.context().addCookies([
    { name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" },
  ]);
  await page.addInitScript(() => localStorage.setItem("cave:onboarding:dismissed", "1"));
  await page.route("**/api/familiars**", route => route.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/sessions/list**", route => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/board", route => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route("**/api/memory", route => route.fulfill({ json: { ok: true, entries: [] } }));
  await page.goto("/");
  // A server-rendered searchbox can appear before its click handler hydrates.
  await page.waitForFunction(() => performance.getEntriesByName("cave:first-interactive").length > 0);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.getByRole("searchbox", { name: "Search Cave", exact: true }).click();
  await expect(palette).toBeVisible();
  const input = palette.getByRole("combobox");
  await expect(input).toBeFocused();
  return { palette, input };
}

test("failed chat search recovers with Retry and Escape returns focus", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/chat/search?**", route => {
    attempts += 1;
    return route.fulfill(attempts === 1
      ? { status: 503, json: { ok: false } }
      : { json: { ok: true, hits: [{ sessionId: "recovered", title: "Recovered release chat", snippet: "release", matchCount: 1 }] } });
  });
  const { palette, input } = await openPalette(page);
  await input.fill("release");
  await expect(palette.getByRole("alert")).toContainText("Couldn't search chats");
  await palette.getByRole("button", { name: "Retry chat search" }).click();
  await expect(input).toBeFocused();
  await expect(palette.getByText("Recovered release chat", { exact: true })).toBeVisible();
  await expect(palette.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(page.getByRole("searchbox", { name: "Search Cave", exact: true })).toBeFocused();
});

test("typing a new query removes old hits while waiting for the response", async ({ page }) => {
  let releaseSecond!: () => void;
  const second = new Promise<void>(resolve => { releaseSecond = resolve; });
  await page.route("**/api/chat/search?**", async route => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "second") await second;
    await route.fulfill({ json: { ok: true, hits: [{ sessionId: query, title: `${query} chat result`, snippet: query, matchCount: 1 }] } });
  });
  const { palette, input } = await openPalette(page);
  await input.fill("first");
  await expect(palette.getByText("first chat result", { exact: true })).toBeVisible();
  await input.fill("second");
  try {
    await expect(palette.getByText("first chat result", { exact: true })).toHaveCount(0);
    await expect(palette.getByText("Searching chats…", { exact: true })).toBeVisible();
  } finally {
    releaseSecond();
  }
  await expect(palette.getByText("second chat result", { exact: true })).toBeVisible();
});

test("structured search recovers without an unused parallel chat search", async ({ page }) => {
  let chatRequests = 0;
  let globalRequests = 0;
  await page.route("**/api/chat/search?**", route => {
    chatRequests += 1;
    return route.fulfill({ json: { ok: true, hits: [] } });
  });
  await page.route("**/api/search", route => {
    globalRequests += 1;
    return route.fulfill(globalRequests === 1
      ? { status: 503, json: { ok: false } }
      : { json: { ok: true, results: [{ document: { id: "release", providerId: "board", entityType: "task", title: "Verify release", excerpt: "Release task", action: { href: "/?mode=board" } } }] } });
  });
  const { palette, input } = await openPalette(page);
  await input.fill("type:task release");
  await palette.getByRole("button", { name: "Retry global search" }).click();
  await expect(input).toBeFocused();
  await expect(palette.getByText("Verify release", { exact: true })).toBeVisible();
  expect(globalRequests).toBe(2);
  expect(chatRequests).toBe(0);
});

test("Tab cycles inside the palette and never lands on the results scroller or the page", async ({ page }) => {
  const { palette } = await openPalette(page);
  // Walk well past the palette's tab stops; every stop must stay inside the
  // aria-modal dialog. Chromium made the scrollable results list a Tab stop
  // the trap did not know about, and the next Tab left the modal (#5527).
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const active = document.activeElement;
      const dialog = document.querySelector('[role="dialog"][aria-label="Command palette"]');
      return {
        inside: Boolean(dialog && active && dialog.contains(active)),
        isResults: active?.getAttribute("role") === "listbox",
        tag: active?.tagName ?? "none",
      };
    });
    expect(where.inside, `Tab ${step + 1} stayed in the palette (on ${where.tag})`).toBe(true);
    expect(where.isResults, `Tab ${step + 1} skipped the results scroller`).toBe(false);
  }
  await expect(palette).toBeVisible();
});
