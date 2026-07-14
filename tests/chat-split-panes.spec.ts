import { expect, test, type Page } from "@playwright/test";

// Multipane chat (cave-e3dj): two conversations side by side, driven entirely
// from the keyboard, surviving a reload.
//
//   1. Open one conversation as the primary chat, then ⌥↵ on a thread-rail row
//      opens a second conversation in a split pane — both transcripts visible
//      at once, focus lands on the new pane.
//   2. ⌥⌘← / ⌥⌘→ move the logical pane focus (data-focused affordance).
//   3. Reload → the split (and the primary, via the #chat- hash) is restored
//      from localStorage.
//   4. ⌥⌘W closes the focused secondary pane and the strip collapses to solo.
//
// Runs daemon-less: familiars/sessions/conversations come from page.route
// mocks, per the e2e house rules.

const ISO = "2026-06-12T10:00:00.000Z";

function session(id: string, title: string) {
  return {
    id,
    title,
    status: "idle",
    project_root: "/Users/dev/Documents/GitHub/OpenCoven/coven-cave",
    harness: "claude",
    familiarId: "nova",
    model: "openclaw-local",
    runtime: "local:/Users/dev/Documents/GitHub/OpenCoven/coven-cave",
    exit_code: null,
    archived_at: null,
    created_at: ISO,
    updated_at: ISO,
  };
}

const SESSIONS = [
  session("s-alpha", "Alpha planning thread"),
  session("s-beta", "Beta review thread"),
];

async function setup(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    // Keep the nav expanded so the chat surface keeps its full width.
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: SESSIONS } }),
  );
  await page.route("**/api/chat/conversation/**", (route) => {
    const url = route.request().url();
    const which = url.includes("s-alpha") ? "Alpha reply text" : "Beta reply text";
    return route.fulfill({
      json: {
        ok: true,
        conversation: { turns: [{ id: `t-${which}`, role: "assistant", text: which, createdAt: ISO }] },
      },
    });
  });
}

async function openChatSurface(page: Page) {
  await page.goto("/");
  await page.waitForTimeout(500);
  await page.keyboard.press("Meta+2");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
}

const pane = (page: Page, id: string) => page.locator(`[data-chat-split-pane="${id}"]`);
const focusedPane = (page: Page) => page.locator('[data-chat-split-pane][data-focused="true"]');

test("keyboard split: two conversations side by side, focus moves, reload restores, ⌥⌘W closes", async ({ page }) => {
  await setup(page);
  await openChatSurface(page);

  // The shell nav lists the chat threads (the live thread rail).
  const alphaRow = page.getByRole("button", { name: /Alpha planning thread/ }).first();
  await expect(alphaRow).toBeVisible({ timeout: 30_000 });

  // Open Alpha as the primary chat.
  await alphaRow.click();
  await expect(page.getByText("Alpha reply text")).toBeVisible({ timeout: 30_000 });

  // ⌥↵ on the Beta row opens it in a split pane (keyboard twin of drag-to-split).
  const betaRow = page.getByRole("button", { name: /Beta review thread/ }).first();
  await betaRow.focus();
  await page.keyboard.press("Alt+Enter");

  // Both panes exist and both transcripts are visible at the same time.
  await expect(pane(page, "primary")).toBeVisible({ timeout: 15_000 });
  await expect(pane(page, "s-beta")).toBeVisible();
  await expect(page.getByText("Alpha reply text")).toBeVisible();
  await expect(page.getByText("Beta reply text")).toBeVisible({ timeout: 30_000 });

  // The new pane holds the logical focus; ⌥⌘← moves it back to the primary.
  await expect(pane(page, "s-beta")).toHaveAttribute("data-focused", "true");
  await page.keyboard.press("Alt+Meta+ArrowLeft");
  await expect(pane(page, "primary")).toHaveAttribute("data-focused", "true");
  await expect(focusedPane(page)).toHaveCount(1);

  // Reload: the split layout comes back from localStorage (and the primary
  // conversation from the #chat- hash).
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  await expect(pane(page, "primary")).toBeVisible({ timeout: 30_000 });
  await expect(pane(page, "s-beta")).toBeVisible();
  await expect(page.getByText("Beta reply text")).toBeVisible({ timeout: 30_000 });

  // ⌥⌘→ focuses the secondary pane, ⌥⌘W closes it → back to a solo chat
  // (solo renders without the pane wrapper at all). Composer autofocus may
  // land logical focus in either pane after a reload — click into the
  // primary first so the arrow move is deterministic.
  await page.getByText("Alpha reply text").click();
  await expect(pane(page, "primary")).toHaveAttribute("data-focused", "true");
  await page.keyboard.press("Alt+Meta+ArrowRight");
  await expect(pane(page, "s-beta")).toHaveAttribute("data-focused", "true");
  await page.keyboard.press("Alt+Meta+KeyW");
  await expect(page.locator("[data-chat-split-pane]")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText("Beta reply text")).toBeHidden();
  await expect(page.getByText("Alpha reply text")).toBeVisible();
});
