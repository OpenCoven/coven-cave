import { expect, test, type Page } from "@playwright/test";
import { createOnboardingBootstrapState, ONBOARDING_BOOTSTRAP_BOUNDARIES } from "../src/lib/onboarding-bootstrap";
import { createDefaultPreferences } from "../src/lib/preferences-schema";

const ISO = "2026-11-04T10:00:00.000Z";
const PROJECT = { id: "overview-project", name: "Overview project", root: "/repo", access: "write", createdAt: ISO, updatedAt: ISO };
const FAMILIARS = [
  { id: "nova", display_name: "Shared name", role: "Orchestrator", status: "active", icon: "ph:moon" },
  { id: "echo", display_name: "Shared name", role: "Correspondence", status: "active", icon: "ph:moon" },
];
function session(id: string, changes: object = {}) {
  return { id, familiarId: "nova", title: id, harness: "hermes", runtime: "local:/repo", status: "completed", project_root: "/repo", exit_code: 0, archived_at: null, created_at: ISO, updated_at: ISO, attention: { state: "none", since: null, reason: null }, ...changes };
}
const INITIAL = [
  session("approval", { title: "Review the bounded request", attention: { state: "awaiting-human", reason: "approval", since: ISO } }),
  session("work", { title: "Compare the sources", status: "running" }),
  session("complete", { title: "Reported completion" }),
  session("unknown", { title: "Unrecognized producer state", status: "future-status" }),
  session("elsewhere", { title: "A request in another project", project_root: "/other", attention: { state: "awaiting-human", reason: "input", since: ISO } }),
];

async function setup(page: Page, initialHttp = 200) {
  const state = { rows: INITIAL.map((row) => ({ ...row })), degraded: false, http: initialHttp, connection: "running", holdEcho: false, releaseEcho: () => {}, reads: 0, preferences: createDefaultPreferences(true) };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" }]);
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:shell:nav-open", "0");
    localStorage.setItem("cave:shell:nav-open:source", "user");
    localStorage.setItem("cave:familiar:nova:last-surface", "home");
    localStorage.setItem("cave:familiar:echo:last-surface", "home");
    localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("overview-project"));
    localStorage.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify({ "overview-project": ["nova"] }));
  });
  await page.context().routeWebSocket((url) => url.pathname !== "/_next/hmr", (socket) => socket.close());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/inbox/stream") {
      await route.fulfill({ contentType: "text/event-stream", body: ": idle inbox fixture\n\n" });
      return;
    }
    const bootstrap = createOnboardingBootstrapState(true);
    let payload: object = { ok: true };
    if (path === "/api/onboarding/bootstrap") payload = { ...bootstrap, ok: true, complete: true, needsSetup: false, status: "complete", stages: bootstrap.stages.map((stage) => ({ ...stage, status: "complete" })), boundaries: ONBOARDING_BOOTSTRAP_BOUNDARIES };
    else if (path === "/api/onboarding/status") payload = { ok: true, complete: true, steps: {}, tools: [] };
    else if (path === "/api/preferences") payload = { ok: true, preferences: state.preferences };
    else if (path === "/api/familiars") payload = { ok: true, familiars: FAMILIARS };
    else if (path === "/api/projects") payload = { ok: true, projects: [PROJECT] };
    else if (path === "/api/queue/project") payload = { ok: true, projectId: PROJECT.id, project: PROJECT };
    else if (path === "/api/daemon/connection") payload = state.connection === "running" ? { ok: true, running: true, connected: true, target: { mode: "local" } } : { ok: false, running: false, target: { mode: "hub" }, availability: "unreachable" };
    else if (path === "/api/inbox") payload = { ok: true, items: [] };
    else if (path === "/api/board") payload = { ok: true, cards: [] };
    else if (path === "/api/memory") payload = { ok: true, entries: [] };
    else if (path === "/api/sessions/list") {
      state.reads += 1;
      if (url.searchParams.get("familiarId") === "echo") {
        if (state.holdEcho) await new Promise<void>((resolve) => { state.releaseEcho = resolve; });
        payload = { ok: true, sessions: [session("echo-session", { familiarId: "echo", title: "Echo’s exact session" })] };
      } else payload = { ok: true, sessions: state.rows, degraded: state.degraded };
      await route.fulfill({ status: state.http, json: payload });
      return;
    } else if (path.startsWith("/api/chat/conversation/")) payload = { ok: true, context: { task: null, tasks: [], github: [] }, conversation: { familiarId: "nova", activeLeafId: "answer", turns: [{ id: "answer", parentId: null, role: "assistant", text: "Exact existing conversation.", createdAt: ISO }] } };
    await route.fulfill({ json: payload });
  });
  await page.goto("/?mode=home", { waitUntil: "domcontentloaded" });
  // Next can retain a hidden server-rendered Suspense copy during hydration.
  // Qualify the actual visible client, and require exactly one such surface.
  const overview = page.locator(".home-overview:visible");
  await expect(overview).toHaveCount(1, { timeout: 45_000 });
  await expect(overview).toHaveAttribute("data-observation", initialHttp === 200 ? "current" : "unavailable", { timeout: 45_000 });
  return { state, errors, overview };
}

