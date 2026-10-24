import { expect, test, type Page } from "@playwright/test";
import {
  runtimeModelInventoryAvailability,
  runtimeModelInventoryFreshness,
  runtimeModelInventoryRefreshState,
  runtimeModelInventoryScope,
} from "../src/lib/runtime-models";

test.use({ serviceWorkers: "block" });

// Verifies the composer runtime · model · control chips (cave-yq5l / cave-v25g
// / cave-bfwk, split-chip grammar since cave-g21f, Runtime and Model split into
// separate chips plus capability-driven Thinking · Speed chips in #5896): the
// chat composer footer always shows the active runtime and the effective model
// as separately labelled chips, each opening its own radio menu; picking a
// runtime rebinds the familiar through /api/config — flipping the Runtime chip,
// chaining straight into the Model menu (the pick isn't complete until a model
// is chosen), refetching the familiar roster (cave:familiars-refresh), and
// catching the new-chat landing's identity line up without a reload. A model
// pick then closes the menu. Once the model-state report carries controls for
// the new runtime, the Thinking and Speed chips appear on their own, a Speed
// pick rides the next send's typed modelControls, and a runtime without
// controls shows no such chips at all.
//
// Desktop and phone recovery use the same composer controls. All APIs are mocked;
// the config mock is stateful so the roster refetch observably changes what
// the app sees — exactly the loop the feature exists to close.

const FAMILIAR_BASE = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};

const CODEX_MODEL = { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol" };
const CLAUDE_MODEL = { id: "claude-sonnet-5", label: "Claude Sonnet 5" };

// The shape /api/chat/model-state reports for a local Claude binding whose
// installed coven CLI advertises `--speed` (see model-control-capabilities).
// A local Codex binding whose direct `codex exec` transport advertises
// `-c, --config` (#5905).
const CODEX_CONTROLS = [
  {
    family: "reasoning",
    label: "Reasoning",
    delivery: "runtime-cli",
    parameter: "model_reasoning_effort",
    values: [
      { value: "minimal", label: "Minimal" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra high" },
    ],
    validation: {},
  },
];

const CLAUDE_CONTROLS = [
  {
    family: "reasoning",
    label: "Reasoning guidance",
    delivery: "prompt-only",
    values: [
      { value: "minimal", label: "Minimal" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    validation: {},
  },
  {
    family: "performance",
    label: "Speed",
    delivery: "runtime-cli",
    parameter: "speed",
    values: [
      { value: "fast", label: "Fast" },
      { value: "balanced", label: "Balanced" },
      { value: "thorough", label: "Thorough" },
    ],
    validation: {},
  },
];

type Mutable = {
  harness: string;
  /** Opt the Codex fixture into reporting its Thinking control (#5905). */
  codexControls?: boolean;
  modelSaveGate?: Promise<void>;
  effectiveModel: string;
  familiarsServed: number;
  modelStateServed: number;
  configPatches: Array<Record<string, unknown>>;
  sendBodies: Array<Record<string, unknown>>;
};

async function seed(page: Page, inventoryAvailable = true, harness = "codex"): Promise<Mutable> {
  const state: Mutable = {
    harness,
    effectiveModel: harness === "codex" ? CODEX_MODEL.id : "",
    familiarsServed: 0,
    modelStateServed: 0,
    configPatches: [],
    sendBodies: [],
  };
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/daemon/connection**", (route) => route.fulfill({ json: { running: true, availability: "online", target: { mode: "local" } } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [{ id: "p1", name: "Cave", root: "/tmp/cave-models-fixture", access: "full", familiarIds: ["nova"], defaultFamiliarId: "nova" }] } }));
  await page.route("**/api/familiars**", (route) => {
    state.familiarsServed += 1;
    return route.fulfill({
      json: { ok: true, familiars: [{ ...FAMILIAR_BASE, harness: state.harness }] },
    });
  });
  // Runtime switching must not compile a live inventory route or probe an
  // installed CLI inside this otherwise-hermetic picker test.
  await page.route(/\/api\/runtime-models\/([^/?]+)(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    const url = new URL(route.request().url());
    const runtime = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const models = inventoryAvailable
      ? runtime === "codex" ? [CODEX_MODEL] : runtime === "claude" ? [CLAUDE_MODEL] : []
      : [];
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
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route("**/api/chat/model-state**", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { model?: string };
      if (state.modelSaveGate) await state.modelSaveGate;
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
        // Controls follow the runtime: Claude reports Thinking guidance and
        // the runtime Speed flag; Codex reports its native reasoning level only
        // when the test opts in (the real route gates it on the direct
        // transport), so the default Codex fixture shows no chips.
        controls: state.harness === "claude" ? CLAUDE_CONTROLS : state.harness === "codex" && state.codexControls ? CODEX_CONTROLS : [],
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
      // Empty is the explicit runtime-default sentinel. Preserve it in the
      // stateful mock so the follow-up model-state GET cannot resurrect the
      // previous runtime's model.
      if (fam && Object.prototype.hasOwnProperty.call(fam, "model")) {
        state.effectiveModel = fam.model ?? "";
      }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { ok: true, config: {} } });
  });
  // Capture what a send would carry; no turn actually runs.
  await page.route("**/api/chat/send", (route) => {
    state.sendBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 403, json: { ok: false, error: "Synthetic send forbidden" } });
  });
  return state;
}

async function openModelChat(page: Page, isMobile: boolean) {
  if (isMobile) {
    // Phone starts on the list. Its New session action requires an explicit
    // project, matching the fixture's authorized crew and send permission.
    await page.addInitScript(() => localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("p1")));
  }
  await page.goto("/?mode=chat");
  if (isMobile) await page.getByRole("button", { name: "New session", exact: true }).click();
}

