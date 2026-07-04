import { expect, test, type Page } from "@playwright/test";

// PR 3 / Task 3: below the mobile breakpoint the code rail (WorkspaceRail) has
// no room for the third-column Panel, so it is presented as a full-height
// right-edge slide-over sheet over the full-screen chat, opened by an explicit
// toggle button in the chat scope-tabs header and dismissed by backdrop tap /
// Escape / the rail's own collapse control.
//
// This spec lives under tests/mobile/ because Playwright's mobile projects
// (pixel-5 / iphone-13) only match specs there (see playwright.config.ts
// testMatch). It is guarded mobile-only so the desktop project — which also
// matches this path — self-skips (the desktop third-column path is covered in
// tests/code-rail.spec.ts). Daemon-less: onboarding dismissed, APIs mocked.

const ISO = "2026-06-12T10:00:00.000Z";

const REPO_SESSION = {
  id: "s-repo",
  title: "Refactor auth flow",
  project_root: "/repo/alpha",
  status: "running",
  origin: "chat",
  harness: "claude",
  familiarId: "nova",
  model: "openclaw-local",
  runtime: "local",
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

async function base(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:code-rail:pinned:v1", "false");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [REPO_SESSION] } }),
  );
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: { turns: [{ id: "t1", role: "assistant", text: "On it.", createdAt: ISO }] },
        context: {},
      },
    }),
  );
  // /api/changes returns two modified files so the rail is available (repo-linked)
  // and the change-count badge shows.
  await page.route("**/api/changes**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        repo: true,
        repoRoot: "/repo/alpha",
        files: [
          { path: "src/a.ts", status: "modified" },
          { path: "src/b.ts", status: "modified" },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
}

// Navigate to the standalone chat surface and open the repo session. On mobile
// the surface switch is driven by the cave:navigate-mode custom event (there's
// no Meta+2). Re-dispatch inside the poll — on a cold mobile load the Workspace
// listener can attach after .shell-frame appears.
async function openRepoChat(page: Page) {
  await page.waitForFunction(
    () => {
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } }));
      return document.querySelector(".chat-surface") !== null;
    },
    undefined,
    { timeout: 25_000 },
  );
  // The chat surface's main region shows the Sessions list; open the repo
  // session from there (the left sidebar's copy is off-screen on mobile). The
  // session card's accessible name embeds the title.
  const surface = page.locator(".chat-surface");
  await surface
    .getByRole("button", { name: /^Reorder chat Refactor auth flow/ })
    .first()
    .click();
  await page.waitForTimeout(700);
}

test.describe("mobile code-rail slide-over sheet", () => {
  test("toggle opens the sheet; no inline rail; backdrop closes it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop", "mobile-only");
    await base(page);
    await openRepoChat(page);

    // On mobile the third-column rail Panel is NOT rendered (no room). Instead
    // the toggle affordance appears for the repo-linked session. The toggle's
    // accessible name flips Show↔Hide with open state, so match either.
    const toggle = page.getByRole("button", { name: /^(Show|Hide) code rail$/ });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".workspace-rail")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Opening: the toggle reveals the slide-over sheet (role=dialog) hosting the
    // WorkspaceRail, and aria-expanded flips true.
    await toggle.click();
    const sheet = page.getByRole("dialog", { name: "Code rail" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".workspace-rail")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The pin control is meaningless in a transient sheet → hidden.
    await expect(sheet.getByRole("button", { name: /Pin code rail/ })).toHaveCount(0);

    // Dismiss: tapping the backdrop closes the sheet and restores aria-expanded.
    // The backdrop button spans the full viewport but the sheet panel overlays
    // its right portion, so click the exposed top-left strip (center would land
    // on the panel and be intercepted).
    await page.getByRole("button", { name: "Close code rail" }).click({ position: { x: 8, y: 8 } });
    await expect(page.getByRole("dialog", { name: "Code rail" })).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
