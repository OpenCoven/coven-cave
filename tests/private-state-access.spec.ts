import { expect, test, type Page, type Route } from "@playwright/test";
import { completedFirstUsePayload } from "./fixtures/first-use";

// #6451: a folder that holds Cave's private state can't get Write. Projects
// and Access groups flag a Write grant made before that rule and skip Write
// when cycling; a refusal from the server is shown in its own words. Chat
// names the folder and grant behind a refused Full access turn and opens
// Projects at that project.
//
// Daemon-less (COVEN_CAVE_E2E=1): every API is a scoped page.route mock.
// Listed in MOBILE_SURFACE_SPECS so it runs on desktop, Pixel 5 and iPhone 13.

const ISO = "2026-11-11T09:00:00.000Z";
const SESSION_ID = "private-state-chat";
test.use({ contextOptions: { reducedMotion: "reduce" } });

const PROJECTS = [
  { id: "home", name: "Coven home", root: "/home/cave/.coven", createdAt: ISO, updatedAt: ISO },
  { id: "state", name: "Cave state", root: "/home/cave/.coven/cave", createdAt: ISO, updatedAt: ISO },
  { id: "app", name: "Coven Cave", root: "/workspace/coven-cave", repoUrl: "https://github.com/OpenCoven/coven-cave", createdAt: ISO, updatedAt: ISO },
];
const PRIVATE_STATE = ["home", "state"];
const OVERLAP_MESSAGE =
  "Nova can write to Coven home (~/.coven) through the Coders access group, and that folder contains Cave’s private state, so Cave won’t start a Full access turn. In Projects, change Coven home to Read in Coders, then retry. Read only turns still work.";

type Grant = { familiarId: string; projectId: string; access: "read" | "write" };
type Group = { id: string; name: string; memberFamiliarIds: string[]; projectGrants: { projectId: string; access: "read" | "write" }[] };

