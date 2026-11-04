import { expect, type Page } from "@playwright/test";
import {
  createOnboardingBootstrapState,
  ONBOARDING_BOOTSTRAP_BOUNDARIES,
  type OnboardingBootstrapState,
} from "../src/lib/onboarding-bootstrap";

export const now = new Date().toISOString();
// `cave:onboarding:dismissed` alone is not enough: the workspace still asks the
// bootstrap endpoint whether setup is needed, and an unmocked answer mounts the
// setup flow where .chat-surface should be. Serve a completed state instead.
const initialBootstrap = createOnboardingBootstrapState(true);
const completedBootstrap: OnboardingBootstrapState = {
  ...initialBootstrap,
  complete: true,
  needsSetup: false,
  status: "complete",
  stages: initialBootstrap.stages.map((stage) => ({
    ...stage,
    status: "complete",
    detail: "Ready in the chat fixture.",
  })),
};
const familiars = [
  { id: "cody", display_name: "Cody", role: "Code Familiar", status: "active", icon: "ph:code" },
  { id: "sage", display_name: "Sage", role: "Research Familiar", status: "active", icon: "ph:book-open" },
];
const projects = ["alpha", "beta"].map((id) => ({
  id, name: `Context ${id}`, root: `/context/${id}`, access: "write", createdAt: now, updatedAt: now,
}));
const sessions = [
  { id: "context-a", familiarId: "cody", project_root: "/context/alpha", title: "Context thread A" },
  { id: "context-b", familiarId: "cody", project_root: "/context/beta", title: "Context thread B" },
].map((session) => ({
  ...session, status: "completed", origin: "chat", harness: "codex", exit_code: null,
  archived_at: null, created_at: now, updated_at: now,
  attention: { state: "none", since: null, reason: null },
}));

export async function setup(page: Page, betaFamiliar = "cody", pendingSessions?: Promise<void>, pendingHistory?: Promise<void>) {
  const conversationRequests: string[] = [];
  // Next dev uses its HMR socket for hydration debug data. Block only app sockets.
  await page.context().routeWebSocket((url) => url.pathname !== "/_next/hmr", (socket) => socket.close());
  await page.addInitScript((betaFamiliar) => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
    // Chat surfaces mount lazily now (#5451), so the familiar has to already
    // own chat as its last surface or `?mode=chat` lands on a shell that never
    // renders .chat-surface. Same seed the split-pane spec uses.
    localStorage.setItem("cave:familiar:cody:last-surface", "chat");
    localStorage.setItem("cave:shell:nav-open", "1");
    localStorage.setItem("cave:workspace:familiar-scope-by-project:v1",
      JSON.stringify({ "__all-projects__": ["cody"], alpha: ["cody"], beta: [betaFamiliar] }));
  }, betaFamiliar);
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
    else if (url.pathname === "/api/projects") payload = { ok: true, projects };
    else if (url.pathname === "/api/sessions/list") {
      if (pendingSessions) await pendingSessions;
      payload = { ok: true, sessions: pendingSessions ? sessions.map((session) => ({
        ...session, updated_at: session.id === "context-b" ? new Date(Date.parse(now) + 1_000).toISOString() : now,
      })) : sessions };
    }
    else if (url.pathname === "/api/queue/project") payload = { ok: true, projectId: "alpha", project: projects[0] };
    else if (url.pathname === "/api/daemon/connection") payload = { ok: true, connected: true, running: true, target: { mode: "local" } };
    else if (url.pathname === "/api/memory") payload = { ok: true, entries: [] };
    else if (url.pathname === "/api/board") payload = { ok: true, cards: [] };
    else if (url.pathname === "/api/inbox") payload = { ok: true, items: [] };
    else if (url.pathname === "/api/github/tasks") payload = { ok: true, tasks: [] };
    else if (url.pathname.startsWith("/api/chat/conversation/")) {
      if (pendingHistory) await pendingHistory;
      const id = url.pathname.split("/").at(-1)!;
      conversationRequests.push(id);
      const turns = Array.from({ length: 1_000 }, (_, index) => ({
        id: `${id}-${index}`, parentId: index ? `${id}-${index - 1}` : null,
        role: index % 2 ? "assistant" : "user",
        text: `${id} message ${index}. ${index === 0 ? "Only oldest needle." : "A synthetic transcript turn."}`,
        createdAt: now,
      }));
      payload = { ok: true, conversation: { id, turns, activeLeafId: turns.at(-1)!.id }, context: null };
    }
    await route.fulfill({ json: payload });
  });
  // The root route resolves bootstrap state on the SERVER, before Playwright can
  // intercept any client API call, and it reads a cookie — not localStorage. So
  // `cave:onboarding:dismissed` alone leaves the first-run "Set up Cave" dialog
  // covering the surface and .chat-surface never mounts. Seed the
  // server-readable dismissal first, exactly as onboarding-wizard.spec.ts does.
  await page.context().addCookies([
    { name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("/?mode=chat");
  // The side panel is a separate conversation surface. Open the main Chat
  // destination after hydration, as the Chat/Code workflow fixture does.
  await page.waitForFunction(() => {
    window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } }));
    return document.querySelector(".chat-surface") !== null;
  }, undefined, { timeout: 30_000 });
  await expect(page.locator(".chat-surface")).toBeVisible({ timeout: 30_000 });
  if (!pendingSessions) {
    await expect(page.locator(".cnav__thread-main").filter({ hasText: "Context thread A" }).first()).toBeVisible();
  }
  return conversationRequests;
}

export async function openThread(page: Page, letter: "A" | "B") {
  await page.locator(".cnav__thread-main").filter({ hasText: `Context thread ${letter}` }).first().click();
  await expect(page.getByTestId("chat-main").locator(`[data-turn-id="context-${letter.toLowerCase()}-999"]`)).toBeAttached();
}

export async function switchProject(page: Page, projectId: "alpha" | "beta") {
  const switcher = page.locator(".workspace-context-switcher:visible").first();
  await switcher.getByRole("button", { name: /^Switch project:/ }).click();
  await page.locator(".cave-project-picker__row").filter({ hasText: `Context ${projectId}` }).first().locator(".ui-popover-item").click();
}
