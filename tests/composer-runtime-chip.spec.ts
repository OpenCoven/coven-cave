import { expect, test, type Page } from "@playwright/test";

// Verifies the composer runtime picker (cave-yq5l / cave-v25g / cave-bfwk,
// split-chip grammar since cave-g21f): the chat composer footer's model chip
// always shows the effective model and opens the Runtime/Model picker
// directly with radio semantics; picking a runtime rebinds the familiar
// through /api/config — flipping the chip, re-listing the Model group in the
// still-open menu (the pick isn't complete until a model is chosen),
// refetching the familiar roster (cave:familiars-refresh), and catching the
// new-chat landing's identity line up without a reload. A model pick then
// closes the menu.
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
  modelStateServed: number;
  configPatches: Array<Record<string, unknown>>;
};

async function seed(page: Page): Promise<Mutable> {
  const state: Mutable = {
    harness: "codex",
    effectiveModel: "openai/gpt-5.5",
    familiarsServed: 0,
    modelStateServed: 0,
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
  await page.route("**/api/chat/model-state**", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { model?: string };
      if (body?.model) state.effectiveModel = body.model;
    } else {
      state.modelStateServed += 1;
    }
    return route.fulfill({
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
    });
  });
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

test.describe("composer runtime picker (context chips)", () => {
  test("always visible with the runtime + model, popover carries radio groups", async ({ page }) => {
    await seed(page);
    await page.goto("/?mode=chat");
    const modelChip = page.getByRole("button", { name: /change model/ });
    await expect(modelChip).toBeVisible({ timeout: 45_000 });
    // toContainText retries — the chip settles once model-state hydrates.
    await expect(modelChip).toContainText("GPT-5.5", { timeout: 15_000 });

    // Split chips (cave-g21f): the model chip opens the picker directly.
    await modelChip.click();
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
    await page.goto("/?mode=chat");
    const pill = page.getByRole("button", { name: /change model/ });
    await expect(pill).toBeVisible({ timeout: 45_000 });
    await expect(pill).toContainText("GPT-5.5", { timeout: 15_000 });
    // The landing identity line reads the roster's familiar.harness.
    await expect(page.locator(".home-dash__meta")).toContainText("codex");
    const servedBefore = state.familiarsServed;
    const modelStateGetsBefore = state.modelStateServed;

    await pill.click();
    const menu = page.getByRole("menu", { name: "Runtime and model" });
    await menu.getByRole("menuitemradio", { name: "Claude Code", exact: true }).click();

    // The menu stays open for the model step — the switch isn't done until a
    // model is picked, and the Model group re-lists to the new runtime's
    // catalog in place (cave-bfwk).
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: "Claude Sonnet 5", exact: true })).toBeVisible();

    // The PATCH carries the harness + that runtime's default model.
    await expect(() => {
      const fam = state.configPatches.at(-1)?.familiars as
        | Record<string, { harness?: string; model?: string }>
        | undefined;
      expect(fam?.nova?.harness).toBe("claude");
      expect(fam?.nova?.model ?? "").toMatch(/^anthropic\//);
    }).toPass({ timeout: 10_000 });

    // Pill flips (optimistic, then reconciled by the model-state refetch).
    await expect(pill).toContainText("Claude Opus", { timeout: 10_000 });

    // cave:familiars-refresh refetched the roster…
    await expect(() => expect(state.familiarsServed).toBeGreaterThan(servedBefore)).toPass({ timeout: 10_000 });
    // …so the identity line catches up without a reload.
    await expect(page.locator(".home-dash__meta")).toContainText("claude", { timeout: 10_000 });

    // Let the runtime pick's reconciling model-state refetch land before the
    // model pick, so a stale in-flight GET can't overwrite the model PATCH.
    await expect(() => expect(state.modelStateServed).toBeGreaterThan(modelStateGetsBefore)).toPass({ timeout: 10_000 });

    // Picking a model completes the runtime→model switch and closes the menu.
    await menu.getByRole("menuitemradio", { name: "Claude Sonnet 5", exact: true }).click();
    await expect(menu).not.toBeVisible();
    await expect(pill).toContainText("Claude Sonnet 5", { timeout: 10_000 });
  });
});