async function setup(page: Page, options: {
  send?: (route: Route) => Promise<void> | void;
  overlapMessage?: string;
  groupReadsState?: boolean;
  /** Nova is the supreme familiar. */
  supreme?: boolean;
  /** The Projects pane the person last used. */
  pane?: "groups" | "activity";
  /** Supreme asked for Write on the private-state folder before the rule. */
  requests?: boolean;
} = {}) {
  const grants: Grant[] = [{ familiarId: "nova", projectId: "home", access: "write" }];
  const groups: Group[] = [{
    id: "coders", name: "Coders", memberFamiliarIds: ["nova"],
    projectGrants: [
      { projectId: "home", access: "write" },
      ...(options.groupReadsState ? [{ projectId: "state", access: "read" as const }] : []),
    ],
  }];
  const writes: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  // A server refusal the listing didn't predict, as after a stale fetch.
  let refuseNextWrite = false;
  await page.addInitScript((pane) => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:chat-composer-controls:v1", JSON.stringify({ permissionMode: "full" }));
    if (pane) localStorage.setItem("cave:projects:pane", pane);
  }, options.pane ?? null);
  const firstUse = completedFirstUsePayload({
    project: PROJECTS[2], familiarIds: ["nova"], actingFamiliarId: "nova", permissionMode: "full", harness: "claude",
  });
  await page.route("**/api/onboarding/journey**", (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 403, json: { ok: false } });
    const familiarId = new URL(route.request().url()).searchParams.get("runtimeFamiliarId");
    return route.fulfill({ json: familiarId
      ? { ok: true, runtime: { familiarId, harness: "claude", transport: "local", state: "ready" } }
      : { ok: true, ...firstUse } });
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true,
    familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", harness: "claude", icon: "ph:sparkle-fill" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: {
    ok: true,
    sessions: [{ id: SESSION_ID, title: "Private state chat", status: "idle", project_root: "/workspace/coven-cave", harness: "claude", familiarId: "nova", model: null, runtime: "local:/workspace/coven-cave", exit_code: null, archived_at: null, created_at: ISO, updated_at: ISO }],
  } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: {
    ok: true, projects: PROJECTS.map((project) => ({ ...project, access: "write" })),
  } }));
  await page.route("**/api/project-grants**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return route.fulfill({ json: {
        ok: true, grants: grants.map((grant) => ({ ...grant, source: "human", grantedAt: ISO })),
        accessGroups: groups, supremeFamiliarId: options.supreme ? "nova" : null, audit: [], grantChanges: [],
        privateStateProjectIds: PRIVATE_STATE,
      } });
    }
    const body = request.postDataJSON() as Grant & { targetFamiliarId: string } | null;
    writes.push({ url: request.url(), method: request.method(), body });
    const projectId = body?.projectId ?? "";
    if (request.method() === "POST" && body?.access === "write" && (PRIVATE_STATE.includes(projectId) || refuseNextWrite)) {
      refuseNextWrite = false;
      const project = PROJECTS.find((entry) => entry.id === projectId)!;
      return route.fulfill({ status: 409, json: { ok: false, code: "cave_private_state_write", projectId,
        error: `${project.name} (${project.root}) contains Cave’s private state, so no familiar can have Write access to it. Choose Read instead.` } });
    }
    const index = grants.findIndex((grant) => grant.familiarId === body?.targetFamiliarId && grant.projectId === projectId);
    if (request.method() === "DELETE") {
      if (index >= 0) grants.splice(index, 1);
    } else if (index >= 0) {
      grants[index].access = body!.access;
    } else {
      grants.push({ familiarId: body!.targetFamiliarId, projectId, access: body!.access });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/access-groups**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: { ok: true, accessGroups: groups } });
    const body = request.postDataJSON() as { projectGrants?: Group["projectGrants"] } | null;
    writes.push({ url: request.url(), method: request.method(), body });
    if (body?.projectGrants) groups[0].projectGrants = body.projectGrants;
    return route.fulfill({ json: { ok: true, group: groups[0] } });
  });
  const proposals = options.requests
    ? [{ id: "old-request", proposedBy: "supreme", targetFamiliarId: "nova", projectId: "home", access: "write", status: "pending", createdAt: ISO }]
    : [];
  await page.route("**/api/grant-proposals**", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ok: true, proposals } });
    return route.fulfill({ status: 409, json: { ok: false, code: "cave_private_state_write", projectId: "home",
      error: "Coven home (/home/cave/.coven) contains Cave’s private state, so no familiar can have Write access to it. Choose Read instead." } });
  });
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({ json: {
    ok: true,
    conversation: { activeLeafId: "a1", turns: [{ id: "a1", parentId: null, role: "assistant", text: "Ready for a message.", createdAt: ISO }] },
  } }));
  await page.route("**/api/vault**", (route) => route.fulfill({ json: { ok: true, mappings: [] } }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({ json: {
    ok: true,
    state: { familiarId: "nova", runtime: null, harness: "claude", effectiveModel: null, source: "runtime-default", applicationState: "saved", reason: "e2e", familiarDefaultModel: null },
  } }));
  await page.route("**/api/chat/send", (route) => options.send
    ? options.send(route)
    : route.fulfill({ status: 409, json: { ok: false, code: "scoped_write_unavailable", reason: "cave_private_state_overlap",
      overlap: { source: "project", root: "/home/cave/.coven", folder: "~/.coven", relation: "contains", projectId: "home", projectName: "Coven home", direct: false, groups: [{ id: "coders", name: "Coders" }], message: options.overlapMessage ?? OVERLAP_MESSAGE },
      error: options.overlapMessage ?? OVERLAP_MESSAGE } }));
  return { grants, groups, writes, refuseNext: () => { refuseNextWrite = true; } };
}

