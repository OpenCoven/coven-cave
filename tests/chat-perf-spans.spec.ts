import { expect, test, type Page } from "@playwright/test";
import {
  createOnboardingBootstrapState,
  ONBOARDING_BOOTSTRAP_BOUNDARIES,
  type OnboardingBootstrapState,
} from "../src/lib/onboarding-bootstrap";

// #5448: opening a thread and switching project record their latency spans
// (read by the dev perf overlay and the perf store).

const now = new Date().toISOString();
const initialBootstrap = createOnboardingBootstrapState(true);
const completedBootstrap: OnboardingBootstrapState = {
  ...initialBootstrap,
  complete: true,
  needsSetup: false,
  status: "complete",
  stages: initialBootstrap.stages.map((stage) => ({ ...stage, status: "complete", detail: "Ready in the fixture." })),
};
const familiars = [{ id: "cody", display_name: "Cody", role: "Code Familiar", status: "active", icon: "ph:code" }];
const projects = ["alpha", "beta"].map((id) => ({
  id, name: `Scope ${id}`, root: `/scope/${id}`, access: "write", createdAt: now, updatedAt: now,
}));
const sessions = [
  { id: "scope-a", project_root: "/scope/alpha", title: "Scope thread A" },
  { id: "scope-b", project_root: "/scope/beta", title: "Scope thread B" },
].map((session) => ({
  ...session, familiarId: "cody", status: "completed", origin: "chat", harness: "codex", exit_code: null,
  archived_at: null, created_at: now, updated_at: now, attention: { state: "none", since: null, reason: null },
}));

type ScopedProjects = "ok" | "hold" | "fail";

async function setup(page: Page, options: { project?: string; scopedProjects?: ScopedProjects; release?: Promise<void> } = {}) {
  await page.addInitScript(() => {
    (window as unknown as { __caveSpans: string[] }).__caveSpans = [];
    window.addEventListener("cave:perf-measure", (event) => {
      (window as unknown as { __caveSpans: string[] }).__caveSpans.push((event as CustomEvent<{ name: string }>).detail.name);
    });
  });
  await page.context().routeWebSocket((url) => url.pathname !== "/_next/hmr", (socket) => socket.close());
  await page.addInitScript((project) => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
    localStorage.setItem("cave:familiar:cody:last-surface", "chat");
    localStorage.setItem("cave:shell:nav-open", "1");
    localStorage.setItem("cave:workspace:familiar-scope-by-project:v1",
      JSON.stringify({ "__all-projects__": ["cody"], alpha: ["cody"], beta: ["cody"] }));
    if (project) localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify(project));
  }, options.project ?? null);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      await route.fulfill({ status: 403, json: { ok: false, error: "Fixture forbids live mutations" } });
      return;
    }
    let payload: object = { ok: true };
    if (url.pathname === "/api/onboarding/bootstrap") {
      payload = { ok: true, ...completedBootstrap, boundaries: ONBOARDING_BOOTSTRAP_BOUNDARIES };
    }
    else if (url.pathname === "/api/onboarding/status") payload = { ok: true, complete: true, steps: {}, tools: [] };
    else if (url.pathname === "/api/familiars") payload = { ok: true, familiars };
    else if (url.pathname === "/api/projects") {
      // Only the chat surface's familiar-scoped fetch is held or failed; the
      // workspace's own project list resolves, so the scope itself is valid.
      if (url.searchParams.get("familiarId")) {
        if (options.scopedProjects === "hold") await options.release;
        if (options.scopedProjects === "fail") {
          await route.fulfill({ status: 500, json: { ok: false, error: "projects unavailable" } });
          return;
        }
      }
      payload = { ok: true, projects };
    }
    else if (url.pathname === "/api/sessions/list") payload = { ok: true, sessions };
    else if (url.pathname === "/api/daemon/connection") payload = { ok: true, connected: true, running: true, target: { mode: "local" } };
    else if (url.pathname === "/api/board") payload = { ok: true, cards: [] };
    else if (url.pathname === "/api/inbox") payload = { ok: true, items: [] };
    else if (url.pathname === "/api/github/tasks") payload = { ok: true, tasks: [] };
    else if (url.pathname.startsWith("/api/chat/conversation/")) {
      const id = url.pathname.split("/").at(-1)!;
      payload = {
        ok: true,
        context: null,
        conversation: { id, activeLeafId: `${id}-1`, turns: [{ id: `${id}-1`, parentId: null, role: "user", text: `${id} opened`, createdAt: now }] },
      };
    }
    await route.fulfill({ json: payload });
  });
  await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/?mode=chat");
  await page.waitForFunction(() => {
    window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } }));
    return document.querySelector(".chat-surface") !== null;
  }, undefined, { timeout: 30_000 });
  await expect(page.locator(".chat-surface")).toBeVisible({ timeout: 30_000 });
}

const rail = (page: Page) => page.locator('aside[aria-label="Chat threads"] .chat-sidebar');
const spans = (page: Page) => page.evaluate(() => (window as unknown as { __caveSpans: string[] }).__caveSpans);

test("opening a thread and switching project record their latency spans (#5448)", async ({ page }) => {
  await setup(page);
  await rail(page).locator(".cnav__thread-main").filter({ hasText: "Scope thread A" }).first().click();
  await expect(page.getByTestId("chat-main").getByText("scope-a opened")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => spans(page)).toContain("chat:thread-open");

  const switcher = page.locator(".workspace-context-switcher:visible").first();
  await switcher.getByRole("button", { name: /^Switch project:/ }).click();
  await page.locator(".cave-project-picker__row").filter({ hasText: "Scope beta" }).first().locator(".ui-popover-item").click();
  await expect.poll(() => spans(page)).toContain("chat:project-switch");
});
