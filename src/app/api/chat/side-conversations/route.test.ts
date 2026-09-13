import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".validation/side-lifecycle-0fd562c1", `routes-${process.pid}`);
await mkdir(root, { recursive: true });
const previous = { HOME: process.env.HOME, COVEN_HOME: process.env.COVEN_HOME, CAVE_PROJECTS_PATH_OVERRIDE: process.env.CAVE_PROJECTS_PATH_OVERRIDE };
process.env.HOME = root;
process.env.COVEN_HOME = path.join(root, ".coven");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(root, "projects.json");
const { caveHome } = await import("../../../../lib/coven-paths.ts");
await mkdir(caveHome(), { recursive: true });
await writeFile(path.join(caveHome(), "config.json"), JSON.stringify({ version: 1, familiars: { cody: { harness: "codex" } } }));
await mkdir(path.join(root, "project"), { recursive: true });
await writeFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, JSON.stringify({ projects: [{
  id: "project-one", name: "Test project", root: path.join(root, "project"),
  createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z",
}] }));
const { grantProjectToFamiliar, revokeProjectFromFamiliar } = await import("../../../../lib/project-permissions.ts");
const { loadConversation, saveConversation, searchConversations, listConversations } = await import("../../../../lib/cave-conversations.ts");
const { sideConversationBranch } = await import("../../../../lib/server/chat-side-conversations.ts");
const collection = await import("./route.ts");
const lifecycle = await import("./[id]/route.ts");
const bringBack = await import("./[id]/bring-back/route.ts");
const ordinaryConversation = await import("../conversation/[id]/route.ts");
const scope = { parentSessionId: "parent", familiarId: "cody", projectId: "project-one" };
const request = (body: unknown, method = "POST") => new Request("http://localhost/api/chat/side-conversations", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
try {
  await saveConversation({ sessionId: "parent", familiarId: "cody", harness: "codex",
    runtime: `local:${path.join(root, "project")}`, updatedAt: "2026-09-09T00:00:00.000Z",
    activeLeafId: "p1", turns: [{ id: "p1", role: "user", text: "Parent note", parentId: null, createdAt: "2026-09-09T00:00:00.000Z" }] });
  const parent = (await loadConversation("parent"))!;
  const input = { operationId: "route-create", scope, expectedParent: sideConversationBranch(parent),
    context: { mode: "fresh", turnIds: [] }, retention: "retained", draftText: "Isolated side draft", title: "Route side" };
  const denied = await collection.POST(request(input));
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "project_access_denied");
  await grantProjectToFamiliar({ familiarId: "cody", projectId: "project-one", source: "human", access: "write" });
  const createdResponse = await collection.POST(request(input));
  assert.equal(createdResponse.status, 200, await createdResponse.clone().text());
  const created = await createdResponse.json();
  assert.equal(created.ok, true);
  assert.equal(created.conversation.sideConversation.execution.state, "unavailable");
  const id = created.conversation.sessionId;
  const params = { params: Promise.resolve({ id }) };
  assert.ok(!(await listConversations()).some((row) => row.sessionId === id), "ordinary retrieval excludes side drafts");
  assert.equal((await searchConversations("Isolated")).length, 0);
  const listed = await collection.GET(new Request(`http://localhost/api/chat/side-conversations?${new URLSearchParams(scope)}`));
  assert.equal(listed.status, 200);
  const listing = await listed.json();
  assert.equal(listing.conversations.length, 1);
  assert.equal(listing.conversations[0].turns, undefined);
  assert.equal(listing.conversations[0].sideConversation.contextSelection, undefined);
  assert.equal(listing.nextCursor, null);
  const detail = await lifecycle.GET(new Request(`http://localhost/api/chat/side-conversations/${id}?${new URLSearchParams(scope)}`), params);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).conversation.turns[0].text, "Isolated side draft");
  assert.equal((await collection.POST(request({ ...input, retention: "temporary" }))).status, 422);
  assert.equal((await collection.POST(request({ ...input, scope: { ...scope, projectId: "other" } }))).status, 403);
  assert.equal((await collection.POST(request({ ...input, admittedManifest: {} }))).status, 400);
  const source = (await loadConversation(id))!;
  const bring = { operationId: "route-bring", scope, targetSessionId: "parent",
    expectedSource: sideConversationBranch(source), expectedTarget: sideConversationBranch((await loadConversation("parent"))!),
    sourceTurnIds: [source.turns[0].id], reviewedText: "Reviewed, edited side draft" };
  const imported = await bringBack.POST(request(bring), params);
  assert.equal(imported.status, 200, await imported.clone().text());
  const result = await imported.json();
  assert.equal(result.conversation.turns.at(-1).reviewedExcerpt.inert, true);
  assert.equal((await loadConversation("parent"))!.turns.length, 2);
  const closed = await lifecycle.PATCH(request({ operationId: "route-close", scope, expectedGeneration: 1, action: "close" }, "PATCH"), params);
  assert.equal(closed.status, 200);
  assert.equal((await closed.json()).conversation.sideConversation.presentation, "closed");
  const discard = { operationId: "route-discard", scope, expectedGeneration: 2, action: "discard" };
  assert.equal((await lifecycle.PATCH(request(discard, "PATCH"), params)).status, 200);
  assert.equal((await lifecycle.PATCH(request(discard, "PATCH"), params)).status, 200);
  assert.equal((await bringBack.POST(request(bring), params)).status, 200, "receipt reconciliation does not need the discarded source");
  await revokeProjectFromFamiliar({ familiarId: "cody", projectId: "project-one" });
  assert.equal((await bringBack.POST(request(bring), params)).status, 403, "current target access precedes receipt lookup");
  assert.equal((await collection.GET(new Request(`http://localhost/api/chat/side-conversations?${new URLSearchParams(scope)}`))).status, 403);
  const badJson = await collection.POST(new Request("http://localhost/api/chat/side-conversations", { method: "POST", body: "{" }));
  assert.equal(badJson.status, 400);
  const oversized = await collection.POST(new Request("http://localhost/api/chat/side-conversations", { method: "POST", body: "x".repeat(65537) }));
  assert.equal(oversized.status, 413);
  assert.equal((await collection.GET(new Request("http://localhost/api/chat/side-conversations"))).status, 400);
  const targetParams = { params: Promise.resolve({ id: "parent" }) };
  const targetUrl = "http://localhost/api/chat/conversation/parent";
  assert.equal((await ordinaryConversation.DELETE(new Request(targetUrl, { method: "DELETE" }), targetParams)).status, 200);
  assert.equal((await ordinaryConversation.GET(new Request(targetUrl), targetParams)).status, 410, "deletion does not fall back to native transcripts");
  assert.equal((await ordinaryConversation.PUT(request({ familiarId: "cody", harness: "codex", turns: parent.turns }, "PUT"), targetParams)).status, 410);
  assert.equal((await ordinaryConversation.POST(request({ turn: parent.turns[0] }), targetParams)).status, 410);
  console.log("side routes: real project grants, lifecycle, reviewed import, revoked access and bounded bodies passed");
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
}
