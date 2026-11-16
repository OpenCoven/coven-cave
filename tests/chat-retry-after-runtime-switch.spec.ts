import { expect, test, type Page } from "@playwright/test";
import {
  runtimeModelInventoryAvailability,
  runtimeModelInventoryFreshness,
  runtimeModelInventoryRefreshState,
  runtimeModelInventoryScope,
} from "../src/lib/runtime-models";

test.use({ serviceWorkers: "block" });

// #6419: a failed send is saved so Retry can replay it, but a runtime or model
// picked since then outranks the saved attempt. Replaying it sent a Claude
// model to Codex, the server refused it, and the refused send was saved again
// with the same model, so Retry could never recover.

const CLAUDE_MODEL = "anthropic/claude-opus-5-5";
const CODEX_MODEL = { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol" };

type State = {
  harness: string;
  effectiveModel: string;
  source: "familiar-default" | "runtime-default";
  applicationState: "pending" | "saved";
  sends: Array<Record<string, unknown>>;
};

const streamed = (events: unknown[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

async function failFirstClaudeSend(page: Page, isMobile: boolean) {
  const state: State = {
    harness: "claude",
    effectiveModel: CLAUDE_MODEL,
    // Pending is what makes the composer send the model explicitly, the same
    // next-message intent recorded on the failed turn in the #6419 export.
    source: "familiar-default",
    applicationState: "pending",
    sends: [],
  };
  await page.addInitScript((mobile) => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:onboarding:dismissed", "1");
    if (mobile) localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("p1"));
  }, isMobile);
  await page.route("**/api/daemon/connection**", (route) => route.fulfill({ json: { running: true, availability: "online", target: { mode: "local" } } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [{ id: "p1", name: "Cave", root: "/tmp/cave-retry-fixture", access: "full", familiarIds: ["nova"], defaultFamiliarId: "nova" }] } }));
  await page.route("**/api/familiars**", (route) => route.fulfill({
    json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill", harness: state.harness }] },
  }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route(/\/api\/runtime-models\/([^/?]+)(?:\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const runtime = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const models = runtime === "codex" ? [CODEX_MODEL] : runtime === "claude" ? [{ id: CLAUDE_MODEL, label: "Claude Opus" }] : [];
    const provenance = models.length > 0 ? "live" : "unavailable";
    return route.fulfill({
      json: {
        ok: true,
        runtime,
        models,
        provenance,
        freshness: runtimeModelInventoryFreshness(provenance),
        refreshState: runtimeModelInventoryRefreshState(provenance),
        availability: runtimeModelInventoryAvailability(provenance),
        defaultOwner: "runtime",
        allowCustom: false,
        scope: runtimeModelInventoryScope(runtime, url.searchParams.get("familiarId")),
      },
    });
  });
  await page.route("**/api/chat/model-state**", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { model?: string };
      if (body?.model) {
        state.effectiveModel = body.model;
        state.source = "familiar-default";
        state.applicationState = "saved";
      }
    }
    return route.fulfill({
      json: {
        ok: true,
        state: {
          familiarId: "nova",
          runtime: null,
          harness: state.harness,
          effectiveModel: state.effectiveModel,
          source: state.source,
          applicationState: state.applicationState,
          reason: "e2e",
        },
        controls: [],
      },
    });
  });
  await page.route("**/api/config", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { familiars?: Record<string, { harness?: string; model?: string }> };
      const familiar = body?.familiars?.nova;
      if (familiar?.harness) state.harness = familiar.harness;
      if (familiar && Object.prototype.hasOwnProperty.call(familiar, "model")) {
        state.effectiveModel = familiar.model ?? "";
        state.source = familiar.model ? "familiar-default" : "runtime-default";
        state.applicationState = "saved";
      }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { ok: true, config: {} } });
  });
  await page.route("**/api/chat/send", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.sends.push(body);
    if (state.harness === "claude") {
      return route.fulfill({
        contentType: "text/event-stream",
        body: streamed([
          { kind: "error", code: "scoped_write_unavailable", message: "Full access for Claude needs a newer Coven than this one.", harness: "claude" },
          { kind: "done", isError: true },
        ]),
      });
    }
    if (typeof body.modelOverride === "string" && body.modelOverride.startsWith("anthropic/")) {
      return route.fulfill({
        status: 400,
        json: {
          ok: false,
          code: "model_runtime_mismatch",
          error: `This chat runs on Codex, which only serves OpenAI models, so it cannot run ${body.modelOverride}.`,
        },
      });
    }
    return route.fulfill({ contentType: "text/event-stream", body: streamed([{ kind: "done", isError: false }]) });
  });

  await page.goto("/?mode=chat");
  if (isMobile) await page.getByRole("button", { name: "New session", exact: true }).click();
  const chat = page.getByTestId("chat-main");
  const input = chat.locator(".cave-composer-input");
  await expect(input).toBeVisible({ timeout: 45_000 });
  const modelChip = chat.getByRole("button", { name: /change model/ });
  await expect(modelChip).toContainText(CLAUDE_MODEL, { timeout: 15_000 });
  await input.fill("Keep this exact message for retry.");
  await chat.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => state.sends.length).toBe(1);
  expect(state.sends[0].modelOverride).toBe(CLAUDE_MODEL);
  const retry = chat.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  return { state, chat, modelChip, retry };
}