test("overview answers from canonical observations without inventing receipts and fits themes and widths", async ({ page }, info) => {
  const { overview, errors } = await setup(page);
  await expect(page.getByRole("heading", { name: "Home", level: 1, exact: true })).toHaveCount(1);
  await expect(overview.getByRole("heading", { name: "Overview", level: 2, exact: true })).toBeVisible();
  await expect(overview.getByRole("heading", { name: "Needs you · 1", level: 3, exact: true })).toBeVisible();
  await expect(overview.getByRole("heading", { name: "Needs you · 1", exact: true })).toBeVisible();
  await expect(overview.getByRole("heading", { name: "Needs you in other permitted projects · 1", exact: true })).toBeVisible();
  await expect(overview.locator('[data-home-session="unknown"]')).toContainText("State unavailable");
  await expect(overview.locator('[data-home-session="complete"]')).toContainText("Completed");
  await expect(overview).toContainText("A completed session is not proof of a committed effect");
  await expect(overview.getByRole("button", { name: /Approve|Retry|Revoke/ })).toHaveCount(0);
  const references = overview.locator("li", { has: page.locator('[data-home-session="approval"]') }).locator("details");
  await references.locator("summary").press("Enter");
  await expect(references).toContainText("nova");
  await expect(references).toContainText("/repo");
  await expect(references).toContainText("Not supplied by this session list");
  await references.locator("summary").press("Escape");
  await expect(references.locator("summary")).toBeFocused();
  await expect(references).not.toHaveAttribute("open", "");
  for (const [width, theme, mode] of [[1440, "coven", "dark"], [1440, "coven", "light"], [1100, "tide", "dark"], [390, "coven", "dark"]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(([theme, mode]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.mode = mode; }, [theme, mode]);
    await expect.poll(() => overview.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const closeNav = page.getByRole("button", { name: "Close navigation", exact: true });
    if (await closeNav.isVisible()) await closeNav.click();
    if (width < 768) {
      await expect.poll(() => page.locator(".shell-nav-panel").evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).display === "none" || node.getBoundingClientRect().right <= 1)), "the navigation panel has finished leaving the content viewport").toBe(true);
    }
    await page.locator(".home-composer-root").evaluate((node) => { node.scrollTop = 0; });
    await expect(overview.getByRole("heading", { name: "Overview", exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`overview-${width}-${theme}-${mode}.png`), animations: "disabled" });
    await page.locator(".home-composer-root").evaluate((node) => {
      const note = node.querySelector(".home-overview__note")!;
      node.scrollTop += note.getBoundingClientRect().top - node.getBoundingClientRect().top - 20;
    });
    await expect.poll(() => overview.locator(".home-overview__note").first().evaluate((node) => {
      const navigation = document.querySelector(".mobile-bottom-tabs");
      const bottom = navigation && getComputedStyle(navigation).display !== "none" ? navigation.getBoundingClientRect().top : null;
      return node.getBoundingClientRect().bottom <= (bottom && bottom > 0 ? bottom : window.innerHeight);
    }), "the complete receipt limitation is readable above fixed navigation").toBe(true);
    await page.screenshot({ path: info.outputPath(`outcomes-${width}-${theme}-${mode}.png`), animations: "disabled" });
    const composer = page.getByRole("textbox", { name: "Chat message", exact: true });
    await composer.scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Send message", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`composer-${width}-${theme}-${mode}.png`), animations: "disabled" });
  }
  expect(errors).toEqual([]);
});

