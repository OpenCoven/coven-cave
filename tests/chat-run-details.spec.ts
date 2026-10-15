import { expect, test, type Page } from "@playwright/test";

// #6026: the runtime, model and control trail under a reply is one muted
// "Run details" disclosure instead of up to nine pills. Closed, its one line
// sits inside the reading column on the narrowest desktop pane; open, every
// line the pills carried is listed and a long value wraps inside the column.
// (#6011 had made the pills wrap; the disclosure replaces them.)

const SESSION_ID = "run-details";
const ISO = "2026-10-15T10:00:00.000Z";
const PROJECT_ROOT = "/repo";
const LONG_REASON = "Coven forwarded the selected model; downstream acceptance was not confirmed.";

async function openChat(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:shell:nav-open", "0");
    localStorage.setItem("cave:shell:nav-open:source", "user");
    localStorage.setItem("cave:chat-rail:open", "true");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({
    json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] },
  }));
  await page.route("**/api/projects**", (route) => route.fulfill({
    json: { ok: true, projects: [{ id: "p1", name: "Cave", root: PROJECT_ROOT, access: "write" }] },
  }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({
    json: { ok: true, sessions: [{
      id: SESSION_ID, title: "Run details", familiarId: "nova", status: "idle",
      project_root: PROJECT_ROOT, harness: "codex", model: "openai/gpt-6-astra",
      runtime: `local:${PROJECT_ROOT}`, exit_code: null, archived_at: null,
      created_at: ISO, updated_at: ISO,
    }] },
  }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({
    json: {
      ok: true,
      context: { task: null, tasks: [], github: [] },
      conversation: {
        familiarId: "nova",
        activeLeafId: "answer",
        turns: [
          { id: "request", parentId: null, role: "user", text: "Compare the hosted recipe", createdAt: ISO },
          {
            id: "answer", parentId: "request", role: "assistant", createdAt: ISO,
            text: "The comparison needs the hosted recipe.",
            responseMetadata: {
              familiarId: "nova", harness: "codex", model: "openai/gpt-6-astra", runtime: `local:${PROJECT_ROOT}`,
              runtimeIdentity: { schemaVersion: 1, harness: "codex" },
              desiredModel: "openai/gpt-6-astra",
              modelApplicationState: "pending",
              modelSource: "familiar-default",
              modelApplicationReason: LONG_REASON,
            },
          },
        ],
      },
    },
  }));
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-turn-run-details] > summary")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".shell-frame")).toHaveAttribute("data-settled", "");
}

function geometry(page: Page) {
  return page.locator("[data-turn-run-details]").first().evaluate((details) => {
    const transcriptRight = details.closest(".cave-chat-transcript")?.getBoundingClientRect().right ?? 0;
    const summary = details.querySelector("summary")!.getBoundingClientRect();
    const values = [...details.querySelectorAll("dd")].map((dd) => {
      const box = dd.getBoundingClientRect();
      return { text: dd.textContent?.trim() ?? "", right: box.right, height: box.height };
    });
    return { transcriptRight, summaryRight: summary.right, summaryHeight: summary.height, values };
  });
}

for (const viewport of [{ width: 1024, height: 768 }, { width: 1100, height: 800 }]) {
  test.describe(`run details on a ${viewport.width}px pane`, () => {
    test.skip(({ isMobile }) => isMobile, "desktop pane geometry");
    test.use({ viewport });

    test("one closed line fits the column; opened, every line wraps inside it", async ({ page }) => {
      await openChat(page);
      // Opening the nav narrows the Chat pane to its tightest desktop width.
      const toggle = page.locator(".shell-top-toggle--nav");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");

      const details = page.locator("[data-turn-run-details]").first();
      const summary = details.locator("summary");
      // Closed: the trail is one line naming the runtime, the state and the
      // gaps; the long reason is not on screen.
      // Gaps: version not reported, model unavailable, activity not recorded.
      await expect(summary).toHaveText("Run details · codex · model pending · 3 unverified");
      await expect(page.getByText(LONG_REASON)).toBeHidden();
      await expect.poll(async () => {
        const g = await geometry(page);
        return g.summaryRight <= g.transcriptRight + 1 && g.summaryHeight <= 40;
      }, "the closed line sits inside the reading column on one row").toBe(true);

      // Open with the keyboard; the values stay inside the column.
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(details).toHaveAttribute("open", "");
      await expect(page.getByText(LONG_REASON)).toBeVisible();
      await expect(details.locator("dt", { hasText: "Runtime-reported model" })).toBeVisible();
      await expect(details.locator("dt", { hasText: "Activity support" })).toBeVisible();
      await expect.poll(async () => {
        const g = await geometry(page);
        return g.values.length >= 7 && g.values.every((value) => value.right <= g.transcriptRight + 1);
      }, "every opened value ends inside the reading column").toBe(true);
      // The long reason is a full-width note row; whether it takes one line or
      // two depends on the pane, and either way it ends inside the column.
      const opened = await geometry(page);
      const reason = opened.values.find((value) => value.text === LONG_REASON);
      expect(reason && reason.right <= opened.transcriptRight + 1, "the long reason ends inside the reading column").toBe(true);

      // Escape closes the disclosure and keeps focus on its summary.
      await page.keyboard.press("Escape");
      await expect(details).not.toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
      await expect(page.getByText(LONG_REASON)).toBeHidden();
    });
  });
}