test.describe("composer runtime picker (context chips)", () => {
  test("runtime and model are separate chips, each with its own radio menu", async ({ page }) => {
    await seed(page);
    await page.goto("/?mode=chat");
    const main = page.getByTestId("chat-main");
    const runtimeChip = main.getByRole("button", { name: /change runtime/ });
    const modelChip = main.getByRole("button", { name: /change model/ });
    await expect(runtimeChip).toBeVisible({ timeout: 45_000 });
    await expect(runtimeChip).toContainText("Codex");
    // toContainText retries — the chip settles once model-state hydrates.
    await expect(modelChip).toContainText(CODEX_MODEL.id, { timeout: 15_000 });
    await expect(modelChip).not.toContainText("Codex");

    await runtimeChip.click();
    const runtimeMenu = page.getByRole("menu", { name: "Runtime", exact: true });
    await expect(runtimeMenu).toBeVisible();
    for (const name of ["Codex", "Claude Code", "Hermes", "OpenClaw"]) {
      await expect(runtimeMenu.getByRole("menuitemradio", { name, exact: true })).toBeVisible();
    }
    await expect(runtimeMenu.getByRole("menuitemradio", { name: "Codex", exact: true })).toHaveAttribute("aria-checked", "true");
    // The runtime menu is runtime-only: no model rows ride along any more.
    await expect(runtimeMenu.getByRole("menuitemradio", { name: /GPT-6\.1 Sol/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(runtimeMenu).not.toBeVisible();

    await modelChip.click();
    const modelMenu = page.getByRole("menu", { name: "Model", exact: true });
    await expect(modelMenu).toBeVisible();
    await expect(modelMenu.getByRole("menuitemradio", { name: `${CODEX_MODEL.label} · ${CODEX_MODEL.id}`, exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(modelMenu.getByRole("menuitemradio", { name: "Codex", exact: true })).toHaveCount(0);

    // Codex reports no selected-model controls, so no Thinking / Speed chips.
    await expect(main.getByRole("button", { name: /change thinking/ })).toHaveCount(0);
    await expect(main.getByRole("button", { name: /change speed/ })).toHaveCount(0);
  });

  test("picking a runtime rebinds via /api/config, chains into the Model menu, refreshes the roster, and reveals the reported control chips", async ({ page }) => {
    const state = await seed(page);
    await page.goto("/?mode=chat");
    const main = page.getByTestId("chat-main");
    const runtimeChip = main.getByRole("button", { name: /change runtime/ });
    const modelChip = main.getByRole("button", { name: /change model/ });
    await expect(runtimeChip).toBeVisible({ timeout: 45_000 });
    await expect(modelChip).toContainText(CODEX_MODEL.id, { timeout: 15_000 });
    // The landing identity line reads the roster's familiar.harness. Scoped
    // to the primary chat panel — the shell also mounts a persistent,
    // closed-by-default auxiliary Chat panel (data-testid="right-chat") that
    // renders its own copy of this same `.home-dash__meta` element while
    // unopened, so an unscoped page-wide locator now matches two elements.
    await expect(main.locator(".home-dash__meta")).toContainText("codex");
    const servedBefore = state.familiarsServed;
    const modelStateGetsBefore = state.modelStateServed;

    await runtimeChip.click();
    const runtimeMenu = page.getByRole("menu", { name: "Runtime", exact: true });
    await runtimeMenu.getByRole("menuitemradio", { name: "Claude Code", exact: true }).click();

    // The runtime menu closes and the Model menu opens on the model chip —
    // the switch isn't done until a model is picked, and the Model menu lists
    // the new runtime's reported inventory (cave-bfwk).
    await expect(runtimeMenu).not.toBeVisible();
    const modelMenu = page.getByRole("menu", { name: "Model", exact: true });
    await expect(modelMenu).toBeVisible();
    await expect(modelMenu.getByRole("menuitemradio", { name: `${CLAUDE_MODEL.label} · ${CLAUDE_MODEL.id}`, exact: true })).toBeVisible();

    // The PATCH carries the harness + explicit runtime-default intent. A
    // reported model is selectable, never an implicit launch override.
    await expect(() => {
      const fam = state.configPatches.at(-1)?.familiars as
        | Record<string, { harness?: string; model?: string }>
        | undefined;
      expect(fam?.nova?.harness).toBe("claude");
      expect(Object.prototype.hasOwnProperty.call(fam?.nova ?? {}, "model")).toBe(true);
      expect(fam?.nova?.model).toBe("");
    }).toPass({ timeout: 10_000 });

    // Runtime chip flips (optimistic, then reconciled by the model-state refetch).
    await expect(runtimeChip).toContainText("Claude Code", { timeout: 10_000 });

    // cave:familiars-refresh refetched the roster…
    await expect(() => expect(state.familiarsServed).toBeGreaterThan(servedBefore)).toPass({ timeout: 10_000 });
    // …so the identity line catches up without a reload. Scoped to the
    // primary chat panel — see the earlier assertion in this test for why.
    await expect(main.locator(".home-dash__meta")).toContainText("claude", { timeout: 10_000 });

    // Let the runtime pick's reconciling model-state refetch land before the
    // model pick, so a stale in-flight GET can't overwrite the model PATCH.
    await expect(() => expect(state.modelStateServed).toBeGreaterThan(modelStateGetsBefore)).toPass({ timeout: 10_000 });

    // Picking a model completes the runtime→model switch and closes the menu.
    await modelMenu.getByRole("menuitemradio", { name: `${CLAUDE_MODEL.label} · ${CLAUDE_MODEL.id}`, exact: true }).click();
    await expect(modelMenu).not.toBeVisible();
    await expect(modelChip).toContainText(CLAUDE_MODEL.id, { timeout: 10_000 });

    // The model-state report for Claude carries controls, so the Thinking and
    // Speed chips appear on their own, unset (Auto) until picked.
    await main.getByRole("button", { name: "More composer options", exact: true }).click();
    const thinkingChip = main.getByRole("button", { name: /change thinking/ });
    const speedChip = main.getByRole("button", { name: /change speed/ });
    await expect(thinkingChip).toBeVisible({ timeout: 10_000 });
    await expect(thinkingChip).toContainText("Thinking · Auto");
    await expect(speedChip).toBeVisible();
    await expect(speedChip).toContainText("Speed · Auto");
    await expect(speedChip).toHaveAttribute("title", /Applied by the runtime/);
    await expect(thinkingChip).toHaveAttribute("title", /Sent as prompt guidance/);

    await speedChip.click();
    const speedMenu = page.getByRole("menu", { name: "Speed", exact: true });
    await expect(speedMenu).toBeVisible();
    await expect(speedMenu.getByRole("menuitemradio", { name: "Auto", exact: true })).toHaveAttribute("aria-checked", "true");
    for (const name of ["Fast", "Balanced", "Thorough"]) {
      await expect(speedMenu.getByRole("menuitemradio", { name, exact: true })).toBeVisible();
    }
    await speedMenu.getByRole("menuitemradio", { name: "Thorough", exact: true }).click();
    await expect(speedMenu).not.toBeVisible();
    await expect(speedChip).toContainText("Speed · Thorough");

    // The pick rides the next send as a typed control, nothing else.
    const composer = main.getByRole("textbox", { name: "Message", exact: true });
    await composer.fill("Run with the thorough speed");
    await composer.press("Enter");
    await expect(() => expect(state.sendBodies.length).toBeGreaterThan(0)).toPass({ timeout: 10_000 });
    const sent = state.sendBodies.at(-1) as { modelControls?: Record<string, string>; responseSpeed?: unknown };
    expect(sent.modelControls).toEqual({ performance: "thorough" });
    expect(sent.responseSpeed).toBeUndefined();
  });

  test("unavailable inventory preserves the stored ID without offering it as a model", async ({ page }) => {
    await seed(page, false);
    await page.goto("/?mode=chat");
    const chip = page.getByTestId("chat-main").getByRole("button", { name: /change model/ });
    await expect(chip).toContainText(CODEX_MODEL.id, { timeout: 45_000 });
    await chip.click();
    const menu = page.getByRole("menu", { name: "Model", exact: true });
    await expect(menu.getByText(/Couldn’t load Codex models/)).toBeVisible();
    const selection = menu.getByRole("menuitemradio", {
      name: `Current selection · ${CODEX_MODEL.id} (not in current inventory)`, exact: true,
    });
    await expect(selection).toHaveAttribute("aria-checked", "true");
    await expect(selection).toBeDisabled();
    await expect(menu.getByRole("menuitemradio", {
      name: `${CODEX_MODEL.label} · ${CODEX_MODEL.id}`, exact: true,
    })).toHaveCount(0);
    await expect(menu.getByRole("menuitemradio", { name: "Runtime default", exact: true })).toBeEnabled();
  });
  test("Home shows the same Thinking and Speed chips and carries a pick into the first chat send (#5902)", async ({ page }) => {
    const state = await seed(page, true, "claude");
    // This case inspects controls after an authorized send. The shared capture
    // fixture returns 403, which correctly revokes access and removes them.
    await page.route("**/api/chat/send", (route) => {
      state.sendBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ contentType: "text/event-stream", body: [
        { kind: "assistant_chunk", text: "Controlled Home speed response." },
        { kind: "done" },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
    });
    const PROJECT = { id: "p1", name: "Cave", root: "/repo/cave", access: "write" };
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("p1"));
    });
    await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [PROJECT] } }));
    await page.route("**/api/inbox**", (route) => route.fulfill({ json: { ok: true, items: [] } }));
    await page.route("**/api/chat/conversation/**", (route) => route.fulfill({
      json: { ok: true, conversation: { turns: [] }, context: { task: null, github: [] } },
    }));
    await page.goto("/?mode=home");
    const home = page.locator(".home-composer-root");
    const toolbar = home.locator(".home-composer-toolbar");
    const speedChip = toolbar.getByRole("button", { name: /change speed/ });
    const thinkingChip = toolbar.getByRole("button", { name: /change thinking/ });
    await toolbar.getByRole("button", { name: "More composer options", exact: true }).click();
    await expect(speedChip).toBeVisible({ timeout: 45_000 });
    await expect(speedChip).toContainText("Speed · Auto");
    await expect(thinkingChip).toContainText("Thinking · Auto");

    await speedChip.click();
    const speedMenu = page.getByRole("menu", { name: "Speed", exact: true });
    await speedMenu.getByRole("menuitemradio", { name: "Thorough", exact: true }).click();
    await expect(speedChip).toContainText("Speed · Thorough");

    await home.getByRole("textbox", { name: "Chat message" }).fill("Start thorough from home");
    await home.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(() => expect(state.sendBodies.length).toBeGreaterThan(0)).toPass({ timeout: 15_000 });
    const sent = state.sendBodies.at(-1) as { prompt?: string; modelControls?: Record<string, string> };
    expect(sent.prompt).toBe("Start thorough from home");
    expect(sent.modelControls).toEqual({ performance: "thorough" });

    // The opened chat's chips start from the same pick after the response.
    const chat = page.getByTestId("chat-main");
    await expect(chat.getByText("Controlled Home speed response.", { exact: true })).toBeVisible();
    await chat.getByRole("button", { name: "More composer options", exact: true }).click();
    await expect(chat.getByRole("button", { name: /change speed/ })).toContainText("Speed · Thorough", { timeout: 15_000 });
  });
  test("Codex gets a Thinking chip when its direct transport reports the control, and the pick rides the send (#5905)", async ({ page }) => {
    const state = await seed(page);
    state.codexControls = true;
    await page.goto("/?mode=chat");
    const main = page.getByTestId("chat-main");
    const thinkingChip = main.getByRole("button", { name: /change thinking/ });
    await main.getByRole("button", { name: "More composer options", exact: true }).click();
    await expect(thinkingChip).toBeVisible({ timeout: 45_000 });
    await expect(thinkingChip).toContainText("Thinking · Auto");
    await expect(thinkingChip).toHaveAttribute("title", /Applied by the runtime/);
    // Codex reports no Speed control: that chip stays absent.
    await expect(main.getByRole("button", { name: /change speed/ })).toHaveCount(0);

    await thinkingChip.click();
    const menu = page.getByRole("menu", { name: "Thinking", exact: true });
    await expect(menu.getByRole("menuitemradio", { name: "Extra high", exact: true })).toBeVisible();
    await menu.getByRole("menuitemradio", { name: "High", exact: true }).click();
    await expect(thinkingChip).toContainText("Thinking · High");

    const composer = main.getByRole("textbox", { name: "Message", exact: true });
    await composer.fill("Think it through");
    await composer.press("Enter");
    await expect(() => expect(state.sendBodies.length).toBeGreaterThan(0)).toPass({ timeout: 10_000 });
    const sent = state.sendBodies.at(-1) as { modelControls?: Record<string, string> };
    expect(sent.modelControls).toEqual({ reasoning: "high" });
  });
});