async function openProjects(page: Page) {
  await page.goto("/?mode=chat", { waitUntil: "domcontentloaded" });
  await page.getByTestId("detail").getByRole("tab", { name: "Projects" }).click();
  // The Projects surface is a lazy chunk; its first dev compile can be slow.
  await expect(page.locator(".projects-access")).toBeVisible({ timeout: 180_000 });
  await expect(page.locator(".projects-access-card")).toHaveCount(PROJECTS.length);
}

const card = (page: Page, name: string) => page.locator(".projects-access-card", { hasText: name });

test("Projects flags an existing Write grant on Cave's private state and never offers Write there", async ({ page }) => {
  const { grants, writes, refuseNext } = await setup(page);
  await openProjects(page);

  // The Write grant made before the rule is flagged, and says what to do.
  const homePill = card(page, "Coven home").locator(".projects-access-pill");
  await expect(homePill).toHaveClass(/is-private-state/);
  await expect(homePill).toHaveAttribute("aria-label", /holds Cave’s private state, so familiars can’t get write access to it\. While one can write here, its Claude Build turns are refused\. Change it to Read\./);
  await expect(homePill.locator(".projects-access-warning")).toBeVisible();

  // An ungranted folder holding the private state cycles none → read → none.
  const statePill = card(page, "Cave state").locator(".projects-access-pill");
  await expect(statePill).toHaveText(/No access/);
  await statePill.click();
  await expect(statePill).toHaveText(/^Read$/);
  await expect(statePill).toHaveAttribute("aria-label", /Click to remove access\./);
  await statePill.click();
  await expect(statePill).toHaveText(/No access/);
  expect(writes.map((write) => `${write.method} ${write.body?.access ?? ""}`)).toEqual(["POST read", "DELETE "]);
  await expect(statePill).not.toHaveClass(/is-private-state/);

  // Removing the flagged direct grant works as before. Coders still gives
  // Write, so the pill stays flagged until that group is narrowed too.
  await homePill.click();
  await expect.poll(() => grants.some((grant) => grant.projectId === "home")).toBe(false);
  await expect(homePill).toHaveClass(/is-private-state/);

  // A refusal the listing didn't predict is shown in the server's words.
  const appPill = card(page, "Coven Cave").locator(".projects-access-pill");
  await appPill.click();
  await expect(appPill).toHaveText(/^Read$/);
  refuseNext();
  await appPill.click();
  await expect(page.getByText("Coven Cave (/workspace/coven-cave) contains Cave’s private state, so no familiar can have Write access to it. Choose Read instead.")).toBeVisible();
  await expect(appPill).toHaveText(/^Read$/);
});

