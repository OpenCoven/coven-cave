import { expect, test, type Page } from "@playwright/test";
import { runtimeModelInventoryScope } from "../src/lib/runtime-models";

// #5938: a spent Claude plan allowance used to end at a plain Retry that
// re-sent the exhausted model. The strip now offers a one-turn model switch
// for a quota and keeps Retry only for transient throttling.
const ISO = "2026-10-03T00:00:00.000Z";
const EXHAUSTED = "anthropic/claude-fable-5-1";
const ALTERNATE = "anthropic/claude-opus-4-8";
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function setup(page: Page, code: "harness_usage_limit" | "harness_rate_limited") {
  const sends: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true,
    familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", harness: "claude", icon: "ph:sparkle-fill" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: {
    ok: true,
    sessions: [{ id: "usage-limit", title: "Usage limit", status: "idle", project_root: "/tmp/coven-cave", harness: "claude", familiarId: "nova", model: EXHAUSTED, runtime: "local:/tmp/coven-cave", exit_code: null, archived_at: null, created_at: ISO, updated_at: ISO }],
  } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: {
    ok: true, projects: [{ id: "p1", name: "Coven Cave", root: "/tmp/coven-cave", access: "write" }],
  } }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({ json: {
    ok: true, conversation: { activeLeafId: "a1", turns: [{ id: "a1", parentId: null, role: "assistant", text: "Ready for a message.", createdAt: ISO }] },
  } }));
  await page.route("**/api/vault**", (route) => route.fulfill({ json: { ok: true, mappings: [] } }));
  // The composer's inventory follows the resolved model state's runtime, so
  // the switch menu lists Claude's models rather than the E2E default's.
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({
    json: { ok: true, state: {
      familiarId: "nova", runtime: null, harness: "claude", effectiveModel: EXHAUSTED,
      source: "session", applicationState: "saved", reason: "e2e", familiarDefaultModel: null,
    } },
  }));
  // The switch menu lists the runtime's reported inventory. Both ids are
  // offered by the server; the strip must drop the exhausted one itself.
  await page.route("**/api/runtime-models/claude**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: {
      ok: true, runtime: "claude",
      models: [EXHAUSTED, ALTERNATE].map((id) => ({ id, label: id })),
      provenance: "live", freshness: "fresh", refreshState: "ready", availability: "available",
      defaultOwner: "runtime", allowCustom: false,
      scope: runtimeModelInventoryScope("claude", url.searchParams.get("familiarId")),
    } });
  });
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postDataJSON());
    const message = code === "harness_usage_limit"
      ? `Claude Code usage limit reached for ${EXHAUSTED}.`
      : "Claude Code is rate-limiting requests. Wait a moment, then retry.";
    return route.fulfill({ contentType: "text/event-stream", body: [
      { kind: "error", code, message, harness: "claude", model: EXHAUSTED },
      { kind: "done", sessionId: "usage-limit", isError: true },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
  });
  await page.goto("/?mode=chat#chat-usage-limit", { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  await expect(chat.locator(".cave-composer-input")).toBeVisible({ timeout: 45_000 });
  await chat.locator(".cave-composer-input").fill("Keep this exact message for the switch.");
  await chat.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => sends.length).toBe(1);
  return { chat, sends };
}

test("a quota failure offers a one-turn model switch instead of Retry", async ({ page }) => {
  const { chat, sends } = await setup(page, "harness_usage_limit");
  await expect(chat.getByText(`You've used up the quota for ${EXHAUSTED}.`)).toBeVisible();
  await expect(chat.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  await expect(chat.getByText("harness_usage_limit", { exact: true })).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "Manage usage", exact: true })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Use runtime default", exact: true })).toBeVisible();

  const open = chat.getByRole("button", { name: "Use another model…", exact: true });
  await expect(open).toBeVisible();
  await open.click();
  const menu = page.getByRole("menu", { name: "Model" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: EXHAUSTED, exact: true })).toHaveCount(0);
  await menu.getByRole("menuitemradio", { name: ALTERNATE, exact: true }).click();

  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1].prompt).toBe(sends[0].prompt);
  expect(sends[1].modelOverride).toBe(ALTERNATE);
  expect(sends[1].modelOverrideScope).toBe("next-message");
});

test("a rate limit keeps the plain Retry and offers no model switch", async ({ page }) => {
  const { chat, sends } = await setup(page, "harness_rate_limited");
  await expect(chat.getByText("Claude Code is rate-limiting requests. Wait a moment, then retry.")).toBeVisible();
  await expect(chat.getByRole("button", { name: "Use another model…", exact: true })).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "Manage usage", exact: true })).toHaveCount(0);
  const retry = chat.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1].prompt).toBe(sends[0].prompt);
  expect(sends[1].modelOverride).toBe(sends[0].modelOverride);
});