for (const [runtime, modelId] of [
  ["codex", "openai/gpt-6-astra"],
  ["claude", "anthropic/claude-opus-5-5"],
  ["copilot", "github/future-model"],
  ["grok", "xai/future-model"],
  ["hermes", "openrouter/provider/future-model"],
  ["opencode", "provider/future-model"],
]) {
  test(`${runtime} recovers model discovery in place and carries the reported ID into send`, async ({ page, isMobile }, testInfo) => {
    const state = await seed(page, false, runtime);
    let requests = 0;
    let retryRequested = false;
    let release!: () => void;
    const recoveryGate = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/runtime-models/${runtime}?*`, async (route) => {
      // Development Strict Mode can replay the initial discovery effect.
      // Every mount request fails until the user explicitly asks to retry.
      if (!retryRequested) return route.fulfill({ status: 503, json: { ok: false } });
      requests += 1;
      await recoveryGate;
      return route.fulfill({ json: {
        ok: true, runtime, models: [{ id: modelId, label: "Latest reported model" }],
        provenance: "live", freshness: "fresh", refreshState: "ready", availability: "available",
        defaultOwner: "runtime", allowCustom: true, scope: runtimeModelInventoryScope(runtime, "nova"),
      } });
    });
    await openModelChat(page, isMobile);
    const main = page.getByTestId("chat-main");
    const draft = main.getByRole("textbox", { name: "Message", exact: true });
    await draft.fill("Preserve this draft while recovering models");
    const chip = main.getByRole("button", { name: /change model/ });
    await chip.click();
    const menu = page.getByRole("menu", { name: "Model", exact: true });
    await expect(menu.getByText(/Couldn’t load .* models/)).toBeVisible();
    if (runtime === "codex") {
      for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
        await page.evaluate(({ theme, mode }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.mode = mode;
        }, { theme, mode });
        await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`model-recovery-${theme}-${mode}.png`) });
      }
    }
    retryRequested = true;
    await menu.getByRole("menuitem", { name: "Retry model discovery", exact: true }).click();
    await expect(menu.getByText(/Loading .* models/)).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Refreshing models…", exact: true })).toBeDisabled();
    await expect(draft).toHaveValue("Preserve this draft while recovering models");
    await expect.poll(() => requests).toBe(1);
    release();
    // Hold persistence so this proves the immediate next send carries the
    // chosen ID even before the familiar default has finished saving.
    let releaseSave!: () => void;
    state.modelSaveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    try {
      await menu.getByRole("menuitemradio", { name: `Latest reported model · ${modelId}`, exact: true }).click();
      await expect(chip).toContainText(modelId);
      await expect(draft).toHaveValue("Preserve this draft while recovering models");
      await main.getByRole("button", { name: "Send message", exact: true }).click();
      await expect.poll(() => state.sendBodies.length).toBe(1);
      expect(state.sendBodies[0].modelOverride).toBe(modelId);
    } finally {
      releaseSave();
    }
  });
}

test("OpenClaw explains managed models without claiming local discovery", async ({ page, isMobile }) => {
  await seed(page, false, "openclaw");
  await openModelChat(page, isMobile);
  if (isMobile) await page.getByTestId("chat-main").getByRole("textbox", { name: "Message", exact: true }).fill("Keep runtime default");
  await page.getByTestId("chat-main").getByRole("button", { name: /change model/ }).click();
  const menu = page.getByRole("menu", { name: "Model", exact: true });
  await expect(menu.getByText(/OpenClaw manages its own models/)).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Retry model discovery" })).toHaveCount(0);
  await expect(menu.getByRole("menuitemradio", { name: "Runtime default", exact: true })).toBeEnabled();
});
