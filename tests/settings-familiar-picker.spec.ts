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
  await expect(page.locator(".familiar-studio-picker__trigger")).toBeVisible({
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
  expect(outerBox, "popover has layout bounds").not.toBeNull();
  expect(innerBox!.y, "control top stays inside the popover").toBeGreaterThanOrEqual(
    outerBox!.y - 1,
  );
  expect(
    innerBox!.y + innerBox!.height,
    "control bottom stays inside the popover",
  ).toBeLessThanOrEqual(outerBox!.y + outerBox!.height + 1);
}

test("a keyboard-shrunk visual viewport keeps fixed controls and one full result", async ({ page }) => {
  // Mobile keyboards can shrink visualViewport without changing the CSS layout
  // viewport. Keep the latter tall so a max-height media query cannot make this
  // pass accidentally; Popover must propagate its computed available height.
  await page.setViewportSize({ width: 390, height: 720 });
  // 270px puts both sides of the anchor below Popover's 120px safety floor.
  await emulateVisualViewport(page, 390, 270);
  await gotoFamiliarSettings(page);

  await page.locator(".familiar-studio-picker__trigger").click();
  const popover = page.locator(".familiar-studio-picker__popover");
  const search = page.getByRole("combobox", { name: "Search familiars" });
  const summon = page.getByRole("button", { name: "Summon familiar" });
  const results = page.getByRole("listbox", { name: "Familiars" });
  await expect(popover).toBeVisible();
  await expect.poll(() => popover.evaluate((element) => element.style.maxHeight)).toBe("120px");

  await expectContained(search, popover);
  await expectContained(summon, popover);

  // Wrapping from the first result to the last scrolls the result list. It must
  // not scroll the containing dialog and carry the still-focused search field
  // out of view (the failure mode seen with mobile keyboards / short windows).
  await search.press("ArrowUp");
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    "settings-familiar-picker-option-59",
  );
  await expectContained(search, popover);
  await expectContained(summon, popover);
  const highlighted = page.locator(".familiar-studio-picker__option[data-highlighted]");
  await expect(highlighted).toContainText("Familiar 60");
  const resultsBox = await results.boundingBox();
  expect(resultsBox, "the result scroller has layout bounds").not.toBeNull();
  expect(resultsBox!.height, "the exact floor preserves a full 44px option").toBeGreaterThanOrEqual(44);
  await expectContained(highlighted, results);

  const scrollState = await popover.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(scrollState.scrollTop, "the outer dialog must stay fixed").toBe(0);
  expect(
    scrollState.scrollHeight - scrollState.clientHeight,
    "the outer dialog itself must not be the scrolling region",
  ).toBeLessThanOrEqual(1);
});

test("a 60-familiar roster stays compact, searchable, and keyboard-selectable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoFamiliarSettings(page);

  const trigger = page.locator(".familiar-studio-picker__trigger");
  await expect(trigger).toContainText("60 familiars");
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox, "the familiar trigger has layout bounds").not.toBeNull();
  expect(triggerBox!.height, "roster size must not grow the Settings header").toBeLessThanOrEqual(50);

  await trigger.click();
  const results = page.getByRole("listbox", { name: "Familiars" });
  await expect(results.getByRole("option")).toHaveCount(60);
  const resultsScroll = await results.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(resultsScroll.clientHeight, "the roster has a bounded viewport").toBeLessThanOrEqual(320);
  expect(resultsScroll.scrollHeight, "large rosters scroll inside the popup").toBeGreaterThan(
    resultsScroll.clientHeight,
  );

  const search = page.getByRole("combobox", { name: "Search familiars" });
  await search.fill("Researcher familiar-60");
  const match = results.getByRole("option");
  await expect(match).toHaveCount(1);
  await expect(match).toContainText("Familiar 60");
  await expect(match).toContainText("Researcher");
  await expect(match).toContainText("familiar-60");

  await search.press("Enter");
  await expect(page.locator(".familiar-studio-picker__popover")).toHaveCount(0);
  await expect(trigger).toContainText("Familiar 60");
});
