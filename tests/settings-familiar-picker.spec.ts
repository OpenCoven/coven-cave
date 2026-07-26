import { expect, test, type Locator, type Page } from "@playwright/test";

const FAMILIARS = Array.from({ length: 60 }, (_, index) => ({
  id: `familiar-${String(index + 1).padStart(2, "0")}`,
  display_name: `Familiar ${String(index + 1).padStart(2, "0")}`,
  role: index % 2 === 0 ? "Builder" : "Researcher",
  color: index % 2 === 0 ? "#8b7cf6" : "#57b8a6",
  icon: index % 2 === 0 ? "ph:sparkle-fill" : "ph:owl-fill",
  status: "active",
}));

async function gotoFamiliarSettings(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars", (route) =>
    route.fulfill({ json: { ok: true, familiars: FAMILIARS } }),
  );
  await page.goto("/settings#familiars");
  await expect(
    page.getByRole("complementary", { name: "Familiar roster" }),
  ).toBeVisible({
    timeout: 30_000,
  });
}

async function emulateVisualViewport(page: Page, width: number, height: number) {
  await page.addInitScript(
    ({ visualWidth, visualHeight }) => {
      const viewport = Object.assign(new EventTarget(), {
        width: visualWidth,
        height: visualHeight,
        offsetTop: 0,
        offsetLeft: 0,
        pageTop: 0,
        pageLeft: 0,
        scale: 1,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: viewport,
      });
    },
    { visualWidth: width, visualHeight: height },
  );
}

async function expectContained(inner: Locator, outer: Locator) {
  const [innerBox, outerBox] = await Promise.all([
    inner.boundingBox(),
    outer.boundingBox(),
  ]);
  expect(innerBox, "inner control has layout bounds").not.toBeNull();
  expect(outerBox, "container has layout bounds").not.toBeNull();
  expect(innerBox!.y, "control top stays inside the container").toBeGreaterThanOrEqual(
    outerBox!.y - 1,
  );
  expect(
    innerBox!.y + innerBox!.height,
    "control bottom stays inside the container",
  ).toBeLessThanOrEqual(outerBox!.y + outerBox!.height + 1);
}

test("a keyboard-shrunk visual viewport keeps roster controls and one full result", async ({ page }) => {
  // Mobile keyboards can shrink visualViewport without changing the CSS layout
  // viewport. The persistent roster must keep its controls fixed while only
  // the familiar list scrolls.
  await page.setViewportSize({ width: 390, height: 720 });
  await emulateVisualViewport(page, 390, 270);
  await gotoFamiliarSettings(page);

  const roster = page.getByRole("complementary", { name: "Familiar roster" });
  const search = page.getByRole("searchbox", { name: "Find a familiar" });
  const summon = page.getByRole("button", { name: "Summon familiar" });
  const results = page.getByRole("list", { name: "Familiars" });
  const options = results.locator(".settings-familiar-roster__option");
  const first = options.first();
  const last = options.last();

  await expect(options).toHaveCount(60);
  await expectContained(search, roster);
  await expectContained(summon, roster);

  // Wrapping from the first result to the last must scroll only the roster list
  // and leave the search and summon controls in place.
  await first.focus();
  await first.press("ArrowUp");
  await expect(last).toBeFocused();
  await expect(last).toContainText("Familiar 60");
  await expectContained(search, roster);
  await expectContained(summon, roster);
  const resultsBox = await results.boundingBox();
  expect(resultsBox, "the result scroller has layout bounds").not.toBeNull();
  expect(resultsBox!.height, "the roster preserves a full touch target").toBeGreaterThanOrEqual(44);
  await expectContained(last, results);

  const scrollState = await roster.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(scrollState.scrollTop, "the roster shell must stay fixed").toBe(0);
  expect(
    scrollState.scrollHeight - scrollState.clientHeight,
    "the roster shell itself must not be the scrolling region",
  ).toBeLessThanOrEqual(1);
});

test("a 60-familiar roster stays compact, searchable, and keyboard-selectable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoFamiliarSettings(page);

  const roster = page.getByRole("complementary", { name: "Familiar roster" });
  const summary = roster.locator(".settings-familiar-roster__summary");
  const results = page.getByRole("list", { name: "Familiars" });
  const options = results.locator(".settings-familiar-roster__option");
  await expect(summary).toHaveText("60 familiars");
  await expect(options).toHaveCount(60);
  const rosterBox = await roster.boundingBox();
  expect(rosterBox, "the familiar roster has layout bounds").not.toBeNull();
  expect(rosterBox!.width, "the persistent roster stays compact").toBeLessThanOrEqual(260);
  const resultsScroll = await results.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(resultsScroll.scrollHeight, "large rosters scroll inside the roster").toBeGreaterThan(
    resultsScroll.clientHeight,
  );

  await options.first().focus();
  await options.first().press("ArrowDown");
  await expect(options.nth(1)).toBeFocused();

  const search = page.getByRole("searchbox", { name: "Find a familiar" });
  await search.fill("Researcher familiar-60");
  const match = results.locator(".settings-familiar-roster__option");
  await expect(match).toHaveCount(1);
  await expect(match).toContainText("Familiar 60");
  await expect(match).toContainText("Researcher");

  await match.press("Enter");
  await expect(match).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Familiar 60" })).toBeVisible();
});