test("failed and partial reads retain last-known rows and cannot declare an empty healthy view", async ({ page }) => {
  const { overview, state, errors } = await setup(page);
  state.http = 500; // Even an erroneous ok:true body cannot qualify a failed read.
  state.connection = "unreachable";
  await overview.getByRole("button", { name: "Refresh observations", exact: true }).click();
  await expect(overview).toHaveAttribute("data-observation", "stale");
  await expect(overview.locator('[data-home-session="approval"]')).toBeVisible();
  await expect(overview).toContainText("Connection status unavailable");
  state.http = 200;
  state.degraded = true;
  state.rows = [];
  await overview.getByRole("button", { name: "Refresh observations", exact: true }).click();
  await expect(overview).toHaveAttribute("data-observation", "partial");
  await expect(overview).not.toContainText("No reported decisions, blocks or failures");
  await expect(overview.locator('[data-home-session="approval"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("updates preserve row focus and opening exact evidence preserves the Home draft", async ({ page }) => {
  const { overview, state, errors } = await setup(page);
  const draft = page.getByRole("textbox", { name: "Chat message", exact: true });
  await draft.fill("Keep this Home draft");
  const work = overview.locator('[data-home-session="work"]');
  await work.focus();
  state.rows = state.rows.map((row) => row.id === "work" ? { ...row, status: "completed" } : row);
  await expect(work).toContainText("Completed", { timeout: 20_000 });
  await expect(work).toBeFocused();
  await overview.locator('[data-home-session="approval"]').click();
  await overview.locator("li", { has: page.locator('[data-home-session="approval"]') }).getByRole("button", { name: /^Open conversation:/ }).click();
  await expect(page).toHaveURL(/#chat-approval$/);
  await expect(page.getByText("Exact existing conversation.", { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "home" } })));
  await expect(draft).toHaveValue("Keep this Home draft");
  expect(errors).toEqual([]);
});

test("same-name familiar switch hides old rows while the new scope is pending", async ({ page }) => {
  const { overview, state, errors } = await setup(page);
  state.holdEcho = true;
  await page.locator(".home-composer-familiar-context").getByRole("button", { name: /^Switch familiar/ }).click();
  await page.getByRole("option").filter({ hasText: "Correspondence" }).click();
  await expect(overview).toHaveAttribute("data-observation", "loading");
  await expect(overview.locator("[data-home-session]")).toHaveCount(0);
  await expect.poll(() => state.reads).toBeGreaterThan(1);
  state.holdEcho = false;
  state.releaseEcho();
  await expect(overview.locator('[data-home-session="echo-session"]')).toBeVisible();
  await expect(overview.locator('[data-home-session="approval"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("an unavailable first read is distinct from a successful empty scope", async ({ page }) => {
  const { overview, state, errors } = await setup(page, 503);
  await expect(overview.locator("[data-home-session]")).toHaveCount(0);
  await expect(overview).toContainText("Session list unavailable");
  await expect(overview).not.toContainText("No reported decisions, blocks or failures");
  state.http = 200;
  state.rows = [];
  await overview.getByRole("button", { name: "Refresh observations", exact: true }).click();
  await expect(overview).toHaveAttribute("data-observation", "current");
  await expect(overview).toContainText("No reported decisions, blocks or failures in this scope");
  await expect(page.getByRole("textbox", { name: "Chat message", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe("touch overview", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("local disclosure keeps a touch target and explicit exact-session action", async ({ page }) => {
    const { overview, errors } = await setup(page);
    const row = overview.locator('[data-home-session="approval"]');
    const bounds = await row.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await row.tap();
    const details = overview.locator("li", { has: page.locator('[data-home-session="approval"]') });
    await expect(details.getByRole("button", { name: /^Open conversation:/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row).toBeFocused();
    await expect(details.getByRole("button", { name: /^Open conversation:/ })).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test("an unknown execution status does not hide a canonical pending decision", async ({ page }) => {
  const { overview, state, errors } = await setup(page);
  state.rows = state.rows.map((row) => row.id === "approval" ? { ...row, status: "future-status" } : row);
  await overview.getByRole("button", { name: "Refresh observations", exact: true }).click();
  const attention = overview.getByRole("region", { name: "Needs you · 1", exact: true });
  await expect(attention.locator('[data-home-session="approval"]')).toContainText("Blocked · execution state unavailable");
  await expect(overview).not.toContainText("No reported decisions, blocks or failures");
  expect(errors).toEqual([]);
});

test("overview disclosures close the innermost detail first and honor the app clock preference", async ({ page }) => {
  const { overview, state, errors } = await setup(page);
  const context = overview.getByText("Context and observation limits", { exact: true });
  await context.press("Enter");
  await expect(context.locator("..")).toHaveAttribute("open", "");
  await context.press("Escape");
  await expect(context).toBeFocused();
  await expect(context.locator("..")).not.toHaveAttribute("open", "");
  state.rows.push(session("more-a"), session("more-b"));
  await overview.getByRole("button", { name: "Refresh observations", exact: true }).click();
  const more = overview.locator(".home-overview__more");
  await more.locator(":scope > summary").press("Enter");
  const row = more.locator("[data-home-session]").first();
  await row.press("Enter");
  await row.press("Escape");
  await expect(row).toBeFocused();
  await expect(row.locator("..")).not.toHaveAttribute("open", "");
  await expect(more).toHaveAttribute("open", "");
  await row.press("Escape");
  await expect(more).not.toHaveAttribute("open", "");
  await expect(more.locator(":scope > summary")).toBeFocused();
  await expect(overview.locator(".home-overview__freshness time").first()).toContainText(/AM|PM/);
  state.preferences.appearance.datetime.clock = "24h";
  await page.evaluate(() => {
    const channel = new BroadcastChannel("cave:app-preferences");
    channel.postMessage("changed");
    channel.close();
  });
  await expect(overview.locator(".home-overview__freshness time").first()).not.toContainText(/AM|PM/);
  expect(errors).toEqual([]);
});

for (const denial of [401, 403]) {
  test(`session-list ${denial} withdraws cached row metadata without treating refusal as offline`, async ({ page }) => {
    const { overview, state, errors } = await setup(page);
    state.http = denial;
    await overview.getByRole("button", { name: "Refresh observations", exact: true }).click();
    await expect(overview).toHaveAttribute("data-observation", "unavailable");
    await expect(overview).toContainText("Previous observations are hidden");
    await expect(overview.locator("[data-home-session]")).toHaveCount(0);
    await expect(overview).not.toContainText("Review the bounded request");
    state.http = 200;
    state.rows = [];
    state.degraded = true;
    await overview.getByRole("button", { name: "Refresh observations", exact: true }).click();
    await expect(overview).toHaveAttribute("data-observation", "partial");
    await expect(overview.locator("[data-home-session]")).toHaveCount(0);
    await expect(overview).not.toContainText("No reported decisions, blocks or failures");
    expect(errors).toEqual([]);
  });
}

for (const [theme, mode, width] of [["coven", "dark", 1440], ["coven", "light", 390], ["tide", "dark", 1100]] as const) {
  test(`overview readable text and keyboard focus with reduced motion and transparency: ${theme} ${mode}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "prefers-reduced-transparency", value: "reduce" },
    ] });
    const { overview, errors } = await setup(page);
    await page.evaluate(([theme, mode]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.mode = mode; }, [theme, mode]);
    const closeNav = page.getByRole("button", { name: "Close navigation", exact: true });
    if (await closeNav.isVisible()) await closeNav.click();
    await expect.poll(() => page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches && matchMedia("(prefers-reduced-transparency: reduce)").matches)).toBe(true);
    const row = overview.locator('[data-home-session="approval"]');
    await row.press("Enter");
    await expect(overview.getByRole("button", { name: "Open conversation: Review the bounded request", exact: true })).toBeVisible();
    await row.press("Escape");
    await expect(row).toBeFocused();
    await expect(row).toHaveCSS("outline-style", "solid");
    expect(await row.evaluate((node) => parseFloat(getComputedStyle(node).outlineWidth))).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath(`accessible-${theme}-${mode}.png`), animations: "disabled" });
    const measurements = await overview.evaluate((root) => {
      const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      function rgba(value: string): number[] {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v);
      }
      function luminance(rgb: number[]) {
        return rgb.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const results: { text: string; ratio: number; minimum: number; color: string; background: number[] }[] = [];
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent?.trim();
        const node = walker.currentNode.parentElement;
        if (!text || !node || !node.getClientRects().length || getComputedStyle(node).visibility !== "visible") continue;
        let background = [0, 0, 0, 0];
        for (let ancestor: Element | null = node; ancestor && background[3] < 1; ancestor = ancestor.parentElement) {
          const behind = rgba(getComputedStyle(ancestor).backgroundColor);
          const alpha = background[3] + behind[3] * (1 - background[3]);
          background = [...[0, 1, 2].map((i) => alpha ? (background[i] * background[3] + behind[i] * behind[3] * (1 - background[3])) / alpha : 0), alpha];
        }
        const style = getComputedStyle(node);
        const ink = rgba(style.color);
        const painted = ink.slice(0, 3).map((v, i) => v * ink[3] + background[i] * (1 - ink[3]));
        const inkL = luminance(painted), bgL = luminance(background);
        const ratio = (Math.max(inkL, bgL) + 0.05) / (Math.min(inkL, bgL) + 0.05);
        const size = parseFloat(style.fontSize), weight = parseFloat(style.fontWeight);
        results.push({ text: text.slice(0, 100), ratio, minimum: size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5, color: style.color, background });
      }
      return { text: results, panelAlpha: rgba(getComputedStyle(root).backgroundColor)[3], runningAnimations: root.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length };
    });
    await info.attach("computed-text-contrast", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
    expect(measurements.text.length).toBeGreaterThan(20);
    expect(measurements.text.filter((sample) => sample.ratio + 0.01 < sample.minimum), "rendered Home text meets its size-dependent contrast threshold").toEqual([]);
    expect(measurements.panelAlpha).toBe(1);
    expect(measurements.runningAnimations).toBe(0);
    expect(errors).toEqual([]);
  });
}

test("overview keeps expanded exact-reference action focus when an observation changes section", async ({ page }) => {
  const { overview, state, errors } = await setup(page);
  const row = overview.locator('[data-home-session="work"]');
  await row.press("Enter");
  const action = overview.getByRole("button", { name: "Open conversation: Compare the sources", exact: true });
  await action.focus();
  state.rows = state.rows.map((item) => item.id === "work" ? { ...item, status: "completed" } : item);
  await expect(row).toContainText("Completed", { timeout: 20_000 });
  await expect(action).toBeFocused();
  await expect(row.locator("..")).toHaveAttribute("open", "");
  await expect(row.locator("..")).toContainText("nova");
  await expect(row.locator("..")).toContainText("/repo");
  expect(errors).toEqual([]);
});

for (const [theme, mode, width] of [["coven", "light", 1440], ["coven", "light", 390], ["tide", "dark", 1100]] as const) {
  test(`overview retains the installed-capabilities Settings path: ${theme} ${mode} ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const { errors } = await setup(page);
    await page.goto("/settings#general", { waitUntil: "domcontentloaded" });
    const entry = page.getByRole("link", { name: "Manage installed items", exact: true });
    await entry.scrollIntoViewIfNeeded({ timeout: 30_000 });
    await page.evaluate(([theme, mode]) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.mode = mode; }, [theme, mode]);
    await entry.press("Tab");
    await entry.focus();
    await expect(entry).toBeFocused();
    await expect(entry).toHaveCSS("outline-style", "solid");
    const bounds = await entry.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`installed-capabilities-${theme}-${mode}-${width}.png`), animations: "disabled" });
    await expect(entry).toHaveAttribute("href", "/?mode=marketplace");
    await entry.press("Enter");
    // Workspace consumes and clears the mode query once the destination is
    // applied; the retained surface is the durable navigation assertion.
    await expect(page.getByRole("heading", { name: "Marketplace", exact: true }).first()).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });
}

test("overview evidence navigation preserves staged Home file bytes until one explicit send", async ({ page }) => {
  const { overview, errors } = await setup(page);
  const text = "Keep this file exactly: ✓\nSecond line.\n";
  const file = { name: "d0-draft-evidence.txt", mimeType: "text/plain", buffer: Buffer.from(text) };
  const draft = page.getByRole("textbox", { name: "Chat message", exact: true });
  await draft.fill("Keep this Home draft and its file");
  await page.locator('.home-composer-root input[type="file"]').setInputFiles(file);
  await expect(page.locator(".hc-attachment-name")).toHaveText(file.name);
  await overview.locator('[data-home-session="approval"]').click();
  await overview.getByRole("button", { name: "Open conversation: Review the bounded request", exact: true }).click();
  await expect(page.getByText("Exact existing conversation.", { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "home" } })));
  await expect(draft).toHaveValue("Keep this Home draft and its file");
  await expect(page.locator(".hc-attachment-name")).toHaveText(file.name);
  const sent: Array<{ attachments?: Array<{ name: string; text?: string }> }> = [];
  await page.route("**/api/chat/send", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "text/event-stream", body: 'data: {"kind":"assistant_chunk","text":"Accepted fixture file."}\n\ndata: {"kind":"done","sessionId":"home-file-run"}\n\n' });
  });
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].attachments?.map((item) => ({ name: item.name, text: item.text }))).toEqual([{ name: file.name, text }]);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "home" } })));
  await expect(draft).toHaveValue("");
  await expect(page.locator(".hc-attachment-name")).toHaveCount(0);
  expect(sent).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const destination of ["conversation", "Settings"] as const) for (const finish of ["away", "after returning"] as const) {
  test(`overview retains a pending file read through ${destination} that finishes ${finish}`, async ({ page }, info) => {
    await page.addInitScript(() => {
      const read = FileReader.prototype.readAsDataURL;
      const held: Array<() => void> = [];
      let completed = 0;
      Object.assign(window, { d0PendingReads: () => held.length, d0CompletedReads: () => completed, d0ReleaseReads: () => held.splice(0).forEach((resume) => resume()) });
      FileReader.prototype.readAsDataURL = function (blob) {
        if (blob instanceof File && blob.name === "d0-pending-evidence.txt") held.push(() => {
          this.addEventListener("loadend", () => { completed += 1; }, { once: true });
          read.call(this, blob);
        });
        else read.call(this, blob);
      };
    });
    const { overview, errors } = await setup(page);
    const file = { name: "d0-pending-evidence.txt", mimeType: "text/plain", buffer: Buffer.from("A pending local draft remains a draft.\n") };
    await page.getByRole("textbox", { name: "Chat message", exact: true }).fill("Keep this pending draft");
    await page.locator('.home-composer-root input[type="file"]').setInputFiles(file);
    await expect.poll(() => page.evaluate(() => (window as unknown as { d0PendingReads(): number }).d0PendingReads())).toBe(1);
    await expect(page.getByText("Reading attachments…", { exact: true })).toBeVisible();
    if (destination === "conversation") {
      await overview.locator('[data-home-session="approval"]').click();
      await overview.getByRole("button", { name: "Open conversation: Review the bounded request", exact: true }).click();
      await expect(page.getByText("Exact existing conversation.", { exact: true })).toBeVisible();
    } else {
      await overview.getByRole("button", { name: "Connection settings", exact: true }).click();
      await expect(page).toHaveURL(/\/settings/);
      await expect(page.getByRole("link", { name: "Manage installed items", exact: true })).toBeAttached();
    }
    if (finish === "away") {
      await page.evaluate(() => (window as unknown as { d0ReleaseReads(): void }).d0ReleaseReads());
      await expect.poll(() => page.evaluate(() => (window as unknown as { d0CompletedReads(): number }).d0CompletedReads())).toBe(1);
    }
    if (destination === "conversation") {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "home" } })));
    } else {
      await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Home/ }).click();
    }
    await expect(page.getByRole("textbox", { name: "Chat message", exact: true })).toHaveValue("Keep this pending draft");
    const focusTarget = overview.getByRole("button", { name: "Connection settings", exact: true });
    if (finish === "after returning") {
      await expect(page.getByText("Reading attachments…", { exact: true })).toBeVisible();
      await focusTarget.focus();
      await page.evaluate(() => (window as unknown as { d0ReleaseReads(): void }).d0ReleaseReads());
    }
    await expect(page.locator(".hc-attachment-name")).toHaveText(file.name);
    await expect(page.getByText("Reading attachments…", { exact: true })).toHaveCount(0);
    if (finish === "after returning") await expect(focusTarget).toBeFocused();
    await page.screenshot({ path: info.outputPath(`pending-file-${destination}-${finish.replaceAll(" ", "-")}.png`), animations: "disabled" });
    expect(errors).toEqual([]);
  });
}

