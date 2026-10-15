import { expect, test, type Page } from "@playwright/test";

// #6011: the runtime and control status chips under a reply are ui-pills, which
// are white-space: nowrap at a fixed height. The row wraps whole chips, but one
// long chip ("Coven forwarded the selected model; downstream acceptance was not
// confirmed.", ~491px) could not break its own text and ran past the reading
// column on a narrow pane. Long chip text now wraps inside the column; short
// chips keep their one-line height.

const SESSION_ID = "status-chips-wrap";
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
      id: SESSION_ID, title: "Status chips", familiarId: "nova", status: "idle",
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
  await expect(page.getByText(LONG_REASON)).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".shell-frame")).toHaveAttribute("data-settled", "");
}

function chipGeometry(page: Page) {
  return page.locator('[role="status"][aria-label^="Response model"]').first().evaluate((row) => {
    const transcript = row.closest(".cave-chat-transcript")?.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const chips = [...row.children].map((chip) => {
      const box = chip.getBoundingClientRect();
      return { text: chip.textContent?.trim() ?? "", right: box.right, height: box.height };
    });
    return {
      rowRight: rowBox.right,
      transcriptRight: transcript?.right ?? 0,
      chips,
    };
  });
}

test.describe("runtime status chips on a narrow pane", () => {
  test.skip(({ isMobile }) => isMobile, "desktop pane geometry");
  test.use({ viewport: { width: 1024, height: 768 } });

  test("a long chip wraps inside the reading column; short chips keep one line", async ({ page }) => {
    await openChat(page);
    // Opening the nav narrows the Chat pane to its tightest desktop width.
    const toggle = page.locator(".shell-top-toggle--nav");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await expect
      .poll(async () => {
        const g = await chipGeometry(page);
        return g.chips.every((chip) => chip.right <= g.rowRight + 1) && g.rowRight <= g.transcriptRight + 1;
      })
      .toBe(true);

    const geometry = await chipGeometry(page);
    const long = geometry.chips.find((chip) => chip.text === LONG_REASON);
    const short = geometry.chips.find((chip) => chip.text === "Model: pending");
    expect(long, "the long reason renders as a chip").toBeTruthy();
    expect(short, "a short chip renders").toBeTruthy();
    // The long chip took more than one line instead of overflowing.
    expect(long!.height).toBeGreaterThan(short!.height + 4);
    // One-line chips keep the ui-pill height.
    expect(Math.abs(short!.height - 26)).toBeLessThanOrEqual(2);
  });
});
