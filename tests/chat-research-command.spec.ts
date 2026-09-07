import { expect, test, type Page } from "@playwright/test";

// Chat's entry into the shared research run (#4808). The pure builder is unit
// tested; what only a real page can show is the seam: that `/research` is
// intercepted as a command rather than sent to the familiar, that it POSTs the
// ordinary create-mission request, and that the request names THIS conversation
// as the run's origin — which is what later lets the Research Desk project the
// run back here.

const ISO = "2026-08-15T12:00:00.000Z";
const SESSION_ID = "s-research-origin";
const SESSION = {
  id: SESSION_ID,
  title: "Vector store options",
  status: "idle",
  project_root: "/tmp/coven-cave",
  harness: "claude",
  familiarId: "nova",
  model: "test",
  runtime: "local:/tmp/coven-cave",
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

const CREATED_MISSION = {
  version: 1,
  id: "research-1",
  familiarId: "nova",
  title: "Compare managed vector stores for a small team",
  intent: "compare managed vector stores for a small team",
  origin: { surface: "chat", sessionId: SESSION_ID },
  mode: "brief",
  modeSource: "auto",
  deliverable: "brief",
  constraints: [],
  bounds: {
    wallClockMinutes: 20,
    maxIterations: 1,
    sourceTarget: 6,
    checkpointEvery: 1,
    stopWhenCostUnavailable: false,
  },
  status: "planning",
  createdAt: ISO,
  updatedAt: ISO,
  iterations: [{ number: 1, status: "queued" }],
  artifacts: [],
  sources: [],
};

async function setup(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [{
          id: "nova",
          display_name: "Nova",
          role: "Orchestrator",
          status: "active",
          icon: "ph:sparkle-fill",
        }],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [SESSION] } }),
  );
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: {
          activeLeafId: "a-seed",
          turns: [
            {
              id: "u-seed",
              parentId: null,
              role: "user",
              text: "Which vector store should we pick?",
              createdAt: ISO,
            },
            {
              id: "a-seed",
              parentId: "u-seed",
              role: "assistant",
              text: "Happy to dig into that.",
              createdAt: ISO,
            },
          ],
        },
      },
    }),
  );
}

test("/research starts a run stamped with the conversation it was invoked from", async ({
  page,
}) => {
  await setup(page);

  const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/research/missions**", async (route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      body: (request.postDataJSON() ?? {}) as Record<string, unknown>,
    });
    await route.fulfill({ json: { ok: true, mission: CREATED_MISSION } });
  });

  // If the command were NOT intercepted it would be sent to the familiar
  // instead, so fail loudly rather than silently passing on a hung send.
  let sends = 0;
  await page.route("**/api/chat/send**", async (route) => {
    sends += 1;
    await route.fulfill({ status: 500, body: "" });
  });

  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });

  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill("/research compare managed vector stores for a small team");
  await composer.press("Enter");

  // Wait for the create request to have fired, then pin requests[0] to the
  // POST contract. Do NOT assert the total count: the inline run card mounted
  // by the resulting turn legitimately rehydrates the same mission
  // (GET /api/research/missions/research-1) and re-polls every 2s while the
  // mocked mission stays in a pollable status, so on a warm CI runner its
  // first GET can land inside the ~180ms between the POST firing and
  // `press("Enter")` resolving — the poll's first evaluation then reads 2 and
  // can never see 1 (observed on #5161 as "Expected: 1, Received: 17", both
  // retries). requests[0] is deterministic: nothing else on this page touches
  // this URL before the command creates the run.
  await expect
    .poll(() => requests.length, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1);

  // The run records this conversation — not the executor session it will spawn,
  // which does not exist yet — and goes through the ordinary create contract.
  expect(requests[0].method).toBe("POST");
  expect(requests[0].body.origin).toEqual({ surface: "chat", sessionId: SESSION_ID });
  expect(requests[0].body.familiarId).toBe("nova");
  expect(requests[0].body.intent).toBe("compare managed vector stores for a small team");

  // The command is handled in chat, never forwarded to the familiar.
  expect(sends).toBe(0);
  await expect(composer).toHaveValue("");

  await expect(
    page.getByText("Compare managed vector stores for a small team", { exact: false }).last(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Research Desk", { exact: false }).last()).toBeVisible();
});

test("/research with too short a brief starts nothing and says why", async ({ page }) => {
  await setup(page);

  let created = 0;
  await page.route("**/api/research/missions**", async (route) => {
    created += 1;
    await route.fulfill({ json: { ok: true, mission: CREATED_MISSION } });
  });

  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });

  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill("/research");
  await composer.press("Enter");

  await expect(page.getByText("Describe what to research", { exact: false }).last()).toBeVisible({
    timeout: 30_000,
  });
  expect(created).toBe(0);
});