async function switchToCodex(page: Page, chat: ReturnType<Page["getByTestId"]>) {
  const runtimeChip = chat.getByRole("button", { name: /change runtime/ });
  await runtimeChip.click();
  await page.getByRole("menu", { name: "Runtime", exact: true }).getByRole("menuitemradio", { name: "Codex", exact: true }).click();
  await expect(runtimeChip).toContainText("Codex", { timeout: 10_000 });
  const modelMenu = page.getByRole("menu", { name: "Model", exact: true });
  await expect(modelMenu).toBeVisible();
  return modelMenu;
}

test.describe("Retry after the runtime or model changed (#6419)", () => {
  test("uses a Codex model picked after the failure", async ({ page, isMobile }) => {
    const { state, chat, modelChip, retry } = await failFirstClaudeSend(page, isMobile);
    const modelMenu = await switchToCodex(page, chat);
    await modelMenu.getByRole("menuitemradio", { name: `${CODEX_MODEL.label} · ${CODEX_MODEL.id}`, exact: true }).click();
    await expect(modelChip).toContainText(CODEX_MODEL.id, { timeout: 10_000 });

    await retry.click();
    await expect.poll(() => state.sends.length).toBe(2);
    expect(state.sends[1].modelOverride).not.toBe(CLAUDE_MODEL);
    expect(state.sends[1].prompt).toBe(state.sends[0].prompt);
    // The pick was saved as the familiar's model, so the send may inherit it
    // from there. What it can't do is bring back the Claude model.
    expect(state.effectiveModel).toBe(CODEX_MODEL.id);
    await expect(chat.getByText("model_runtime_mismatch")).toHaveCount(0);
  });

  test("leaves the model to the new runtime when none is picked", async ({ page, isMobile }) => {
    const { state, chat, retry } = await failFirstClaudeSend(page, isMobile);
    await switchToCodex(page, chat);
    await page.keyboard.press("Escape");

    await retry.click();
    await expect.poll(() => state.sends.length).toBe(2);
    expect(state.sends[1].modelOverride ?? "").toBe("");
    expect(state.sends[1].prompt).toBe(state.sends[0].prompt);
  });

  test("a model the server refused isn't sent again", async ({ page, isMobile }) => {
    const { state, chat, retry } = await failFirstClaudeSend(page, isMobile);
    // The runtime moved outside this composer, such as in another window, so
    // the first Retry still carries the saved Claude model and is refused.
    state.harness = "codex";
    state.effectiveModel = "";
    state.source = "runtime-default";
    state.applicationState = "saved";

    await retry.click();
    await expect.poll(() => state.sends.length).toBe(2);
    expect(state.sends[1].modelOverride).toBe(CLAUDE_MODEL);
    await expect(chat.getByRole("button", { name: /change runtime/ })).toContainText("Codex", { timeout: 10_000 });

    await chat.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => state.sends.length).toBe(3);
    expect(state.sends[2].modelOverride ?? "").toBe("");
    expect(state.sends[2].prompt).toBe(state.sends[0].prompt);
  });
});