test("A bulk change and the tree view say why a private-state folder stays below Full", async ({ page }) => {
  const { writes } = await setup(page);
  await openProjects(page);

  // "Set all: Full" gives the ungranted private-state folder Read, and says
  // so where a sighted person reads it, not only to a screen reader.
  const section = card(page, "Cave state").locator("xpath=ancestor::section[1]");
  const setAllFull = section.locator(".projects-access-setall-btn.is-write");
  await setAllFull.click();
  const notice = page.locator(".projects-access-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/Cave state can’t get Full, because (it holds|they hold) Cave’s private state\./);
  await expect(card(page, "Cave state").locator(".projects-access-pill")).toHaveText(/^Read$/);
  expect(writes.filter((write) => PRIVATE_STATE.includes(String(write.body?.projectId))).map((write) => write.body?.access)).toEqual(["read"]);
  // Asked again there is nothing left to change, and the reason still shows.
  await setAllFull.click();
  await expect(notice).toContainText("Cave’s private state.");
  expect(writes.filter((write) => PRIVATE_STATE.includes(String(write.body?.projectId)))).toHaveLength(1);

  // The tree view has no pill. Its chip carries the warning and the reason.
  await page.getByRole("group", { name: "View mode" }).getByRole("button", { name: "Tree" }).click();
  const chip = page.locator(".projects-access-chip", { hasText: "Coven home" });
  await expect(chip).toHaveClass(/is-private-state/);
  await expect(chip.locator(".projects-access-warning")).toBeVisible();
  await expect(chip).toHaveAccessibleName(/While one can write here, its Claude Build turns are refused\. Change it to Read\.$/);
  await expect(page.locator(".projects-access-chip", { hasText: "Cave state" })).not.toHaveClass(/is-private-state/);
});

test("The supreme familiar's real access shows on a private-state folder and can be narrowed", async ({ page }) => {
  const { grants } = await setup(page, { supreme: true });
  await openProjects(page);

  // Everywhere else the supreme familiar is locked at Full.
  const appPill = card(page, "Coven Cave").locator(".projects-access-pill");
  await expect(appPill).toHaveText(/^Full$/);
  await expect(appPill).toBeDisabled();
  // No grant on this folder: it reads as none, not as a Write to worry about.
  const statePill = card(page, "Cave state").locator(".projects-access-pill");
  await expect(statePill).toHaveText(/No access/);
  await expect(statePill).not.toHaveClass(/is-private-state/);
  // The Write grant made before the rule is flagged, and a person can remove it.
  const homePill = card(page, "Coven home").locator(".projects-access-pill");
  await expect(homePill).toHaveClass(/is-private-state/);
  await expect(homePill).toBeEnabled();
  await homePill.click();
  await expect.poll(() => grants.some((grant) => grant.projectId === "home")).toBe(false);
});

test("Accepting an old Write request on a private-state folder is refused in the server's words", async ({ page }) => {
  await setup(page, { requests: true });
  await openProjects(page);
  await page.getByRole("tab", { name: "Activity" }).click();
  await page.getByRole("button", { name: "Accept granting Coven home to Nova" }).click();
  await expect(page.getByText("Coven home (/home/cave/.coven) contains Cave’s private state, so no familiar can have Write access to it. Choose Read instead.")).toBeVisible();
  await expect(page.getByText("Couldn’t record that decision.")).toHaveCount(0);
});

test("Access groups flag the same grant and skip Write for it", async ({ page }) => {
  const { groups, writes } = await setup(page, { groupReadsState: true });
  await openProjects(page);
  await page.getByRole("tab", { name: "Groups" }).click();
  await page.getByRole("button", { name: /Coders/ }).first().click();

  const homeChip = page.getByRole("button", { name: /^Coven home access for Coders: Read \+ write\./ });
  await expect(homeChip).toHaveAttribute("data-private-state", "true");
  await expect(homeChip).toHaveAccessibleName(/Change it to Read\.$/);

  // Read on a folder holding the private state goes to Off, not Write.
  const stateChip = page.getByRole("button", { name: /^Cave state access for Coders: Read\./ });
  await expect(stateChip).not.toHaveAttribute("data-private-state", "true");
  await expect(stateChip).toHaveAccessibleName(/the next click removes access/);
  await stateChip.click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body?.projectGrants).toEqual([{ projectId: "home", access: "write" }]);
  await expect(page.getByRole("button", { name: /^Cave state access for Coders: off\./ })).toBeVisible();
  expect(groups[0].projectGrants).toEqual([{ projectId: "home", access: "write" }]);
});

