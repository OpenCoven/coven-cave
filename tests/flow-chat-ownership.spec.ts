import { expect, test } from "@playwright/test";

test("Flow runs stay separate until an explicit discussion is created", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the executions entry is in the desktop Chat toolbar");
  const now = new Date().toISOString();
  const base = {
    project_root: "/repo", harness: "copilot", status: "completed",
    exit_code: 0, archived_at: null, created_at: now, updated_at: now,
    familiarId: "nova", hasLocalConversation: true, attention: { state: "none" },
  };
  const discussion = { ...base, id: "discussion", title: "Discuss: Research evidence", origin: "chat" };
  const sessions = [
    { ...base, id: "human", title: "Flow: a human discussion", origin: "chat" },
    { ...base, id: "execution", title: "Automated iteration", origin: "flow",
      flow: { flowId: "flow", runId: "run", missionId: "mission", iteration: 2 } },
  ];
  let discussionsCreated = 0;
  let historyCleared = false;
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "nova");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator",
      status: "active", icon: "ph:sparkle-fill" }],
  } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: {
    ok: true, projects: [{ id: "project", name: "Project", root: "/repo", access: "write" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions } }));
  await page.route("**/api/flows/runs**", (route) => route.fulfill({ json: { ok: true, runs: historyCleared ? [] : [{
    id: "run", flowId: "flow", flowName: "Research evidence", status: "succeeded",
    sessionId: "execution", missionId: "mission", iteration: 2, startedAt: now,
    source: "cave", steps: [{ id: "collect", type: "agent", status: "succeeded" }],
  }, {
    id: "engine", flowId: "batch", flowName: "Sessionless batch", status: "failed",
    startedAt: now, source: "cave", steps: [],
  }] } }));
  await page.route("**/api/flows/session-transcript**", (route) => route.fulfill({ json: {
    ok: true, found: true, transcript: "A retained execution finding.",
  } }));
  await page.route("**/api/flows/discussion", (route) => {
    discussionsCreated += 1;
    expect(route.request().postDataJSON()).toEqual({ sessionId: "execution" });
    sessions.push(discussion);
    return route.fulfill({ json: { ok: true, sessionId: "discussion", familiarId: "nova", session: discussion } });
  });
  await page.route("**/api/chat/conversation/discussion", (route) => route.fulfill({ json: {
    ok: true, conversation: {
      sessionId: "discussion", familiarId: "nova", harness: "copilot", origin: "chat",
      title: discussion.title, parentSessionId: "execution", updatedAt: now,
      turns: [{ id: "context", role: "assistant", text: "Discussion context from the execution.", createdAt: now }],
    },
  } }));
  await page.goto("/?mode=chat", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".shell-frame")).toBeVisible({ timeout: 30_000 });
  const scope = (name: RegExp) => page.locator('.chat-scope-tabs [role="tab"]').filter({ hasText: name }).first();
  await scope(/projects/i).click();
  await scope(/sessions/i).click();
  await expect(page.locator(".chat-session-card")).toHaveCount(1);
  await expect(page.locator(".chat-session-card")).toContainText("Flow: a human discussion");
  await page.getByRole("button", { name: "Session view options" }).click();
  await page.getByRole("menuitem", { name: "Flow runs", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Flow runs" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("Research · mission");
  await expect(dialog).toContainText("Iteration 2");
  await page.screenshot({ path: testInfo.outputPath("flow-run-history.png"), fullPage: true, animations: "disabled" });
  await dialog.locator("summary").filter({ hasText: "Iteration 2" }).click();
  await dialog.getByRole("button", { name: "View transcript" }).first().click();
  await expect(dialog).toContainText("A retained execution finding.");
  expect(discussionsCreated).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("flow-execution-transcript.png"), fullPage: true, animations: "disabled" });
  for (const [theme, mode] of [["coven", "light"], ["tide", "dark"]]) {
    await page.evaluate(({ theme, mode }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.mode = mode;
    }, { theme, mode });
    await expect(dialog).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`flow-execution-${theme}-${mode}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }

  await page.goto("/?mode=chat&flowRun=engine&flowFamiliar=nova&keep=one", { waitUntil: "domcontentloaded" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Sessionless batch");
  await expect(dialog.locator("details[open]")).toHaveCount(1);
  expect(discussionsCreated).toBe(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/flowRun=/);
  await expect(page).toHaveURL(/keep=one/);
  expect(new URL(page.url()).searchParams.has("flowRun")).toBe(false);
  expect(new URL(page.url()).searchParams.has("flowFamiliar")).toBe(false);

  historyCleared = true;
  await page.goto("/?mode=chat&flowRun=run&flowSession=execution&flowFamiliar=nova", { waitUntil: "domcontentloaded" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("A retained execution finding.");
  expect(discussionsCreated).toBe(0);
  await dialog.getByRole("button", { name: "Discuss in Chat" }).last().click();
  await expect(dialog).toHaveCount(0);
  expect(discussionsCreated).toBe(1);
  await expect(page.getByText("Discussion context from the execution.", { exact: true }).first()).toBeVisible();
});
