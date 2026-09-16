import { expect, test, type Page } from "@playwright/test";

const FAMILIARS = [
  { id: "cody", display_name: "Cody", role: "Implementer", status: "active", icon: "ph:code" },
  { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
];

const sessions = [
  {
    id: "cody-old",
    project_root: "/repo",
    harness: "copilot",
    title: "Older Cody chat",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-07T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
    familiarId: "cody",
    hasLocalConversation: true,
  },
  {
    id: "cody-new",
    project_root: "/repo",
    harness: "copilot",
    title: "Newest Cody chat",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-02T10:00:00.000Z",
    updated_at: "2026-08-08T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
    familiarId: "cody",
    hasLocalConversation: true,
  },
  {
    id: "nova-newest",
    project_root: "/repo",
    harness: "copilot",
    title: "Nova must not be selected",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-03T10:00:00.000Z",
    updated_at: "2026-08-09T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
    familiarId: "nova",
    hasLocalConversation: true,
  },
];

async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
    localStorage.setItem("cave:shell:right-chat-open", "0");
    localStorage.setItem("cave:shell:right-chat-width", "360");
    localStorage.removeItem("cave.shell.widths.v3");
    localStorage.removeItem("cave.shell.widths.v3.right-chat");
    localStorage.removeItem("cave.shell.widths.v3.persistent-list.right-chat");
    localStorage.removeItem("cave.shell.widths.v3.two-pane.right-chat");
    localStorage.removeItem("cave.shell.widths.v3.chat-contextual.right-chat");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: FAMILIARS } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions } }),
  );
  await page.route("**/api/chat/conversation**", (route) => {
    const sessionId = new URL(route.request().url()).searchParams.get("sessionId");
    return route.fulfill({
      json: {
        ok: true,
        conversation: {
          sessionId,
          familiarId: "cody",
          turns: [],
          activeLeafId: null,
        },
      },
    });
  });
  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
}

