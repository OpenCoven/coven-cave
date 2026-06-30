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
  test.beforeEach(async ({ page }) => {
    // On a fresh profile (CI) the onboarding overlay covers the app and
    // intercepts clicks on the sidebar/shell — dismiss it before each test.
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
    });
  });

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
    // Guard against render crashes on any surface. The chrome/layout assertions
    // below all PASS when a surface infinite-loops or throws, because React
    // tears the app down to its error boundary — and a centered "couldn't load"
    // view has a hidden top bar, no overflow, and fits the viewport. So without
    // this, a surface can be fully broken and the test stays green (exactly how
    // the #2162 CodeSidebar `useSyncExternalStore` infinite loop reached main).
    // Catch both uncaught exceptions and the fatal React render-error class
    // (which an error boundary swallows into a console.error rather than a
    // pageerror). Benign console noise (failed daemon-less fetches) is ignored.
    const pageErrors: string[] = [];
    const fatalConsole: string[] = [];
    const FATAL_RENDER = /maximum update depth|too many re-?renders|minified react error|getsnapshot should be cached|rendered (more|fewer) hooks|hooks can only be called/i;
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" && FATAL_RENDER.test(msg.text())) fatalConsole.push(msg.text());
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.waitForSelector(".shell-frame");

    // Drive by mode id via the navigate-mode event rather than clicking nav
    // rows: most of these surfaces are now opt-in add-ons (hidden from the nav by
    // default), but they still render when navigated — so this stays a true
    // cross-surface chrome check without depending on which rows are visible.
    const surfaces = ["home", "chat", "board", "calendar", "browser", "terminal", "code"];

    for (const surface of surfaces) {
      await page.evaluate(
        (mode) => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } })),
        surface,
      );
      await page.waitForTimeout(200);

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

    // No surface may crash the app. (These would be invisible to the layout
    // assertions above — see the note at the top of this test.)
    expect(pageErrors, `uncaught page errors while sweeping surfaces:\n${pageErrors.join("\n")}`).toEqual([]);
    expect(fatalConsole, `fatal React render errors while sweeping surfaces:\n${fatalConsole.join("\n")}`).toEqual([]);
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
    // Wait for the ScreenMagnificationController effect to fire and stamp the
    // data-screen-scale attribute on <html> before reading metrics.
    await page.waitForFunction(
      () => document.documentElement.hasAttribute("data-screen-scale"),
      { timeout: 5000 },
    );

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

  // EVERY workspace surface must mount without a render crash. The
  // "desktop shell is headerless…" test above guards the 7 primary surfaces,
  // but a render loop / thrown effect / hook violation on any of the other
  // surfaces (familiars, group chat, automations, github, roles, marketplace,
  // flow, evals, retro, capabilities, journal, …) would never be seen — nothing
  // navigates to them, and CI's build doesn't render. This sweeps ALL of
  // WorkspaceMode and fails on any crash, daemon-less. It does NOT assert
  // layout (some surfaces legitimately scroll); it only asserts "didn't crash".
  test("no workspace surface crashes on navigation", async ({ page }) => {
    // The complete WorkspaceMode set (src/lib/workspace-mode.ts). Keep in sync
    // when a new surface is added — a new mode with a render crash should turn
    // this red.
    const ALL_SURFACES = [
      "home", "agents", "chat", "groupchat", "board", "calendar", "inbox",
      "library", "browser", "terminal", "code", "github", "roles", "marketplace",
      "flow", "evals", "submissions", "retro", "capabilities", "journal",
    ];

    const FATAL_RENDER = /maximum update depth|too many re-?renders|minified react error|getsnapshot should be cached|rendered (more|fewer) hooks|hooks can only be called/i;
    const errors: string[] = [];
    let current = "(initial)";
    page.on("pageerror", (err) => errors.push(`[${current}] pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" && FATAL_RENDER.test(msg.text())) errors.push(`[${current}] ${msg.text()}`);
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.waitForSelector(".shell-frame");

    for (const surface of ALL_SURFACES) {
      current = surface;
      await page.evaluate(
        (mode) => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } })),
        surface,
      );
      await page.waitForTimeout(250);
      // The shell frame must survive every navigation (a render crash unmounts
      // the app to the top-level error boundary, removing it).
      await expect(page.locator(".shell-frame"), `${surface} must keep the app shell mounted (no crash)`).toBeVisible();
    }

    expect(errors, `render crashes while sweeping surfaces:\n${errors.join("\n")}`).toEqual([]);
  });
});
