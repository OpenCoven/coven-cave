import type { Page } from "@playwright/test";

/** Boot Cave with one active familiar and no projects, which opens the
 *  first-project gate on Home and Chat. Daemon-less: routes are mocked. */
export async function openFirstProjectGate(page: Page, path = "/?mode=chat") {
  await page.context().addCookies([
    { name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" },
  ]);
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
  });
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
  await page.goto(path);
  const gate = page.getByRole("dialog", { name: "Create your first project" });
  await gate.waitFor({ timeout: 60_000 });
  return gate;
}
