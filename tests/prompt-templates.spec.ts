import { expect, test, type Page, type Route } from "@playwright/test";

// Template power (cave-jg6k): the composer's /prompt picker inserts a template
// with its first {{placeholder}} selected, Tab cycles the rest (and accepts a
// {{name|default}}), and the Options → "Save draft as template…" flow round-
// trips through /api/prompts with a live re-scan.
//
// Daemon-less: familiars + sessions mocked; /api/prompts is a stateful mock so
// a POST is observably reflected in the next GET (the re-scan the feature
// depends on).

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};

type PromptStore = { prompts: Array<Record<string, unknown>>; posted: Array<Record<string, unknown>> };

async function seed(page: Page): Promise<PromptStore> {
  const store: PromptStore = {
    prompts: [
      {
        id: "release-notes",
        name: "Release notes",
        description: "Turn merges into notes",
        body: "Draft release notes since {{last release|the last tag}}. Group by {{area}}.",
        source: "builtin",
        tags: ["release", "writing"],
      },
    ],
    posted: [],
  };
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
  await page.route("**/api/skills/local**", (route) => route.fulfill({ json: { ok: true, skills: [] } }));
  await page.route("**/api/prompts**", async (route: Route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON() as Record<string, unknown>;
      store.posted.push(body);
      const id = String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const prompt = {
        id,
        name: body.name,
        description: body.description,
        body: body.body,
        source: "user",
        tags: body.tags,
      };
      store.prompts = [...store.prompts.filter((p) => p.id !== id), prompt];
      return route.fulfill({ json: { ok: true, prompt } });
    }
    if (req.method() === "DELETE") {
      const id = new URL(req.url()).searchParams.get("id");
      store.prompts = store.prompts.filter((p) => p.id !== id);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { ok: true, prompts: store.prompts } });
  });
  return store;
}

async function openHomeDraft(page: Page) {
  await page.goto("/?mode=home");
  const draft = page.getByRole("textbox", { name: "Ask anything" });
  await expect(draft).toBeVisible({ timeout: 45_000 });
  return draft;
}

test.describe("prompt templates", () => {
  test("inserting a template selects the first placeholder; Tab cycles and accepts defaults", async ({ page }) => {
    await seed(page);
    const draft = await openHomeDraft(page);

    // Insert via the /prompt picker.
    await draft.fill("/prompt release");
    await page.getByRole("option", { name: /Release notes/ }).first().click();

    // The body lands with the first token — the defaulted one — selected.
    await expect(draft).toHaveValue(/Draft release notes since \{\{last release\|the last tag\}\}\. Group by \{\{area\}\}\./);
    const firstSel = await draft.evaluate((el: HTMLTextAreaElement) =>
      el.value.slice(el.selectionStart, el.selectionEnd),
    );
    expect(firstSel).toBe("{{last release|the last tag}}");

    // Tab on the selected defaulted token accepts the default, then jumps to
    // the next placeholder.
    await draft.press("Tab");
    await expect(draft).toHaveValue(/Draft release notes since the last tag\. Group by \{\{area\}\}\./);
    const nextSel = await draft.evaluate((el: HTMLTextAreaElement) =>
      el.value.slice(el.selectionStart, el.selectionEnd),
    );
    expect(nextSel).toBe("{{area}}");

    // Typing replaces the selected token; Tab with no tokens left falls
    // through to native focus-move (draft unchanged, blur off the textarea).
    await page.keyboard.type("area");
    await expect(draft).toHaveValue("Draft release notes since the last tag. Group by area.");
  });

  test("Save draft as template round-trips and re-scans the picker", async ({ page }) => {
    const store = await seed(page);
    const draft = await openHomeDraft(page);
    await draft.fill("Summarize {{topic}} for {{audience|the team}}.");

    // Options → Save draft as template…
    await page.getByRole("button", { name: "Composer options" }).click();
    await page.getByRole("button", { name: "Save draft as template…" }).click();

    // Fill the form and save.
    const nameField = page.getByRole("textbox", { name: "Name" });
    await expect(nameField).toBeVisible();
    await nameField.fill("Standup update");
    await page.getByRole("button", { name: "Save template" }).click();

    // The POST carried the draft body + name; the modal closed.
    await expect(() => {
      expect(store.posted.at(-1)?.name).toBe("Standup update");
      expect(String(store.posted.at(-1)?.body)).toContain("{{topic}}");
    }).toPass({ timeout: 10_000 });
    await expect(nameField).toBeHidden();

    // The refresh event re-scanned: the new template shows in the /prompt picker.
    await draft.fill("/prompt standup");
    await expect(page.getByRole("option", { name: /Standup update/ })).toBeVisible({ timeout: 10_000 });
  });
});
