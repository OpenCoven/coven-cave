import { test, expect } from "@playwright/test";

test("GitHub URL aliases render once and detach together", async ({ page }) => {
  const url = "https://github.com/openclaw/openclaw/issues/57142";
  const github = {
    id: "github:issue:openclaw/openclaw:57142", kind: "issue", repo: "openclaw/openclaw",
    number: 57142, title: "Repair startup", url, labels: ["bug"], source: "assigned",
  };
  let card = {
    id: "identity-card", title: "Repair attachment identity", notes: "", status: "backlog",
    lifecycle: "todo", priority: "medium", familiarId: null, sessionId: null, cwd: null,
    projectId: null, links: [url, `${url}#issuecomment-123`],
    github: [github, { ...github, url: `${url}#issuecomment-123` }],
    asana: [], labels: [], steps: [], dependencies: [], primaryBlockerId: null,
    nextStep: null, retryCount: 0, maxRetries: 3,
    createdAt: "2026-10-20T15:36:18.614Z", updatedAt: "2026-10-20T15:36:18.614Z",
  };
  const duplicateWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("same key")) duplicateWarnings.push(message.text());
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/escalations**", (route) => route.fulfill({ json: { ok: true, count: 0 } }));
  await page.route("**/api/github/assigned**", (route) => route.fulfill({ json: { ok: true, configured: true, items: [] } }));
  await page.route("**/api/board", (route) => route.fulfill({ json: { ok: true, cards: [card] } }));
  await page.route("**/api/board/identity-card", async (route) => {
    if (route.request().method() === "PATCH") card = { ...card, ...route.request().postDataJSON() };
    await route.fulfill({ json: { ok: true, card } });
  });
  await page.addInitScript(() => localStorage.setItem("cave:onboarding:dismissed", "1"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell-frame");
  await page.keyboard.press("Meta+3");
  await page.locator("[data-card-id='identity-card']").click();
  await expect(page.locator(".board-github-attachment-open")).toHaveCount(1);
  await expect(page.locator(".board-github-attachment-open")).toContainText("Repair startup");
  expect(duplicateWarnings).toEqual([]);
  await page.locator(".board-github-attachment-open").locator("..").getByRole("button", { name: "Detach", exact: true }).click();
  await expect(page.locator(".board-github-attachment-open")).toHaveCount(0);
  await expect.poll(() => card.links).toEqual([]);
  expect(card.github).toEqual([]);
});