test("desktop keeps the panel across surfaces and supports a second Chat conversation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await boot(page);

  const toggle = page.getByRole("button", { name: "Open Chat panel" });
  await toggle.click();
  const panel = page.locator(".right-chat").first();
  const outerPanel = page.locator('[data-panel="true"]#right-chat');
  await expect(page.getByRole("button", { name: "Close Chat panel" }).first()).toBeVisible();
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect(panel.locator(".right-chat__rail")).toBeVisible();
  await expect(panel.locator(".right-chat__header")).toHaveCount(0);
  await expect(panel).toContainText("Newest Cody chat");
  await expect(panel).not.toContainText("Nova must not be selected");

  const titlebarContext = page.locator(".workspace-titlebar-context");
  await expect(titlebarContext).toBeVisible();

  const chooseFamiliar = async (name: string) => {
    await titlebarContext.locator('button[aria-label^="Switch familiar"]').click();
    await page.getByRole("dialog", { name: "Familiars" }).getByText(name, { exact: true }).last().click();
  };

  const panelDraft = panel.getByRole("textbox", { name: "Message" });
  await panelDraft.fill("Keep this Cody draft");
  await chooseFamiliar("Nova");
  await expect(panel).toHaveAttribute("data-session-id", "nova-newest");
  await chooseFamiliar("Cody");
  await expect(panel).toHaveAttribute("data-session-id", "cody-new");
  await expect(panel.getByRole("textbox", { name: "Message" })).toHaveValue("Keep this Cody draft");

  await chooseFamiliar("All familiars");
  await expect(panel.getByText("Choose a familiar", { exact: true })).toBeVisible();
  await expect(panel).not.toContainText("Nova must not be selected");
  await panel.getByRole("button", { name: "Cody", exact: true }).click();
  await expect(panel).toHaveAttribute("data-session-id", "cody-new");

  const before = await outerPanel.boundingBox();
  const handle = outerPanel.locator("xpath=preceding-sibling::*[1]");
  const box = await handle.boundingBox();
  if (!before || !box) throw new Error("Right Chat panel or separator did not render");
  await handle.focus();
  for (let i = 0; i < 8; i += 1) await page.keyboard.press("ArrowLeft");
  let after = await outerPanel.boundingBox();
  if (Math.abs((after?.width ?? 0) - before.width) < 10) {
    for (let i = 0; i < 8; i += 1) await page.keyboard.press("ArrowRight");
    after = await outerPanel.boundingBox();
  }
  expect(Math.abs((after?.width ?? 0) - before.width)).toBeGreaterThan(10);

  // Chat is a sidebar DESTINATION now, not a section tab — the Home/Chat
  // switcher above the rail is gone (cave-fh9so), so the tablist this used to
  // drive no longer exists.
  //
  // The tablist lived in the title bar and was reachable whatever the rail was
  // doing. A destination is not: a collapsed sidebar is `inert aria-hidden`,
  // which getByRole skips entirely, so this opens the rail first if the
  // resize above (or a remembered preference) left it shut.
  const sidebar = page.locator('aside[aria-label="Sidebar"]');
  if ((await sidebar.getAttribute("aria-hidden")) === "true") {
    await page.keyboard.press("ControlOrMeta+b");
    await expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
  }
  const chatDestination = sidebar.getByRole("button", { name: /^Chat\b/ }).first();
  // The keyboard resize above can leave the separator's expanded pointer
  // target armed, so the first pointerdown here is swallowed as a zero-delta
  // drag. A harmless first click clears that state so the real navigation
  // click below lands normally.
  await chatDestination.click();
  await chatDestination.click();
  await expect(page.locator(".chat-surface")).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Newest Cody chat");

  const persistedWidth = (await outerPanel.boundingBox())?.width ?? 0;
  await page.goto("/#chat-cody-new");
  await expect(page.locator(".chat-surface")).toBeVisible({ timeout: 30_000 });
  const reopenedPanel = page.locator(".right-chat").first();
  const reopenedOuterPanel = page.locator('[data-panel="true"]#right-chat');
  await expect(page.getByRole("button", { name: "Close Chat panel" }).first()).toBeVisible();
  await expect(reopenedPanel).toHaveAttribute("aria-hidden", "false");
  expect(Math.abs(((await reopenedOuterPanel.boundingBox())?.width ?? 0) - persistedWidth)).toBeLessThan(4);

  await panel.locator('button[aria-label^="Switch Chat panel thread, current:"]').click();
  await page.getByRole("menu", { name: /^Switch Chat panel thread, current: .* options$/ }).getByText("Older Cody chat", { exact: true }).click();
  await expect(reopenedPanel).toHaveAttribute("data-session-id", "cody-old");
  await expect(page).toHaveURL(/#chat-cody-new$/);

  await page.getByRole("button", { name: "Close Chat panel" }).first().click();
  await expect(reopenedPanel).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("button", { name: "Open Chat panel" }).click();
  await expect(page.getByRole("button", { name: "Close Chat panel" }).first()).toBeVisible();
  const reopenedAgainPanel = page.locator(".right-chat").first();
  await expect(reopenedAgainPanel).toHaveAttribute("aria-hidden", "false");
  await expect(reopenedAgainPanel).toHaveAttribute("data-session-id", "cody-old");
  await expect(reopenedAgainPanel.getByRole("textbox", { name: "Message" })).toHaveValue("Keep this Cody draft");

  await page.getByRole("button", { name: "Close Chat panel" }).first().click();
  await page.reload();
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  await expect(page.locator(".right-chat").first()).toHaveAttribute("aria-hidden", "true");
});

