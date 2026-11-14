import { expect, test, type Page } from "@playwright/test";
import { createOnboardingBootstrapState, ONBOARDING_BOOTSTRAP_BOUNDARIES } from "../src/lib/onboarding-bootstrap";

// golden-15 (#6066): a legacy transcript through the real conversation route.
//
// tests/chat-activity-acceptance.spec.ts fulfils the history request itself, so
// its "legacy" rows prove only the client's own <thinking> fallback. This spec
// stores a legacy turn through the real PUT route and reads it back through the
// real GET route and its display projection, then renders it in the built
// client. Legacy tags are not provider-designated summaries, so the server
// removes their content: the answer survives, no reasoning is shown under any
// saved preference, nothing flashes, hydration never rewrites the saved choice,
// and chat search neither matches nor quotes the withheld text. Shell endpoints
// that need a daemon stay fixtures.

const ISO = "2026-10-18T12:00:00.000Z";
const LEGACY_REASONING = "Golden fifteen legacy reasoning that only the stored turn may hold.";
const ANSWER = "The legacy comparison is complete.";
const project = { id: "legacy-history-project", name: "Legacy history project", root: "/tmp/legacy-history-project", access: "write", createdAt: ISO, updatedAt: ISO };

async function openStoredSession(page: Page, sessionId: string, saved: string | null) {
  await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" }]);
  await page.addInitScript(({ saved, reasoning }) => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    if (saved === null) localStorage.removeItem("cave:chat:show-thinking");
    else localStorage.setItem("cave:chat:show-thinking", saved);
    // One sample per frame from the first frame of every navigation: a
    // reasoning block or the stored reasoning text appearing for a single
    // frame is a flash.
    const frames: Array<{ block: boolean; text: boolean }> = [];
    Object.assign(window, { legacyFrames: frames });
    const sample = () => {
      const main = document.querySelector('[data-testid="chat-main"]');
      if (main && frames.length < 600) {
        frames.push({ block: main.querySelector(".cave-reasoning-block") !== null, text: (main.textContent ?? "").includes(reasoning) });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { saved, reasoning: LEGACY_REASONING });
  await page.context().routeWebSocket((url) => url.pathname !== "/_next/hmr", (socket) => socket.close());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    // The transcript itself is never a fixture here.
    if (path.startsWith("/api/chat/conversation/")) return route.continue();
    const bootstrap = createOnboardingBootstrapState(true);
    let payload: object = { ok: true };
    if (path === "/api/onboarding/bootstrap") payload = { ...bootstrap, ok: true, complete: true, needsSetup: false, status: "complete", stages: bootstrap.stages.map((stage) => ({ ...stage, status: "complete" })), boundaries: ONBOARDING_BOOTSTRAP_BOUNDARIES };
    else if (path === "/api/onboarding/status") payload = { ok: true, complete: true, steps: {}, tools: [] };
    else if (path === "/api/familiars") payload = { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] };
    else if (path === "/api/projects") payload = { ok: true, projects: [project] };
    else if (path === "/api/queue/project") payload = { ok: true, projectId: project.id, project };
    else if (path === "/api/daemon/connection") payload = { ok: true, running: true, connected: true, target: { mode: "local" } };
    else if (path === "/api/inbox") payload = { ok: true, items: [] };
    else if (path === "/api/board") payload = { ok: true, cards: [] };
    else if (path === "/api/memory") payload = { ok: true, entries: [] };
    else if (path === "/api/sessions/list") payload = { ok: true, sessions: [{ id: sessionId, title: "Legacy history", status: "completed", origin: "chat", project_root: project.root, harness: "hermes", familiarId: "nova", exit_code: 0, archived_at: null, created_at: ISO, updated_at: ISO }] };
    await route.fulfill({ json: payload });
  });
  await page.goto(`/?mode=chat#chat-${sessionId}`, { waitUntil: "domcontentloaded" });
  return page.getByTestId("chat-main");
}

for (const saved of [null, "0", "1", "unrecognized"] as const) {
  test(`stored legacy transcript hydrates through the real conversation route without its reasoning (preference ${saved ?? "default"})`, async ({ page, request }, info) => {
    const sessionId = `golden15-legacy-${saved ?? "default"}-${info.project.name}-${info.workerIndex}-${Date.now()}`;
    const route = `/api/chat/conversation/${encodeURIComponent(sessionId)}`;
    // Tokens only this conversation holds, so a shared store cannot mask a hit.
    const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const reasoningToken = `withheld${unique}`;
    const answer = `${ANSWER} shown${unique}`;
    const storedText = `<thinking>${LEGACY_REASONING} ${reasoningToken}</thinking>\n${answer}`;
    try {
      const stored = await request.put(route, { data: { familiarId: "nova", harness: "hermes", title: "Legacy history", activeLeafId: "answer", turns: [
        { id: "request", parentId: null, role: "user", text: "Compare the files", createdAt: ISO },
        { id: "answer", parentId: "request", role: "assistant", text: storedText, createdAt: ISO },
      ] } });
      expect(stored.ok()).toBe(true);
      // The store keeps the turn exactly as written; only display is projected.
      expect((await stored.json()).conversation.turns[1].text).toBe(storedText);

      const displayed = await request.get(`${route}?toolOutputs=recent`);
      expect(displayed.ok()).toBe(true);
      const body = await displayed.text();
      expect(body).not.toContain(LEGACY_REASONING);
      expect(body.toLowerCase()).not.toContain("<thinking>");
      expect(body).not.toContain(reasoningToken);
      const displayedAnswer = (JSON.parse(body) as { conversation: { turns: Array<{ id: string; text: string; reasoning?: string }> } }).conversation.turns.find((turn) => turn.id === "answer")!;
      expect(displayedAnswer.text.trim()).toBe(answer);
      expect(displayedAnswer.reasoning).toBeUndefined();

      // Search reads the same store. It finds the answer and never the reasoning.
      type Hit = { sessionId: string; snippet: string };
      const search = async (q: string) => ((await (await request.get(`/api/chat/search?q=${encodeURIComponent(q)}`)).json()) as { hits: Hit[] }).hits.filter((hit) => hit.sessionId === sessionId);
      expect(await search(reasoningToken)).toEqual([]);
      const answerHits = await search(`shown${unique}`);
      expect(answerHits).toHaveLength(1);
      expect(answerHits[0].snippet).not.toContain("withheld");
      expect(answerHits[0].snippet.toLowerCase()).not.toContain("thinking");

      const main = await openStoredSession(page, sessionId, saved);
      await expect(main.getByText(answer, { exact: true })).toBeVisible({ timeout: 45_000 });
      await page.reload();
      await expect(main.getByText(answer, { exact: true })).toBeVisible({ timeout: 45_000 });
      const frames = () => page.evaluate(() => (window as unknown as { legacyFrames: Array<{ block: boolean; text: boolean }> }).legacyFrames);
      await expect.poll(async () => (await frames()).length).toBeGreaterThan(0);
      expect((await frames()).filter((frame) => frame.block || frame.text)).toEqual([]);
      await expect(main.locator(".cave-reasoning-block")).toHaveCount(0);
      await expect(main.getByText(LEGACY_REASONING)).toHaveCount(0);
      expect(await page.content()).not.toContain(LEGACY_REASONING);
      // Hydration reads the saved choice and never writes one.
      expect(await page.evaluate(() => localStorage.getItem("cave:chat:show-thinking"))).toBe(saved);
    } finally {
      await request.delete(route);
    }
  });
}
