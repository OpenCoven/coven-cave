import { expect, test } from "@playwright/test";

// Starter mobile spec. Loads the home route on the pixel-5 and
// iphone-13 viewport projects and asserts the phase 1 foundations:
//
//   - viewport meta is set to viewport-fit=cover so env() returns
//     non-zero on iOS
//   - the layout doesn't trigger horizontal scrolling at 360px
//   - desktop app chrome is headerless and does not create window scroll
//     on the primary shell surfaces
//   - the top-bar mobile-toggle is visible (since mobile viewports
//     still need drawer controls)
//
// Surface-specific specs (chat composer, board card-stack, calendar
// agenda, hover-tap) belong in their own files; this one is the
// "did the foundation land at all" canary.

test.describe("mobile foundations", () => {
  test("viewport meta sets viewport-fit=cover", async ({ page }) => {
    await page.goto("/");
    const viewport = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");
    expect(viewport, "viewport meta must include viewport-fit=cover").toMatch(
      /viewport-fit=cover/,
    );
  });

  test("home route fits 360px without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto("/");
    const overflow = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(overflow, "no horizontal overflow at 360px viewport").toBeLessThanOrEqual(0);
  });

  test("home route does not create window-level vertical scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.waitForSelector(".shell-frame");

    const metrics = await page.evaluate(() => {
      const frame = document.querySelector(".shell-frame");
      const frameRect = frame?.getBoundingClientRect();
      return {
        documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        bodyOverflow: document.body.scrollHeight - document.body.clientHeight,
        frameBottom: frameRect?.bottom ?? 0,
        viewportHeight: window.innerHeight,
      };
    });

    expect(metrics.documentOverflow, "document should not be vertically scrollable").toBeLessThanOrEqual(1);
    expect(metrics.bodyOverflow, "body should not be vertically scrollable").toBeLessThanOrEqual(1);
    expect(metrics.frameBottom, "app frame should fit the viewport").toBeLessThanOrEqual(metrics.viewportHeight + 1);
  });

  test("desktop shell is headerless and non-scrollable across primary surfaces", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.waitForSelector(".shell-frame");

    const surfaces = ["Home", "Familiars", "Board", "Calendar", "Browser", "Terminal", "Code"];
    const sidebar = page.locator(".sidebar-nav-scroll");

    for (const surface of surfaces) {
      if (surface !== "Home") {
        await sidebar.getByRole("button", { name: new RegExp(`^${surface}\\b`) }).click();
      }

      await expect(page.locator(".top-bar"), `desktop top bar should stay hidden on ${surface}`).toBeHidden();

      const metrics = await page.evaluate(() => {
        const frame = document.querySelector(".shell-frame");
        const frameRect = frame?.getBoundingClientRect();
        return {
          documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          bodyOverflow: document.body.scrollHeight - document.body.clientHeight,
          frameBottom: frameRect?.bottom ?? 0,
          viewportHeight: window.innerHeight,
        };
      });

      expect(metrics.documentOverflow, `${surface} should not create document vertical scroll`).toBeLessThanOrEqual(1);
      expect(metrics.bodyOverflow, `${surface} should not create body vertical scroll`).toBeLessThanOrEqual(1);
      expect(metrics.frameBottom, `${surface} app frame should fit the viewport`).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    }
  });

  test("library document rail scrolls inside the right panel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    const docs = Array.from({ length: 42 }, (_, index) => ({
      id: `doc-${index}`,
      title: `Knowledge graph source ${index + 1}`,
      familiar: "sage",
      collection: "all",
      modifiedAt: new Date(Date.now() - index * 60_000).toISOString(),
      tags: index % 4 === 0 ? ["coven-cave", "knowledge-graph"] : [],
      excerpt: "A deliberately long library entry used to prove the right-side document rail owns its scrolling.",
    }));

    await page.route("**/api/library?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          docs,
          collections: [
            {
              id: "all",
              label: "All",
              path: "/tmp/coven-cave-test-library",
              familiar: "sage",
            },
          ],
        }),
      });
    });

    // The Library surface is an addon, gated out of the sidebar by default —
    // enable it (passthrough-patch the config) so the nav entry renders.
    await page.route("**/api/config**", async (route) => {
      const res = await route.fetch();
      const json = await res.json().catch(() => ({}));
      const config = { ...(json.config ?? {}), addons: { ...(json.config?.addons ?? {}), library: true } };
      await route.fulfill({ json: { ...json, ok: true, config } });
    });

    await page.goto("/");
    await page.waitForSelector(".shell-frame");

    const sidebar = page.locator(".sidebar-nav-scroll");
    await sidebar.getByRole("button", { name: /^Library\b/ }).click();
    await page.waitForSelector(".library-shell");
    await page.locator(".library-rail-item").filter({ hasText: /^All/ }).first().click();
    await expect(page.getByPlaceholder("Search documents…")).toBeVisible();
    await expect(page.locator(".library-doclist-item")).toHaveCount(docs.length);

    const metrics = await page.evaluate(() => {
      const panel = document.querySelector(".library-list-panel, .library-browse-canvas");
      const doclist = document.querySelector(".library-doclist");
      const items = document.querySelector(".library-doclist-items");
      const panelRect = panel?.getBoundingClientRect();
      const doclistRect = doclist?.getBoundingClientRect();
      const itemsRect = items?.getBoundingClientRect();
      const itemsStyle = items ? window.getComputedStyle(items) : null;

      return {
        documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        bodyOverflow: document.body.scrollHeight - document.body.clientHeight,
        panelHeight: panelRect?.height ?? 0,
        doclistHeight: doclistRect?.height ?? 0,
        itemsHeight: itemsRect?.height ?? 0,
        itemsScrollHeight: items?.scrollHeight ?? 0,
        itemsOverflowY: itemsStyle?.overflowY ?? "",
      };
    });

    expect(metrics.documentOverflow, "Library must not push scrolling onto the document").toBeLessThanOrEqual(1);
    expect(metrics.bodyOverflow, "Library must not push scrolling onto body").toBeLessThanOrEqual(1);
    expect(metrics.doclistHeight, "Document list should stay bounded by the right panel").toBeLessThanOrEqual(metrics.panelHeight + 1);
    expect(metrics.itemsOverflowY, "Document rows should be the inner scroll container").toBe("auto");
    expect(metrics.itemsScrollHeight, "Document rows should have more content than visible space").toBeGreaterThan(metrics.itemsHeight + 1);
  });

  test("persisted screen magnification scales the app without window scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.setItem("cave:screen-scale", "125");
    });
    await page.reload();
    await page.waitForSelector(".shell-frame");

    const metrics = await page.evaluate(() => {
      const frame = document.querySelector(".shell-frame");
      const frameRect = frame?.getBoundingClientRect();
      return {
        scale: document.documentElement.getAttribute("data-screen-scale"),
        // Magnification is rem-based root font scaling (not an app-wide zoom,
        // which broke getBoundingClientRect math): :root sets --cave-screen-scale
        // and html font-size = calc(16px * var). 125% → 20px root font.
        scaleVar: getComputedStyle(document.documentElement).getPropertyValue("--cave-screen-scale").trim(),
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        bodyOverflow: document.body.scrollHeight - document.body.clientHeight,
        frameBottom: frameRect?.bottom ?? 0,
        viewportHeight: window.innerHeight,
      };
    });

    expect(metrics.scale).toBe("125");
    expect(metrics.scaleVar).toBe("1.25");
    expect(metrics.rootFontSize).toBe("20px");
    expect(metrics.documentOverflow, "document should not be vertically scrollable at 125%").toBeLessThanOrEqual(1);
    expect(metrics.bodyOverflow, "body should not be vertically scrollable at 125%").toBeLessThanOrEqual(1);
    expect(metrics.frameBottom, "magnified app frame should still fit the viewport").toBeLessThanOrEqual(metrics.viewportHeight + 1);
  });

  test("mobile drawer toggles render on phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto("/");
    // The .top-bar__mobile-toggle class is hidden by default and revealed
    // under the mobile/tablet breakpoint. At least one (the nav hamburger)
    // is always wired by workspace.tsx.
    const toggles = page.locator(".top-bar__mobile-toggle");
    await expect(toggles.first()).toBeVisible();
  });
});