test("mobile uses one focus-trapped right drawer and returns focus", async ({ page }, testInfo) => {
  test.skip(!["pixel-5", "iphone-13"].includes(testInfo.project.name));
  await boot(page);

  const toggle = page.getByRole("button", { name: "Open Chat panel" });
  await toggle.focus();
  await toggle.click();

  const drawer = page.getByRole("dialog", { name: "Chat panel" });
  await expect(drawer).toBeVisible();
  await expect(page.locator('[data-panel="true"]#right-chat')).toHaveCount(0);

  await page.keyboard.press("Shift+Tab");
  await expect(drawer.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();

  // The drawer intentionally spans the full viewport width on narrow phones
  // (`.mobile-right-chat-drawer` under `@media (max-width: 480px)`), so on
  // Pixel 5 (393px) and iPhone 13 (390px) it covers the backdrop button at
  // EVERY coordinate once its slide-in has settled. That made the backdrop a
  // control no input modality could reach — invisible under the opaque
  // drawer, un-hittable by pointer, and skipped by the focus trap's
  // last→first wrap (cave-4snk9). Since then the backdrop is hidden for this
  // slot and the drawer's own top close strip owns dismissal.
  //
  // The strip is a GENUINE pointer target: `elementFromPoint` at its centre
  // resolves to it, and a REAL click — no `force`, no `dispatchEvent` —
  // closes the drawer. `force` would not be a valid escape hatch here
  // anyway: it only skips Playwright's actionability checks while still
  // delivering the mouse event at real viewport coordinates, so the click
  // would land on whatever is actually topmost, not on the located element
  // (the cave-m1mgi flake was exactly that race with the slide-in).
  await toggle.click();
  await expect(drawer).toBeVisible();
  const closeStrip = drawer.getByRole("button", { name: "Close drawer" });
  await expect(page.locator(".mobile-drawer-backdrop")).toBeHidden();
  await expect(closeStrip).toBeVisible();
  await expect
    .poll(async () => {
      // The drawer is visible while its 180 ms slide-in is still settling.
      // Re-read the box on every attempt so the hit test never reuses an
      // offscreen coordinate captured during that transition.
      const stripBox = await closeStrip.boundingBox();
      if (!stripBox) return false;
      return page.evaluate(
        ([x, y]) =>
          !!document.elementFromPoint(x, y)?.closest(".mobile-right-chat-drawer__close"),
        [Math.round(stripBox.x + stripBox.width / 2), Math.round(stripBox.y + stripBox.height / 2)],
      );
    })
    .toBe(true);
  await closeStrip.click();
  await expect(drawer).toBeHidden();
  await expect(page.locator(".mobile-right-chat-drawer__close")).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await drawer.getByRole("button", { name: "Close Chat panel" }).click();
  await expect(drawer).toBeHidden();
});

test("full-bleed right drawer's close control is reachable by keyboard", async ({ page }, testInfo) => {
  test.skip(!["pixel-5", "iphone-13"].includes(testInfo.project.name));
  await boot(page);

  const toggle = page.getByRole("button", { name: "Open Chat panel" });
  await toggle.click();

  const drawer = page.getByRole("dialog", { name: "Chat panel" });
  await expect(drawer).toBeVisible();

  // The close strip is the dialog's FIRST focusable, so the trap usually
  // puts keyboard focus on it the moment the drawer opens. Don't depend on
  // that landing: Tab through the trapped dialog — the trap wraps last→first,
  // so a bounded loop visits every focusable, the close strip included — and
  // prove we reached a real "Close drawer" control, not the phantom backdrop
  // (which is display:none at this width and cannot be tabbed to at all).
  for (let i = 0; i < 25; i += 1) {
    const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    if (label === "Close drawer") break;
    await page.keyboard.press("Tab");
  }
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
    .toBe("Close drawer");

  // Activate the focused close control with the keyboard; focus returns to
  // the toggle that opened the drawer.
  await page.keyboard.press("Enter");
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();
});

async function bootFixThread(page: Page, options: { selectedProjectId?: string | null; denyNovaAlpha?: boolean } = {}) {
  const selectedProjectId = options.selectedProjectId === undefined ? "fix-project" : options.selectedProjectId;
  const sends: Array<Record<string, unknown>> = [];
  const projectAuthorityReads: Array<string | null> = [];
  let sessionListReads = 0;
  const report = {
    id: "fix-thread-report",
    familiarId: "cody",
    sessionId: "cody-new",
    threadTitle: "Newest Cody chat",
    reportedAt: "2026-09-09T00:00:00.000Z",
    overallConfidence: 90,
    overallConfidenceReason: "One tool needs repair.",
    toolReliability: { score: 90, failedTools: [], unreliableTools: [] },
    contextPressure: "adequate",
    skillsUsed: [],
    skillsNeedingClarity: [],
    skillsNeedingAccess: [],
    capabilitiesLacking: [],
    capabilitiesVital: [],
    memoryRecallScore: 90,
    fileLocatabilityScore: 90,
    persistentBlockers: [{
      id: "lookup",
      title: "Broken lookup",
      category: "tooling",
      impact: "blocking",
      detail: "The lookup tool cannot find project files.",
    }],
  };
  const fixtureSessionId = "fix-thread-new";
  const fixtureReply = "Fix response complete.";
  await page.addInitScript(({ selectedProjectId }) => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
    localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify(selectedProjectId));
    localStorage.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify({ "fix-project": ["cody"], "__all-projects__": ["cody"] }));
    localStorage.setItem("cave:shell:right-chat-open", "0");
    localStorage.setItem("cave:shell:right-chat-width", "360");
  }, { selectedProjectId });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: FAMILIARS } }));
  await page.route("**/api/projects**", (route) => {
    const familiarId = new URL(route.request().url()).searchParams.get("familiarId");
    projectAuthorityReads.push(familiarId);
    const projects = [
      { id: "fix-project", name: "Fix project", root: "/repo", access: "write" },
      { id: "alpha", name: "Alpha", root: "/repo/alpha", access: "write" },
    ].filter((project) => !(options.denyNovaAlpha && familiarId === "nova" && project.id === "alpha"));
    return route.fulfill({ json: { ok: true, projects } });
  });
  await page.route("**/api/sessions/list**", (route) => {
    sessionListReads += 1;
    const fixSessions = sends.length ? [{
      ...sessions[0],
      id: fixtureSessionId,
      title: "Fix thread",
      familiarId: sends[0].familiarId,
      project_root: sends[0].projectRoot,
      updated_at: "2026-09-09T00:00:00.000Z",
    }] : [];
    return route.fulfill({ json: { ok: true, sessions: [...sessions, ...fixSessions] } });
  });
  await page.route("**/api/chat/conversation**", (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ json: { ok: true } });
    const isFix = route.request().url().includes(fixtureSessionId);
    return route.fulfill({
      json: {
        ok: true,
        conversation: {
          sessionId: isFix ? fixtureSessionId : "cody-new",
          familiarId: isFix ? sends[0]?.familiarId : "cody",
          activeLeafId: "assistant-fixture",
          turns: [
            { id: "user-fixture", parentId: null, role: "user", text: isFix ? sends[0]?.prompt : "Keep this main conversation.", createdAt: report.reportedAt },
            { id: "assistant-fixture", parentId: "user-fixture", role: "assistant", text: isFix ? fixtureReply : "Main conversation stays here.", createdAt: report.reportedAt },
          ],
        },
      },
    });
  });
  await page.route("**/api/chat/model-state**", (route) =>
    route.fulfill({ json: { ok: true, state: { harness: "copilot", effectiveModel: "unknown", source: "runtime-default", applicationState: "saved", reason: "e2e" } } }));
  await page.route("**/api/chat/generate/enhance", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ kind: "assistant_chunk", text: JSON.stringify(report) })}\n\ndata: {"kind":"done"}\n\n`,
    }));
  await page.route("**/api/familiars/cody/self-report", (route) =>
    route.fulfill({ json: { ok: true, report } }));
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: "text/event-stream",
      body: [
        { kind: "assistant_chunk", text: fixtureReply },
        { kind: "done", sessionId: fixtureSessionId },
      ].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""),
    });
  });
  await page.goto("/?mode=chat#chat-cody-new", { waitUntil: "domcontentloaded" });
  const main = page.getByTestId("chat-main");
  await expect(main.getByText("Main conversation stays here.", { exact: true })).toBeVisible({ timeout: 45_000 });
  await main.getByRole("textbox", { name: "Message", exact: true }).fill("Unsent main draft");
  return { sends, main, projectAuthorityReads, sessionListReads: () => sessionListReads, fixtureSessionId, fixtureReply };
}

test("fix-thread popup opens sidechat and sends once without replacing main Chat", async ({ page }, testInfo) => {
  test.skip(!["desktop", "webkit"].includes(testInfo.project.name));
  const fixture = await bootFixThread(page, { selectedProjectId: null });
  await page.mouse.move(0, 0);
  await expect(fixture.main.getByRole("button", { name: "Delete this chat", exact: true })).toHaveCSS("opacity", "1");
  await expect(fixture.main.locator(".voice-call-button")).not.toHaveClass(/reveal-on-hover/);
  await fixture.main.getByRole("button", { name: "Session options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reflect on this thread", exact: true }).click();
  const card = page.getByRole("article", { name: "Thread Signal" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /Broken lookup/ }).click();
  await card.getByRole("button", { name: "Fix in new thread", exact: true }).click();
  await expect(card.getByRole("button", { name: "Fix in new thread", exact: true })).toBeDisabled();

  const panel = page.locator(".right-chat").first();
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect.poll(() => fixture.sends.length).toBe(1);
  expect(fixture.sends[0]).toMatchObject({ familiarId: "cody", projectRoot: "/repo" });
  expect(fixture.sends[0].prompt).toContain("Broken lookup");
  expect(fixture.sends[0].prompt).toContain("Source: self-report from thread cody-new.");
  expect(fixture.sends[0].sessionId).not.toBe("cody-new");
  await expect(panel.getByText(fixture.fixtureReply, { exact: true })).toBeVisible();
  await expect(fixture.main.getByText("Main conversation stays here.", { exact: true })).toBeVisible();
  await expect(fixture.main.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Unsent main draft");
  await expect(page).toHaveURL(/#chat-cody-new$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cave:workspace:project-scope:v1") ?? "null"))).toBeNull();

  const reads = fixture.sessionListReads();
  await panel.getByRole("button", { name: "Close Chat panel", exact: true }).click();
  await page.getByRole("button", { name: "Open Chat panel", exact: true }).click();
  await expect(panel).toHaveAttribute("aria-hidden", "false");
  await expect.poll(fixture.sessionListReads).toBeGreaterThan(reads);
  await expect(panel).toHaveAttribute("data-session-id", fixture.fixtureSessionId);
  expect(fixture.sends).toHaveLength(1);
  await expect(fixture.main.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Unsent main draft");
  await page.screenshot({ path: testInfo.outputPath("fix-thread-preserves-main.png") });
});

test("fix-thread bridge retains the requested actor when main Chat belongs to another familiar", async ({ page }, testInfo) => {
  test.skip(!["desktop", "webkit"].includes(testInfo.project.name));
  const fixture = await bootFixThread(page);
  const acknowledged = await page.evaluate(() => {
    const event = new CustomEvent("cave:agents-new-right-chat", {
      cancelable: true,
      detail: { destination: "right-panel", familiarId: "nova", initialPrompt: "Repair Nova's lookup without replacing Cody.", origin: "chat" },
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(acknowledged).toBe(true);
  await expect.poll(() => fixture.sends.length).toBe(1);
  expect(fixture.sends[0]).toMatchObject({
    familiarId: "nova",
    projectRoot: "/repo",
    prompt: "Repair Nova's lookup without replacing Cody.",
  });
  const panel = page.locator(".right-chat").first();
  await expect(panel.getByText(fixture.fixtureReply, { exact: true })).toBeVisible();
  await expect(fixture.main.getByText("Main conversation stays here.", { exact: true })).toBeVisible();
  await expect(fixture.main.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Unsent main draft");
  await expect(page).toHaveURL(/#chat-cody-new$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cave:workspace:familiar-scope-by-project:v1") ?? "{}")["fix-project"])).toEqual(["cody"]);
  expect(fixture.sends).toHaveLength(1);
});

for (const selectedProjectId of [null, "fix-project"]) {
  test(`fix-thread explicit target authorizes Alpha without replacing ${selectedProjectId ?? "All projects"} scope`, async ({ page }, testInfo) => {
    test.skip(!["desktop", "webkit"].includes(testInfo.project.name));
    const fixture = await bootFixThread(page, { selectedProjectId });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:agents-new-right-chat", {
      cancelable: true,
      detail: { destination: "right-panel", familiarId: "nova", projectRoot: "/repo/alpha", initialPrompt: "Fix Alpha independently.", origin: "chat" },
    })));
    await expect.poll(() => fixture.sends.length).toBe(1);
    expect(fixture.sends[0]).toMatchObject({ familiarId: "nova", projectRoot: "/repo/alpha", prompt: "Fix Alpha independently." });
    expect(fixture.projectAuthorityReads).toContain("nova");
    await expect(page.locator(".right-chat").first().getByText(fixture.fixtureReply, { exact: true })).toBeVisible();
    await expect(fixture.main.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Unsent main draft");
    await expect(page).toHaveURL(/#chat-cody-new$/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cave:workspace:project-scope:v1") ?? "null"))).toBe(selectedProjectId);
    expect(fixture.sends).toHaveLength(1);
  });
}

test("fix-thread explicit target fails closed when the requested actor lacks that project's grant", async ({ page }, testInfo) => {
  test.skip(!["desktop", "webkit"].includes(testInfo.project.name));
  const fixture = await bootFixThread(page, { selectedProjectId: null, denyNovaAlpha: true });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:agents-new-right-chat", {
    cancelable: true,
    detail: { destination: "right-panel", familiarId: "nova", projectRoot: "/repo/alpha", initialPrompt: "Unauthorized fix.", origin: "chat" },
  })));
  await expect(page.locator(".inbox-toast-stack").getByText("This familiar cannot access the fix thread's project. Grant access and try again.", { exact: true })).toBeVisible();
  expect(fixture.projectAuthorityReads).toContain("nova");
  expect(fixture.sends).toHaveLength(0);
  await expect(fixture.main.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Unsent main draft");
  await expect(page).toHaveURL(/#chat-cody-new$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cave:workspace:project-scope:v1") ?? "null"))).toBeNull();
});

test("tablet-width right drawer keeps a genuinely pointer-reachable backdrop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet");
  await boot(page);

  const toggle = page.getByRole("button", { name: "Open Chat panel" });
  await toggle.click();

  const drawer = page.getByRole("dialog", { name: "Chat panel" });
  await expect(drawer).toBeVisible();

  // At 768px the drawer is capped at min(100vw, 480px), so the backdrop is
  // exposed along the viewport's left edge — a real pointer target that no
  // phone project can exercise (pixel-5/iphone-13 are both full-bleed;
  // cave-4snk9). The full-bleed close strip stays hidden here.
  const backdrop = page.locator(".mobile-drawer-backdrop");
  await expect(backdrop).toBeVisible();
  await expect(page.locator(".mobile-right-chat-drawer__close")).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => !!document.elementFromPoint(2, 2)?.closest(".mobile-drawer-backdrop")),
    )
    .toBe(true);

  // A genuine pointer delivery: click at the exposed (2,2) corner — Playwright
  // hit-tests the real mouse event there — and the drawer closes.
  await backdrop.click({ position: { x: 2, y: 2 } });
  await expect(drawer).toBeHidden();
  await expect(backdrop).toHaveCount(0);
  await expect(toggle).toBeFocused();
});


test("mobile fix handoff opens the Chat drawer and restores the main draft on close", async ({ page }, testInfo) => {
  test.skip(!["pixel-5", "iphone-13", "tablet"].includes(testInfo.project.name));
  const fixture = await bootFixThread(page, { selectedProjectId: null });
  await page.evaluate(() => {
    const event = new CustomEvent("cave:agents-new-right-chat", {
      cancelable: true,
      detail: { destination: "right-panel", familiarId: "cody", sourceSessionId: "cody-new", initialPrompt: "Repair the mobile source.", origin: "chat" },
    });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error("Mobile handoff was not acknowledged");
  });
  const drawer = page.locator(".mobile-right-chat-drawer");
  await expect(drawer).toBeVisible();
  await expect.poll(() => fixture.sends.length).toBe(1);
  expect(fixture.sends[0]).toMatchObject({ familiarId: "cody", projectRoot: "/repo" });
  await expect(drawer.getByText(fixture.fixtureReply, { exact: true })).toBeVisible();
  await expect.poll(() => drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await drawer.getByRole("button", { name: "Close Chat panel", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(fixture.main.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Unsent main draft");
  await expect(page).toHaveURL(/#chat-cody-new$/);
  expect(fixture.sends).toHaveLength(1);
});

test("fix-thread source lookup failure releases only its launch guard for retry", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  const fixture = await bootFixThread(page, { selectedProjectId: null });
  let rejectSource = true;
  await page.route("**/api/sessions/list**", async (route) => {
    if (rejectSource && new URL(route.request().url()).searchParams.get("includeArchived") === "1") {
      rejectSource = false;
      return route.fulfill({ status: 503, json: { ok: false } });
    }
    return route.fallback();
  });
  await fixture.main.getByRole("button", { name: "Session options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reflect on this thread", exact: true }).click();
  const card = page.getByRole("article", { name: "Thread Signal" });
  await card.getByRole("button", { name: /Broken lookup/ }).click();
  const fix = card.getByRole("button", { name: "Fix in new thread", exact: true });
  await fix.click();
  await expect(card.getByText("Couldn't open the Chat panel", { exact: true })).toBeVisible();
  await expect(fix).toBeEnabled();
  expect(fixture.sends).toHaveLength(0);
  await fix.click();
  await expect.poll(() => fixture.sends.length).toBe(1);
  await expect(fix).toBeDisabled();
});


test("superseding a pending fix request makes its original action retryable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  const fixture = await bootFixThread(page, { selectedProjectId: null });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let intercepted = false;
  await page.route("**/api/sessions/list**", async (route) => {
    if (!intercepted && new URL(route.request().url()).searchParams.get("includeArchived") === "1") {
      intercepted = true;
      await pending;
    }
    return route.fallback();
  });
  try {
    await fixture.main.getByRole("button", { name: "Session options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Reflect on this thread", exact: true }).click();
    const card = page.getByRole("article", { name: "Thread Signal" });
    await card.getByRole("button", { name: /Broken lookup/ }).click();
    const fix = card.getByRole("button", { name: "Fix in new thread", exact: true });
    await fix.click();
    await expect(fix).toBeDisabled();
    await expect.poll(() => intercepted).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:agents-new-right-chat", {
      cancelable: true,
      detail: { destination: "right-panel", requestId: "replacement", familiarId: "cody", projectRoot: "/unavailable" },
    })));
    await expect(fix).toBeEnabled();
    expect(fixture.sends).toHaveLength(0);
  } finally { release(); }
});

test("failure from another window releases the originating fix action", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  const fixture = await bootFixThread(page);
  await fixture.main.getByRole("button", { name: "Session options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reflect on this thread", exact: true }).click();
  const card = page.getByRole("article", { name: "Thread Signal" });
  await card.getByRole("button", { name: /Broken lookup/ }).click();
  await page.evaluate(() => {
    window.addEventListener("cave:agents-new-right-chat", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.documentElement.dataset.fixRequest = (event as CustomEvent<{ requestId: string }>).detail.requestId;
    }, { capture: true, once: true });
  });
  const fix = card.getByRole("button", { name: "Fix in new thread", exact: true });
  await fix.click();
  await expect(fix).toBeDisabled();
  const requestId = await page.evaluate(() => document.documentElement.dataset.fixRequest!);
  const other = await context.newPage();
  try {
    await other.route("**/failure-fixture", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Failure fixture</title>" }));
    await other.goto(new URL("/failure-fixture", page.url()).href);
    await other.evaluate((id) => {
      const channel = new BroadcastChannel("cave:agents-right-chat-failed");
      channel.postMessage({ requestId: id, error: "Project access is unavailable. Try again." });
      channel.close();
    }, requestId);
    await expect(fix).toBeEnabled();
    expect(fixture.sends).toHaveLength(0);
  } finally { await other.close(); }
});