test("Chat names the folder and grant behind a refused Full access turn, and opens Projects there", async ({ page }) => {
  // The person last used Groups: the handoff still lands on Access.
  await setup(page, { pane: "groups" });
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  await expect(chat.locator(".cave-composer-input")).toBeVisible({ timeout: 45_000 });
  await chat.locator(".cave-composer-input").fill("resume the restyle");
  await chat.getByRole("button", { name: "Send message" }).click();

  // The server's own sentence, without a status prefix the person can't use.
  const strip = chat.getByRole("alert").filter({ hasText: OVERLAP_MESSAGE });
  await expect(strip).toBeVisible();
  await expect(strip).not.toContainText("request failed");
  // The whole sentence is readable: it wraps instead of being cut off, so
  // the folder, the grant and the fix all show at phone width too.
  const reason = strip.getByText(OVERLAP_MESSAGE);
  expect(await reason.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const box = await strip.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width + 1).toBe(true);
  // Retry stays for after the grant is narrowed. With Open projects there
  // are six buttons: every one stays on screen, down to Dismiss.
  await expect(strip.getByRole("button", { name: "Retry" })).toBeVisible();
  for (const button of await strip.getByRole("button").all()) {
    const edge = await button.boundingBox();
    expect(edge && viewport && edge.x >= 0 && edge.x + edge.width <= viewport.width + 1, await button.innerText() || "Dismiss").toBe(true);
  }

  await strip.getByRole("button", { name: "Open projects" }).click();
  await expect(page.locator(".projects-access")).toBeVisible({ timeout: 180_000 });
  const home = page.locator(".projects-access-card", { hasText: "Coven home" });
  await expect(home).toBeInViewport();
  await expect(home.locator(".projects-access-pill")).toHaveClass(/is-private-state/);

  // Projects replaced the chat, and its Retry with it. Reopened from the
  // list, the refused message is in the composer to send again.
  await page.getByTestId("detail").getByRole("tab", { name: "Chats" }).click();
  await page.getByRole("button", { name: /^Reorder chat Private state chat Private state chat/ }).click();
  await expect(page.getByTestId("chat-main").locator(".cave-composer-input")).toHaveValue("resume the restyle", { timeout: 45_000 });

  // The already-mounted handoff must not leave a latch that changes the next
  // fresh visit to Chat after the person has explicitly returned to Chats.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "home" } })));
  await expect(page.getByTestId("detail").getByRole("tab", { name: "Chats", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } })));
  await expect(page.getByTestId("detail").getByRole("tab", { name: "Chats", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("Open projects works from the Chat panel beside Home", async ({ page }) => {
  // Nothing listens for the Projects tab outside Chat, so the action has to
  // go there first. A desktop layout: phones have no side panel.
  test.skip((page.viewportSize()?.width ?? 0) < 1024, "the side Chat panel is a desktop layout");
  await setup(page);
  await page.goto("/?mode=home", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open Chat panel" }).click();
  const panel = page.getByRole("complementary", { name: "Chat panel" });
  await expect(panel.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 45_000 });
  await panel.getByRole("textbox", { name: "Message" }).fill("resume the restyle");
  await panel.getByRole("button", { name: "Send message" }).click();

  const strip = panel.getByRole("alert").filter({ hasText: OVERLAP_MESSAGE });
  await expect(strip).toBeVisible();
  await strip.getByRole("button", { name: "Open projects" }).click();
  await expect(page.locator(".projects-access")).toBeVisible({ timeout: 180_000 });
  const home = page.locator(".projects-access-card", { hasText: "Coven home" });
  await expect(home).toBeInViewport();
  await expect(home.locator(".projects-access-pill")).toHaveClass(/is-private-state/);
});


test("A long private-state refusal remains fully readable", async ({ page }, testInfo) => {
  const message = `Nova can write to Coven home (~/a-very-long-project-folder/${"nested/".repeat(16)}.coven) through ${Array.from({ length: 8 }, (_, i) => `Access group number ${i + 1}`).join(", ")}. That folder contains Cave’s private state. In Projects, change every listed grant to Read, then retry.`;
  await setup(page, { overlapMessage: message });
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  const chat = page.getByTestId("chat-main");
  await chat.locator(".cave-composer-input").fill("resume the restyle");
  await chat.getByRole("button", { name: "Send message" }).click();
  const reason = chat.getByRole("alert").getByText(message);
  await expect(reason).toBeVisible();
  expect(await reason.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(chat.getByRole("button", { name: "Open projects" })).toBeVisible();
  const screenshot = testInfo.outputPath("readable-private-state-refusal.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("readable-private-state-refusal", { path: screenshot, contentType: "image/png" });
});
