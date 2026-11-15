import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSignalSweepStore } from "../src/lib/server/signal-sweep-store";
import { completedFirstUsePayload } from "./fixtures/first-use";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test("signal fixes warn before dispatch, deduplicate remounts, and explicitly retry repaired prerequisites", async ({ page, context }, testInfo) => {
  const directory = await mkdtemp(path.join(tmpdir(), "signal-browser-"));
  const store = createSignalSweepStore(path.join(directory, "receipts.json"));
  let available = false;
  let preparations = 0;
  const report = {
    id: "synthetic-report", familiarId: "nova", sessionId: "synthetic-source", reportedAt: new Date().toISOString(),
    overallConfidence: 90, toolReliability: { score: 90, failedTools: [], unreliableTools: [] }, contextPressure: "adequate",
    skillsUsed: [], skillsNeedingAccess: [], skillsNeedingClarity: [], capabilitiesVital: [],
    capabilitiesLacking: [{ name: "provider-api", importance: "blocking", detail: "Synthetic prerequisite", blockerId: "auth" }],
    memoryRecallScore: 90, fileLocatabilityScore: 90,
    persistentBlockers: [{ id: "auth", title: "Synthetic auth prerequisite", category: "auth", impact: "blocking", detail: "Synthetic credential needs repair." }],
  };
  try {
    await page.addInitScript(() => localStorage.setItem("cave:onboarding:dismissed", "1"));
    // Every API, including any popup, is synthetic. No provider is contacted.
    await context.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;
      if (pathname === "/api/chat/send") throw new Error("This browser journey must not dispatch provider work");
      if (pathname === "/api/chat/signal-sweeps") {
        if (route.request().method() === "GET") return route.fulfill({ json: { ok: true, available,
          ...(available ? {} : { error: "Claude on this runtime cannot enforce project write access. Choose a compatible runtime before starting a signal fix." }) } });
        const body = route.request().postDataJSON();
        if (body.action === "commit") { await store.commit(body.requestId); return route.fulfill({ json: { ok: true } }); }
        if (body.action === "release") { await store.release(body.requestId); return route.fulfill({ json: { ok: true } }); }
        preparations += 1;
        expect(body.sourceReportId).toBe(report.id);
        expect(body.identities).toEqual(["blocker:auth"]);
        if (!available) return route.fulfill({ status: 409, json: { ok: false, error: "Write access unavailable" } });
        const result = await store.prepare(body.familiarId, body.identities, "same-runtime-and-grants", body.expectedPrevious);
        return route.fulfill({ status: result.ok ? 200 : 409, json: result });
      }
      if (pathname === "/api/familiars") return route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "General", harness: "claude", status: "active" }] } });
      if (pathname.endsWith("/self-reports")) return route.fulfill({ json: { ok: true, reports: [report], total: 1 } });
      if (pathname === "/api/sessions/list") return route.fulfill({ json: { ok: true, sessions: [] } });
      if (pathname === "/api/memory") return route.fulfill({ json: { ok: true, entries: [] } });
      if (pathname.endsWith("/self-reports/snapshots")) return route.fulfill({ json: { ok: true, snapshots: [], total: 0 } });
      if (pathname.endsWith("/outcomes")) return route.fulfill({ json: { ok: true, outcomes: [] } });
      return route.fulfill({ json: { ok: false } });
    });
    // Observe the actual cross-page handoff without booting another app or
    // consuming its saved request. The target's sessionStorage is the receipt.
    await context.route("**/", (route) => new URL(route.request().url()).pathname === "/" && route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Synthetic workspace handoff</title><p>Saved handoff</p>" }) : route.continue());
    await page.goto("/dashboard/familiars/nova/analytics");
    await page.getByRole("button", { name: /^Thread signals/ }).first().click();
    await expect(page.getByRole("button", { name: "Open full view", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open full view", exact: true }).click();
    const queue = page.locator(".fa-thread-review");
    await expect(queue.getByText(/cannot enforce project write access/)).toBeVisible();
    const resolve = queue.getByRole("button", { name: "Resolve Synthetic auth prerequisite", exact: true });
    await expect(resolve).toBeDisabled();
    expect(preparations).toBe(0); expect(context.pages()).toHaveLength(1);
    await page.screenshot({ path: testInfo.outputPath("signal-fix-unavailable.png"), animations: "disabled" });
    available = true;
    await queue.getByRole("button", { name: "Check again", exact: true }).click();
    await expect(resolve).toBeEnabled();
    const popupPromise = page.waitForEvent("popup");
    await resolve.click();
    const popup = await popupPromise;
    await popup.waitForURL("**/");
    const original = await popup.evaluate(() => JSON.parse(sessionStorage.getItem("cave:pending-agents-new-chat")!));
    expect(original.familiarId).toBe("nova"); expect(original.initialControls.permissionMode).toBe("full");
    expect(original.initialPrompt).toContain("Synthetic auth prerequisite");
    await popup.close();
    await resolve.click();
    await expect(queue.getByText(/already has a requested fix/)).toBeVisible();
    await expect.poll(() => context.pages().length).toBe(1);
    // A linked capability's table action must share the blocker's receipt.
    await page.locator(".fa-thread-table-wrap").getByRole("button", { name: "Check again", exact: true }).click();
    const capability = page.getByRole("row").filter({ hasText: "provider-api" });
    if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
      await capability.getByRole("button", { name: "Actions for signal provider-api", exact: true }).click();
      await page.getByRole("menuitem", { name: "Resolve in Build", exact: true }).click();
    } else {
      await capability.getByRole("button", { name: "Launch a thread to resolve provider-api", exact: true }).click();
    }
    await expect(page.locator(".fa-thread-table-wrap").getByText(/already has a requested fix/)).toBeVisible();
    await expect.poll(() => context.pages().length).toBe(1);
    // Closing and reopening the real overlay remounts both analytics entry points.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Thread signals/ }).first().click();
    await expect(page.getByRole("button", { name: "Open full view", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open full view", exact: true }).click();
    await resolve.click();
    await expect(queue.getByText(/already has a requested fix/)).toBeVisible();
    await expect.poll(() => context.pages().length).toBe(1);
    // A human repaired a credential, which does not change runtime/grant hashes.
    // Only this explicit retry acknowledges that change and replaces its receipt.
    const retryPopupPromise = page.waitForEvent("popup");
    await queue.getByRole("button", { name: "Retry fix after changes", exact: true }).click();
    const retryPopup = await retryPopupPromise; await retryPopup.waitForURL("**/");
    const retried = await retryPopup.evaluate(() => JSON.parse(sessionStorage.getItem("cave:pending-agents-new-chat")!));
    expect(retried.requestId).not.toBe(original.requestId); expect(retried.initialPrompt).toBe(original.initialPrompt);
    await retryPopup.close();
    await page.screenshot({ path: testInfo.outputPath("signal-retry-restored.png"), animations: "disabled" });
    await page.evaluate(() => { document.documentElement.dataset.mode = "light"; document.documentElement.dataset.theme = "tide"; });
    await page.screenshot({ path: testInfo.outputPath("signal-retry-light-tide.png"), animations: "disabled" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the in-chat signal card explains unavailable writes without covering the composer", async ({ page }, testInfo) => {
  const iso = new Date().toISOString();
  const sourceId = "synthetic-card-source";
  const project = { id: "synthetic-project", name: "Synthetic project", root: "/synthetic/project", createdAt: iso, updatedAt: iso };
  const report = {
    id: "synthetic-card-report", familiarId: "nova", sessionId: sourceId, reportedAt: iso,
    overallConfidence: 90, toolReliability: { score: 90, failedTools: [], unreliableTools: [] }, contextPressure: "adequate",
    skillsUsed: [], skillsNeedingAccess: [], skillsNeedingClarity: [], capabilitiesVital: [], capabilitiesLacking: [],
    memoryRecallScore: 90, fileLocatabilityScore: 90,
    persistentBlockers: [{ id: "write-boundary", title: "Synthetic write boundary", category: "tooling", impact: "blocking", detail: "Synthetic prerequisite" }],
  };
  const firstUse = completedFirstUsePayload({ project, familiarIds: ["nova"], actingFamiliarId: "nova", harness: "claude", permissionMode: "full" });
  let settledTurns = 7;
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === "/api/onboarding/journey") return route.fulfill({ json: url.searchParams.has("runtimeFamiliarId")
      ? { ok: true, runtime: { familiarId: "nova", harness: "claude", transport: "local", state: "ready" } } : { ok: true, ...firstUse } });
    if (pathname === "/api/familiars") return route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "General", harness: "claude", status: "active", icon: "ph:sparkle-fill", autoSelfReport: true }] } });
    if (pathname === "/api/projects") return route.fulfill({ json: { ok: true, projects: [{ ...project, access: "write" }] } });
    if (pathname === "/api/sessions/list") return route.fulfill({ json: { ok: true, sessions: [{ id: sourceId, familiarId: "nova", harness: "claude", project_root: project.root, runtime: `local:${project.root}`, title: "Synthetic signal source", status: "idle", created_at: iso, updated_at: iso, archived_at: null, exit_code: null }] } });
    if (pathname.startsWith("/api/chat/conversation/")) return route.fulfill({ json: { ok: true, conversation: { activeLeafId: `a${settledTurns - 1}`, turns: Array.from({ length: settledTurns }, (_, index) => ({ id: `a${index}`, parentId: index > 0 ? `a${index - 1}` : null, role: "assistant", text: "Synthetic completed response.", createdAt: iso })) } } });
    if (pathname === "/api/chat/model-state") return route.fulfill({ json: { ok: true, state: { familiarId: "nova", harness: "claude", runtime: "local", effectiveModel: null, source: "runtime-default", applicationState: "saved", reason: "Synthetic state", familiarDefaultModel: null } } });
    if (pathname === "/api/chat/generate/enhance") return route.fulfill({ contentType: "text/event-stream", body: [
      { kind: "assistant_chunk", text: JSON.stringify(report) }, { kind: "done", isError: false },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
    if (pathname === "/api/familiars/nova/self-report") return route.fulfill({ json: { ok: true, report } });
    if (pathname === `/api/familiars/nova/self-reports/${sourceId}`) return route.fulfill({ status: 404, json: { ok: false } });
    if (pathname === "/api/chat/signal-sweeps") {
      expect(route.request().method()).toBe("GET");
      return route.fulfill({ json: { ok: true, available: false, error: "Claude cannot enforce project write access. Choose a compatible runtime." } });
    }
    if (pathname === "/api/chat/send") {
      expect(settledTurns).toBe(7); settledTurns = 8;
      return route.fulfill({ contentType: "text/event-stream", body: [
        { kind: "assistant_chunk", text: "Synthetic turn completed." }, { kind: "done", sessionId: sourceId, isError: false },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
    }
    if (pathname === "/api/vault") return route.fulfill({ json: { ok: true, mappings: [] } });
    return route.fulfill({ json: { ok: false } });
  });
  await page.goto(`/?mode=chat#chat-${sourceId}`);
  const chat = page.getByTestId("chat-main");
  await expect(chat.locator(".cave-composer-input")).toBeVisible({ timeout: 45_000 });
  // Reaching the real automatic reflection checkpoint works on phones too;
  // opening an already mature history alone must not trigger a reflection.
  await chat.locator(".cave-composer-input").fill("Complete this synthetic turn");
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  const card = chat.getByRole("article", { name: "Thread Signal", exact: true });
  const warning = card.getByText(/cannot enforce project write access/);
  await expect(warning).toBeVisible();
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
    const target = await card.getByRole("button", { name: "Check again", exact: true }).boundingBox();
    expect(target && target.width >= 44 && target.height >= 44).toBe(true);
  }
  expect(await warning.evaluate((element) => {
    const rect = element.getBoundingClientRect(), card = element.closest(".tsc-card")!.getBoundingClientRect();
    return rect.top >= card.top && rect.bottom <= card.bottom && rect.left >= card.left && rect.right <= card.right;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("in-chat-signal-unavailable.png"), animations: "disabled" });
  await card.locator(".tsc-row-btn").filter({ hasText: "Synthetic write boundary" }).click();
  await expect(card.getByRole("button", { name: "Fix in Build", exact: true })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Fix 1 critical in Build", exact: true })).toBeDisabled();
  const box = await card.boundingBox(); const viewport = page.viewportSize()!;
  expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1).toBe(true);
  for (const button of await card.locator(".tsc-foot button").all()) {
    const edge = await button.boundingBox();
    expect(edge && edge.x >= 0 && edge.x + edge.width <= viewport.width + 1).toBe(true);
    if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) expect(edge && edge.width >= 44 && edge.height >= 44).toBe(true);
  }
  await expect(chat.locator(".cave-composer-input")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("in-chat-signal-actions.png"), animations: "disabled" });
});
