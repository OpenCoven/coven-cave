import { expect, test, type Page } from "@playwright/test";

// Verifies the composer runtime chip (cave-yq5l / cave-v25g): the chat
// composer always shows the active runtime's mark + effective model, clicking
// it opens a Runtime/Model picker with radio semantics, and picking a runtime
// rebinds the familiar through /api/config — flipping the chip, re-listing
// the Model group, refetching the familiar roster (cave:familiars-refresh),
// and catching the empty-state identity line up without a reload.
//
// Desktop only (the chip lives in the chat composer). All APIs are mocked;
// the config mock is stateful so the roster refetch observably changes what
// the app sees — exactly the loop the feature exists to close.

const FAMILIAR_BASE = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};

type Mutable = {
  harness: string;
  effectiveModel: string;
  familiarsServed: number;
  configPatches: Array<Record<string, unknown>>;
};

async function seed(page: Page): Promise<Mutable> {
  const state: Mutable = {
    harness: "codex",
    effectiveModel: "openai/gpt-5.5",
    familiarsServed: 0,
    configPatches: [],
  };
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => {
    state.familiarsServed += 1;
    return route.fulfill({
      json: { ok: true, familiars: [{ ...FAMILIAR_BASE, harness: state.harness }] },
    });
  });
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route("**/api/chat/model-state**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        state: {
          familiarId: "nova",
          runtime: null,
          harness: state.harness,
          effectiveModel: state.effectiveModel,
          source: "familiar-default",
          applicationState: "saved",
          reason: "e2e",
        },
      },
    }),
  );
  await page.route("**/api/config", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        familiars?: Record<string, { harness?: string; model?: string }>;
      };
      state.configPatches.push(body);
      const fam = body?.familiars?.nova;
      if (fam?.harness) state.harness = fam.harness;
      if (fam?.model) state.effectiveModel = fam.model;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { ok: true, config: {} } });
  });
  return state;
}

test.describe("composer runtime chip", () => {
  test("always visible with the runtime + model, popover carries radio groups", async ({ page }) => {
    await seed(page);
    await page.goto("/");
    const chip = page.getByRole("button", { name: /Runtime: /, exact: false });
    await expect(chip).toBeVisible({ timeout: 45_000 });
    // toHaveAttribute retries — the label settles once model-state hydrates.
    await expect(chip).toHaveAttribute("aria-label", /Runtime: Codex · Model: GPT-5\.5/, { timeout: 15_000 });

    await chip.click();
    const menu = page.getByRole("menu", { name: "Runtime and model" });
    await expect(menu).toBeVisible();
    // Runtime group: all four runtimes, the active one checked.
    for (const name of ["Codex", "Claude Code", "Hermes", "OpenClaw"]) {
      await expect(menu.getByRole("menuitemradio", { name, exact: true })).toBeVisible();
    }
    await expect(menu.getByRole("menuitemradio", { name: "Codex", exact: true })).toHaveAttribute("aria-checked", "true");
    // Model group: the active runtime's catalog with the effective model checked.
    await expect(menu.getByRole("menuitemradio", { name: "GPT-5.5", exact: true })).toHaveAttribute("aria-checked", "true");
  });

  test("picking a runtime rebinds via /api/config, flips the chip, and refreshes the roster", async ({ page }) => {
    const state = await seed(page);
    await page.goto("/");
    const chip = page.getByRole("button", { name: /Runtime: /, exact: false });
    await expect(chip).toBeVisible({ timeout: 45_000 });
    await expect(chip).toHaveAttribute("aria-label", /Runtime: Codex/, { timeout: 15_000 });
    // The empty-state identity line reads the roster's familiar.harness.
    await expect(page.locator(".cave-chat-empty-meta")).toContainText("codex");
    const servedBefore = state.familiarsServed;

    await chip.click();
    await page.getByRole("menuitemradio", { name: "Claude Code", exact: true }).click();

    // The PATCH carries the harness + that runtime's default model.
    await expect(() => {
      const fam = state.configPatches.at(-1)?.familiars as
        | Record<string, { harness?: string; model?: string }>
        | undefined;
      expect(fam?.nova?.harness).toBe("claude");
      expect(fam?.nova?.model ?? "").toMatch(/^anthropic\//);
    }).toPass({ timeout: 10_000 });

    // Chip flips (optimistic, then reconciled by the model-state refetch).
    await expect(chip).toHaveAttribute("aria-label", /Runtime: Claude Code · Model: Claude Opus/, { timeout: 10_000 });

    // cave:familiars-refresh refetched the roster…
    await expect(() => expect(state.familiarsServed).toBeGreaterThan(servedBefore)).toPass({ timeout: 10_000 });
    // …so the identity line catches up without a reload.
    await expect(page.locator(".cave-chat-empty-meta")).toContainText("claude", { timeout: 10_000 });

    // The Model group re-lists to the new runtime's catalog.
    await chip.click();
    const menu = page.getByRole("menu", { name: "Runtime and model" });
    await expect(menu.getByRole("menuitemradio", { name: "Claude Sonnet 5", exact: true })).toBeVisible();
  });
});
