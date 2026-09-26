import { expect, test } from "@playwright/test";

// #5572: a closed turn-activity disclosure mounts no tool groups, a collapsed
// tool group mounts no tool cards, and a collapsed tool card mounts no body. Each SyntaxBlock detects a
// language and highlights on mount, and a long thread carries thousands of
// collapsed cards, so the body (input, output, edit diff) mounts on first open
// and stays mounted after that.

const ISO = new Date().toISOString();
const OUTPUT_MARKER = "lazy-tool-output-marker-5572";
const DIFF_MARKER = "lazy-edit-diff-marker-5572";

test("turn activity, tool groups and tool cards mount only once opened (#5572)", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  // A registered project, so the first-project gate doesn't cover the chat.
  await page.route("**/api/projects**", (route) =>
    route.fulfill({
      json: { ok: true, projects: [{ id: "project-repo", name: "repo", root: "/repo", createdAt: ISO, updatedAt: ISO }] },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        sessions: [{
          id: "tools-1", title: "Tool cards", status: "completed", origin: "chat", project_root: "/repo",
          harness: "claude", familiarId: "nova", exit_code: 0, archived_at: null,
          created_at: ISO, updated_at: ISO, attention: { state: "none", since: null, reason: null },
        }],
      },
    }),
  );
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({
    json: {
      ok: true,
      context: { task: null, github: [] },
      conversation: {
        familiarId: "nova",
        activeLeafId: "t2",
        turns: [
          { id: "t1", parentId: null, role: "user", text: "Run the checks", createdAt: ISO },
          {
            id: "t2",
            parentId: "t1",
            role: "assistant",
            text: "The checks ran.",
            createdAt: ISO,
            tools: [
              {
                id: "tool-bash",
                name: "Bash",
                status: "ok",
                durationMs: 40,
                input: JSON.stringify({ command: "pnpm test" }),
                output: `${OUTPUT_MARKER}\nall green`,
              },
              {
                id: "tool-edit",
                name: "Edit",
                status: "ok",
                durationMs: 20,
                input: JSON.stringify({ file_path: "/repo/a.ts", old_string: "a", new_string: DIFF_MARKER }),
              },
            ],
          },
        ],
      },
    },
  }));

  await page.goto("/#chat-tools-1", { waitUntil: "domcontentloaded" });
  // Scoped to the primary chat panel: an unscoped query also matches the
  // hidden auxiliary panel's copy of the transcript.
  const main = page.getByTestId("chat-main");
  await expect(main.getByText("The checks ran.")).toBeVisible({ timeout: 45_000 });

  // A finished turn's activity disclosure starts closed and mounts nothing.
  const activity = main.locator("details.streaming-turn-activity").first();
  await expect(activity).toBeVisible();
  await expect(main.locator(".cave-tool-group")).toHaveCount(0);
  await activity.locator(":scope > summary").click();

  // The turn's collapsed tool group mounts no tool cards until it is opened.
  const group = main.locator(".cave-tool-group").first();
  await expect(group).toBeVisible();
  // (Edit cards render inline outside the group by design; they stay compact
  // summaries until opened, checked below.)
  await expect(main.locator(".cave-tool-block:not(.cave-edit-card)")).toHaveCount(0);
  await group.locator(":scope > summary").click();

  const bash = main.locator(".cave-tool-block").filter({ has: page.locator("summary", { hasText: "Bash" }) }).first();
  const edit = main.locator(".cave-tool-block.cave-edit-card").first();
  await expect(bash).toBeVisible();
  await expect(edit).toBeVisible();
  // Closed: no body in the DOM at all, not merely hidden.
  await expect(bash.locator(".cave-tool-io")).toHaveCount(0);
  await expect(edit.locator(".cave-tool-io")).toHaveCount(0);
  await expect(main.getByText(OUTPUT_MARKER)).toHaveCount(0);

  await bash.locator("summary").click();
  await expect(bash.getByText(OUTPUT_MARKER)).toBeVisible();

  // Closing keeps the body mounted, so re-opening doesn't highlight again.
  await bash.locator("summary").click();
  await expect(bash.locator(".cave-tool-io")).not.toHaveCount(0);

  await edit.locator("summary").click();
  await expect(edit.locator(".cave-tool-io").first()).toBeVisible();
  await expect(edit.getByText(DIFF_MARKER).first()).toBeVisible();
});