test("overview Settings navigation retains the Home draft and staged file", async ({ page }, info) => {
  const { overview, errors } = await setup(page);
  const draft = page.getByRole("textbox", { name: "Chat message", exact: true });
  const file = { name: "d0-settings-evidence.txt", mimeType: "text/plain", buffer: Buffer.from("Keep bytes while checking connection settings.\n") };
  await draft.fill("Check the connection without losing this draft");
  await page.locator('.home-composer-root input[type="file"]').setInputFiles(file);
  await expect(page.locator(".hc-attachment-name")).toHaveText(file.name);
  await overview.getByRole("button", { name: "Connection settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByRole("link", { name: "Manage installed items", exact: true })).toBeAttached();
  await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Home/ }).click();
  await expect(draft).toHaveValue("Check the connection without losing this draft");
  await expect(page.locator(".hc-attachment-name")).toHaveText(file.name);
  await page.screenshot({ path: info.outputPath("settings-return-draft.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});

test("overview guards a reload while unsent file bytes are held only in this document", async ({ page }, info) => {
  const { errors } = await setup(page);
  const file = { name: "d0-reload-evidence.txt", mimeType: "text/plain", buffer: Buffer.from("Reload requires an explicit discard.\n") };
  const draft = page.getByRole("textbox", { name: "Chat message", exact: true });
  await draft.click();
  await draft.fill("Keep this draft unless I discard its files");
  await page.locator('.home-composer-root input[type="file"]').setInputFiles(file);
  await expect(page.locator(".hc-attachment-name")).toHaveText(file.name);
  const dialog = page.waitForEvent("dialog");
  // Cancellation has no load event; ask the document to reload rather than
  // waiting for a navigation that the user is explicitly declining.
  const reload = page.evaluate(() => window.location.reload());
  const warning = await dialog;
  expect(warning.type()).toBe("beforeunload");
  await warning.dismiss();
  await reload;
  await expect(draft).toHaveValue("Keep this draft unless I discard its files");
  await expect(page.locator(".hc-attachment-name")).toHaveText(file.name);
  await page.screenshot({ path: info.outputPath("reload-cancelled-draft.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(page.locator(".hc-attachment-name")).toHaveCount(0);
  const unexpectedDialogs: string[] = [];
  page.on("dialog", async dialog => { unexpectedDialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.reload();
  await expect(draft).toHaveValue("Keep this draft unless I discard its files");
  expect(unexpectedDialogs).toEqual([]);
  expect(errors).toEqual([]);
});

for (const movesSection of [false, true]) {
  test(`overview respects an intentional blur when an observation ${movesSection ? "moves section" : "updates in place"}`, async ({ page }) => {
    const { overview, state, errors } = await setup(page);
    const work = overview.locator('[data-home-session="work"]');
    await work.focus();
    await expect(work).toBeFocused();
    // Clicking the noninteractive top edge of the window chrome deliberately
    // leaves no focused control; a later poll must respect that choice.
    await page.locator(".shell-top").click({ position: { x: 600, y: 1 } });
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
    state.rows = state.rows.map(row => row.id === "work" ? { ...row, title: "An updated observation after leaving focus", ...(movesSection ? { status: "completed" } : {}) } : row);
    await expect(work).toContainText("An updated observation after leaving focus", { timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
    expect(errors).toEqual([]);
  });
}
