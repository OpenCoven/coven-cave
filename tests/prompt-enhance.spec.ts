import { expect, test, type Page, type Route } from "@playwright/test";

// The ultimate Enhance (cave-b6c2): the composer's sparkle control streams a
// real rewrite from the familiar via /api/chat/send (SSE), applies it in place
// when the draft is untouched, downgrades to a suggestion strip when the user
// typed mid-flight (the old copies' race bug), falls back to the local rule
// engine on stream failure, and exposes intent variants behind a menu.
//
// Daemon-less: /api/chat/send is mocked with SSE frames; the home surface is
// driven through the standard familiar/session mocks. Desktop-only — the
// control is identical on chat and quick-chat (pinned in
// composer-enhance.test.ts), so one surface exercises the shared behavior.

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};

const ENHANCED = "Investigate the login regression and outline a fix plan.";

function sseBody(text: string): string {
  return [
    `data: ${JSON.stringify({ kind: "assistant_chunk", text: `<enhanced>${text}</enhanced>` })}`,
    "",
    `data: ${JSON.stringify({ kind: "done", sessionId: "enh-1" })}`,
    "",
    "",
  ].join("\n");
}

function fulfillSse(route: Route, text: string) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: sseBody(text),
  });
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ ...FAMILIAR, harness: "claude" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
}

async function openHome(page: Page) {
  await page.goto("/?mode=home");
  const draft = page.getByRole("textbox", { name: "Ask anything" });
  await expect(draft).toBeVisible({ timeout: 45_000 });
  return draft;
}

test.describe("prompt enhance", () => {
  test("one click streams a rewrite, applies in place, and reverts in one tap", async ({ page }) => {
    await seed(page);
    const sends: Array<Record<string, unknown>> = [];
    await page.route("**/api/chat/send", (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      if (request.origin === "enhance") sends.push(request);
      return fulfillSse(route, ENHANCED);
    });

    const draft = await openHome(page);
    await draft.fill("fix login bug");
    await page.getByRole("button", { name: "Enhance prompt" }).click();

    // The rewrite lands in the textarea; the strip flips to applied + Revert.
    await expect(draft).toHaveValue(ENHANCED, { timeout: 15_000 });
    await expect(page.getByText("Prompt improved.")).toBeVisible();

    // The run is an ephemeral, hidden, cheap request — never a saved chat.
    expect(sends).toHaveLength(1);
    expect(sends[0].origin).toBe("enhance");
    expect(sends[0].reasoningEffort).toBe("low");
    expect(sends[0].sessionId).toBeUndefined();
    expect(String(sends[0].prompt)).toContain("fix login bug");
    expect(String(sends[0].prompt)).toContain("Rewrite the user's draft prompt");

    await page.getByRole("button", { name: "Revert enhanced prompt" }).click();
    await expect(draft).toHaveValue("fix login bug");
  });

  test("typing mid-flight never loses the draft — the rewrite becomes a suggestion", async ({ page }) => {
    await seed(page);
    let releaseSse: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseSse = resolve;
    });
    await page.route("**/api/chat/send", async (route) => {
      await gate; // hold the stream until the user has typed over the draft
      return fulfillSse(route, ENHANCED);
    });

    const draft = await openHome(page);
    await draft.fill("fix login bug");
    await page.getByRole("button", { name: "Enhance prompt" }).click();
    await expect(page.getByText("Enhancing…")).toBeVisible();

    // Keep typing while the stream is in flight, then let it complete.
    await draft.fill("fix login bug on safari");
    releaseSse();

    // The newer draft is untouched; the rewrite waits in the strip.
    await expect(page.getByRole("button", { name: "Apply enhanced prompt" })).toBeVisible({ timeout: 15_000 });
    await expect(draft).toHaveValue("fix login bug on safari");

    await page.getByRole("button", { name: "Apply enhanced prompt" }).click();
    await expect(draft).toHaveValue(ENHANCED);
    // Applying from the strip still offers Revert back to the typed draft.
    await page.getByRole("button", { name: "Revert enhanced prompt" }).click();
    await expect(draft).toHaveValue("fix login bug on safari");
  });

  test("the intent menu changes the instruction (keyboard: ArrowDown opens it)", async ({ page }) => {
    await seed(page);
    const sends: Array<Record<string, unknown>> = [];
    await page.route("**/api/chat/send", (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      if (request.origin === "enhance") sends.push(request);
      return fulfillSse(route, "Shorter.");
    });

    const draft = await openHome(page);
    await draft.fill("please make this whole thing quite a bit shorter somehow");

    await page.getByRole("button", { name: "Enhance prompt" }).focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "Enhance options" });
    await expect(menu).toBeVisible();
    for (const label of ["Smart enhance", "Clarify", "Expand", "Make specific", "Shorten", "Add acceptance criteria"]) {
      await expect(menu.getByText(label, { exact: true })).toBeVisible();
    }
    await menu.getByText("Shorten", { exact: true }).click();

    await expect(draft).toHaveValue("Shorter.", { timeout: 15_000 });
    expect(String(sends[0].prompt)).toContain("Compress to the essential ask");
  });

  test("a failed stream falls back to the local rule engine, labelled offline", async ({ page }) => {
    await seed(page);
    await page.route("**/api/chat/send", (route) => route.fulfill({ status: 500, json: { ok: false } }));

    const draft = await openHome(page);
    await draft.fill("explain docker networking");
    await page.getByRole("button", { name: "Enhance prompt" }).click();

    // The rule engine's chat shape applies in place, and the strip says so.
    await expect(page.getByText("Prompt improved (offline).")).toBeVisible({ timeout: 15_000 });
    await expect(draft).toHaveValue(/Output format:/);
    await page.getByRole("button", { name: "Revert enhanced prompt" }).click();
    await expect(draft).toHaveValue("explain docker networking");
  });
});
