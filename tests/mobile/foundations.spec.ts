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

  test("chat and tasks surfaces fit 360px without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto("/");
    await page.waitForSelector(".shell-frame");

    // Re-dispatch navigate-mode inside the poll: on a cold mobile load the
    // Workspace listener can attach AFTER .shell-frame appears, so a single
    // early dispatch is silently dropped and the check would measure Home.
    const targets: Array<[string, string]> = [
      ["chat", ".chat-surface"],
      ["board", ".board-shell"],
    ];
    for (const [surface, selector] of targets) {
      await page.waitForFunction(
        ({ mode, sel }) => {
          window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } }));
          return document.querySelector(sel) !== null;
        },
        { mode: surface, sel: selector },
        // Generous: the dev webServer compiles the chat/board chunks on first
        // hit, which can take >15s under CI's parallel project load.
        { timeout: 25000 },
      );
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      });
      expect(overflow, `no horizontal overflow on ${surface} at 360px viewport`).toBeLessThanOrEqual(0);
    }
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
    const surfaces = ["home", "chat", "board", "calendar", "browser", "terminal"];

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
    // Sweeping ~17 surfaces plus the /settings redirect all trigger first-hit
    // route compilation under next dev; on a cold cache that comfortably exceeds
    // the default per-test budget. Triple it so a slow compile reads as slow,
    // not broken.
    test.slow();
    // The in-shell WorkspaceMode set (src/lib/workspace-mode.ts). Keep in sync
    // when a new surface is added — a new mode with a render crash should turn
    // this red. Two modes are intentionally excluded: "journal" now opens the
    // Grimoire surface on its Journal tab (swept separately after the loop);
    // "grimoire" mounts a heavy Milkdown editor whose cold compile under next
    // dev makes this fast canary flaky — it has its own coverage (see cave
    // follow-up), and the journal step below exercises the same mount.
    const IN_SHELL_SURFACES = [
      "home", "agents", "chat", "groupchat", "board", "calendar", "inbox",
      "browser", "terminal", "github", "roles", "marketplace",
      "flow", "evals", "submissions", "retro", "capabilities",
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

    for (const surface of IN_SHELL_SURFACES) {
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

    // Assert no in-shell surface render-crashed while sweeping.
    expect(errors, `render crashes while sweeping surfaces:\n${errors.join("\n")}`).toEqual([]);

    // "journal" is now an in-shell surface: it opens the Grimoire surface on its
    // Journal tab (setGrimoireView("journal") → mode "grimoire"), no longer a
    // cross-document redirect to Settings. Assert the shell survives and the
    // Grimoire surface mounts (a render crash there unmounts to the error
    // boundary, so .grimoire-view never appears).
    current = "journal";
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "journal" } })),
    );
    await page.waitForTimeout(250);
    await expect(
      page.locator(".shell-frame"),
      "journal must keep the app shell mounted (no crash)",
    ).toBeVisible();
    // The Grimoire surface (with its Journal tab) mounts in-shell; its first-hit
    // compile under next dev can run well past 15s — wait generously.
    await expect(
      page.locator(".grimoire-view"),
      "journal opens the Grimoire surface without crashing",
    ).toBeVisible({ timeout: 45_000 });
  });
});
