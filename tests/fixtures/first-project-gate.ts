import type { Page } from "@playwright/test";

/** Seed a daemon-less Cave with one familiar (Cody) and no projects. With
 *  `activeFamiliar` (the default) Cody is the active familiar, which opens the
 *  first-project gate on Home and Chat by itself; without it the gate waits
 *  for an explicit request (#5982). */
export async function seedFirstProjectGate(page: Page, options: { activeFamiliar?: boolean } = {}) {
  const activeFamiliar = options.activeFamiliar ?? true;
  await page.context().addCookies([
    { name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" },
  ]);
  await page.addInitScript((withActive: boolean) => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    if (withActive) localStorage.setItem("cave:active-familiar", "cody");
  }, activeFamiliar);
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [{ id: "cody", display_name: "Cody", role: "Implementer", status: "active", icon: "ph:code" }],
      },
    }),
  );
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
}

/** Boot Cave with one active familiar and no projects, which opens the
 *  first-project gate on Home and Chat. Daemon-less: routes are mocked. */
export async function openFirstProjectGate(page: Page, path = "/?mode=chat") {
  await seedFirstProjectGate(page);
  await page.goto(path);
  const gate = page.getByRole("dialog", { name: "Create your first project" });
  await gate.waitFor({ timeout: 60_000 });
  return gate;
}
