import { expect, test, type Page } from "@playwright/test";
import { createOnboardingBootstrapState, ONBOARDING_BOOTSTRAP_BOUNDARIES } from "../src/lib/onboarding-bootstrap";

const ISO = "2026-11-08T09:00:00.000Z";
const ANSWER = "Set MAX_RETRY_COUNT to 3; use snake_case_name here; file_a and file_b.\n\n_real emphasis_ and __real bold__ with `inline_code_name`.\n\n| Identifier | Value |\n| --- | --- |\n| MAX_RETRY_COUNT | snake_case_name |";
const project = { id: "underscore-project", name: "Underscore project", root: "/tmp/underscore-project", access: "write", createdAt: ISO, updatedAt: ISO };

async function setup(page: Page) {
  let completed = false;
  await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" }]);
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    let controller: ReadableStreamDefaultController<Uint8Array>;
    Object.assign(window, { underscoreFrame(frame: { kind: string }) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`));
      if (frame.kind === "done") controller.close();
    } });
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === "/api/chat/send") {
        return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }), { headers: { "content-type": "text/event-stream" } });
      }
      return original(...args);
    };
    Object.assign(window, { underscoreCopied: "" });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { Object.assign(window, { underscoreCopied: text }); },
    } });
  });
  await page.context().routeWebSocket((url) => url.pathname !== "/_next/hmr", (socket) => socket.close());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let payload: object = { ok: true };
    if (path === "/api/onboarding/bootstrap") {
      const bootstrap = createOnboardingBootstrapState(true);
      payload = { ...bootstrap, ok: true, complete: true, needsSetup: false, status: "complete", stages: bootstrap.stages.map((stage) => ({ ...stage, status: "complete" })), boundaries: ONBOARDING_BOOTSTRAP_BOUNDARIES };
    } else if (path === "/api/onboarding/status") payload = { ok: true, complete: true, steps: {}, tools: [] };
    else if (path === "/api/familiars") payload = { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] };
    else if (path === "/api/projects") payload = { ok: true, projects: [project] };
    else if (path === "/api/queue/project") payload = { ok: true, projectId: project.id, project };
    else if (path === "/api/daemon/connection") payload = { ok: true, running: true, connected: true, target: { mode: "local" } };
    else if (path === "/api/board") payload = { ok: true, cards: [] };
    else if (path === "/api/inbox") payload = { ok: true, items: [] };
    else if (path === "/api/memory") payload = { ok: true, entries: [] };
    else if (path === "/api/sessions/list") payload = { ok: true, sessions: [{ id: "underscore-6391", title: "Identifier rendering", status: "completed", origin: "chat", project_root: project.root, harness: "hermes", familiarId: "nova", exit_code: 0, archived_at: null, created_at: ISO, updated_at: ISO }] };
    else if (path.startsWith("/api/chat/conversation/")) payload = { ok: true, context: { task: null, github: [] }, conversation: { familiarId: "nova", activeLeafId: "answer", turns: [
      { id: "request", parentId: null, role: "user", text: "Show identifiers", createdAt: ISO },
      { id: "answer", parentId: "request", role: "assistant", text: completed ? ANSWER : "Ready for identifiers.", createdAt: ISO, lifecycle: "complete" },
    ] } };
    await route.fulfill({ json: payload });
  });
  await page.goto("/?mode=chat#chat-underscore-6391", { waitUntil: "domcontentloaded" });
  const main = page.getByTestId("chat-main");
  await expect(main.getByText("Ready for identifiers.")).toBeVisible({ timeout: 45_000 });
  return { main, complete: () => { completed = true; } };
}

async function emit(page: Page, frame: object) {
  await page.evaluate((value) => (window as unknown as { underscoreFrame(frame: object): void }).underscoreFrame(value), frame);
}

for (const appearance of ["dark", "light", "tide"] as const) {
  test(`identifiers, emphasis and raw Copy survive streaming and reload (${appearance})`, async ({ page }) => {
    const { main, complete } = await setup(page);
    await page.evaluate((mode) => {
      document.documentElement.setAttribute("data-mode", mode === "light" ? "light" : "dark");
      document.documentElement.setAttribute("data-theme", mode === "tide" ? "tide" : "coven");
    }, appearance);
    await main.getByRole("textbox", { name: "Message", exact: true }).fill("Show identifiers literally");
    await main.getByRole("button", { name: "Send message", exact: true }).click();
    // Split within identifiers so the pending render sees partial delimiters too.
    await emit(page, { kind: "assistant_chunk", text: "Set MAX_RETRY_" });
    const live = main.locator(".cave-bubble-assistant").last();
    await expect(live.locator(".cave-md").first()).toContainText("MAX_RETRY_");
    await emit(page, { kind: "assistant_chunk", text: ANSWER.slice("Set MAX_RETRY_".length) });
    const assertOutput = async (settled = false) => {
      const body = main.locator(".cave-bubble-assistant").last();
      await expect(body.locator(".cave-md").first()).toContainText("Set MAX_RETRY_COUNT to 3; use snake_case_name here; file_a and file_b.");
      await expect(body.locator(".cave-md em")).toHaveText(["real emphasis"]);
      await expect(body.locator(".cave-md strong")).toHaveText(["real bold"]);
      await expect(body.locator(".cave-md code")).toHaveText(["inline_code_name"]);
      // In-flight tables remain raw until the response settles.
      if (settled) await expect(body.locator("td")).toHaveText(["MAX_RETRY_COUNT", "snake_case_name"]);
      else await expect(body).toContainText("MAX_RETRY_COUNT | snake_case_name");
    };
    await assertOutput();
    complete();
    await emit(page, { kind: "done", sessionId: "underscore-6391" });
    await assertOutput(true);
    await live.getByRole("button", { name: "Copy completed response", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { underscoreCopied: string }).underscoreCopied)).toBe(ANSWER);
    await page.screenshot({ path: test.info().outputPath(`identifiers-${appearance}.png`), fullPage: true });
    await page.reload();
    await assertOutput(true);
    await main.locator(".cave-bubble-assistant").last().getByRole("button", { name: "Copy completed response", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { underscoreCopied: string }).underscoreCopied)).toBe(ANSWER);
  });
}
