import { test, expect } from "@playwright/test";

// Board-destination attachments, end to end in the UI (arc #2219→#2234):
// stage a file on the home composer → Task destination → the POST /api/board
// body carries it → the board renders the paperclip chip → the inspector lists
// the files. Daemon-less: every asserted route is mocked.

const cardWithAttachments = {
  id: "att-1",
  title: "Task with files",
  notes: "",
  status: "backlog",
  priority: "medium",
  familiarId: null,
  sessionId: null,
  cwd: null,
  projectId: null,
  links: [],
  github: [],
  labels: [],
  createdAt: "2026-07-02T12:00:00Z",
  updatedAt: "2026-07-02T12:00:00Z",
  lifecycle: "queued",
  lifecycleAt: "2026-07-02T12:00:00Z",
  retryCount: 0,
  maxRetries: 3,
  steps: [],
  attachments: [
    { name: "spec.md", type: "text/markdown", size: 30, text: "# Spec" },
    { name: "shot.png", type: "image/png", size: 900 },
  ],
};

test("home composer files ride onto a Task card and render on the board", async ({ page }) => {
  const boardPosts: any[] = [];
  await page.route("**/api/familiars**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, familiars: [] }) }));
  await page.route("**/api/sessions/list**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sessions: [] }) }));
  await page.route("**/api/escalations**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, count: 0 }) }));
  await page.route("**/api/board", (r) => {
    if (r.request().method() === "POST") {
      boardPosts.push(JSON.parse(r.request().postData() || "{}"));
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, card: cardWithAttachments }) });
    }
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, cards: [cardWithAttachments] }) });
  });
  await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));

  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 60000 });

  // ── Stage files on the home composer ───────────────────────────────────────
  await page.waitForSelector(".hc-textarea", { timeout: 60000 });
  await page.locator(".hc-file-input").setInputFiles([
    {
      name: "spec.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Spec\n- do the thing\n"),
    },
    {
      name: "shot.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake image bytes"),
    },
  ]);
  await expect(page.locator(".hc-attachment-name")).toHaveText(["spec.md", "shot.png"]);

  // ── Send to the Task destination ───────────────────────────────────────────
  await page.getByRole("radio", { name: "Task" }).click();
  await page.locator(".hc-textarea").fill("Ship the spec");
  await page.locator(".hc-send-btn").click();

  // The POST body carries the staged attachment, content included.
  await expect.poll(() => boardPosts.length, { timeout: 15000 }).toBeGreaterThan(0);
  expect(boardPosts[0].title).toBe("Ship the spec");
  expect(boardPosts[0].attachments?.map((a: { name?: string }) => a.name)).toEqual(["spec.md", "shot.png"]);
  expect(boardPosts[0].attachments?.[0]?.name).toBe("spec.md");
  expect(boardPosts[0].attachments?.[0]?.text).toContain("do the thing");

  // ── Board renders the paperclip chip (auto-navigated after create) ─────────
  await page.waitForSelector(".board-kanban-card", { timeout: 60000 });
  await expect(page.locator('[title="2 attachments"]')).toBeVisible();

  // ── Inspector lists the files with per-file remove affordances ─────────────
  await page.locator('[data-card-id="att-1"]').click();
  await expect(page.getByText("Attachments")).toBeVisible();
  await expect(page.getByText("spec.md", { exact: true })).toBeVisible();
  await expect(page.getByText("shot.png", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove spec.md" })).toBeVisible();
});
