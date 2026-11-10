import assert from "node:assert/strict";
import test from "node:test";
import {
  accessRefusalActions,
  chatBuildAccessFor,
  claudeBuildUnavailableMessage,
  GrantChangeError,
  grantProjectAccess,
  isAccessRefusalCode,
  parseChatBuildAccess,
  planReadyFromTools,
  readChatAccessOverride,
  undoProjectGrant,
  writeChatAccessOverride,
} from "./chat-access-escape.ts";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

test("build access parses only a well-formed server report", () => {
  assert.deepEqual(parseChatBuildAccess({ access: { build: { available: true } } }), { available: true });
  assert.deepEqual(
    parseChatBuildAccess({ access: { build: { available: false, code: "scoped_write_unavailable", message: " Needs a newer Coven. " } } }),
    { available: false, code: "scoped_write_unavailable", message: "Needs a newer Coven." },
  );
  // An unavailable report without a reason would hide Build with nothing to say: unknown instead.
  assert.equal(parseChatBuildAccess({ access: { build: { available: false } } }), null);
  assert.equal(parseChatBuildAccess({ ok: true }), null);
  assert.equal(parseChatBuildAccess(null), null);
});

test("a finished Claude plan is recognized from its tool trail, not from ordinary tools", () => {
  // Claude Code 2.1.322 `-p` plan mode: plan file, then a search for ExitPlanMode.
  assert.equal(planReadyFromTools([
    { name: "Read", input: "/repo/note.txt" },
    { name: "Write", input: "/Users/val/.claude/plans/rename-helper.md" },
    { name: "ToolSearch", input: "select:ExitPlanMode" },
  ]), true);
  assert.equal(planReadyFromTools([{ name: "ExitPlanMode", input: "" }]), true);
  assert.equal(planReadyFromTools([{ name: "Write", input: "C:\\Users\\val\\.claude\\plans\\fix.md" }]), true);
  assert.equal(planReadyFromTools([{ name: "Write", input: "/repo/docs/plans/fix.md" }]), false);
  assert.equal(planReadyFromTools([{ name: "Read", input: "/Users/val/.claude/plans/old.md" }]), false);
  assert.equal(planReadyFromTools([]), false);
  assert.equal(planReadyFromTools(undefined), false);
});

test("each refusal maps to actions that can clear it, and never a Build that cannot run", () => {
  const base = { requested: "full" as const, buildAccess: { available: true } as const, projectAccess: "write" as const, canGrant: true };
  assert.deepEqual(accessRefusalActions({ ...base, code: "project_write_access_required", projectAccess: "read" }), ["grant-write-retry", "retry-explore"]);
  assert.deepEqual(accessRefusalActions({ ...base, code: "project_write_access_required", projectAccess: "read", canGrant: false }), ["retry-explore"]);
  assert.deepEqual(accessRefusalActions({ ...base, code: "read_only_unavailable", requested: "read" }), ["retry-build"]);
  assert.deepEqual(accessRefusalActions({ ...base, code: "read_only_unavailable", requested: "read", projectAccess: "read" }), []);
  assert.deepEqual(accessRefusalActions({
    ...base, code: "read_only_unavailable", requested: "read",
    buildAccess: { available: false, code: "scoped_write_unavailable", message: "Needs a newer Coven." },
  }), []);
  for (const code of ["scoped_write_unavailable", "runtime_write_scope_unavailable", "write_scope_aliases_unsupported", "write_scope_profile_unqualified"] as const) {
    assert.deepEqual(accessRefusalActions({ ...base, code }), ["retry-explore"], code);
    assert.deepEqual(accessRefusalActions({ ...base, code, requested: "read" }), [], `${code} in Explore`);
  }
  assert.deepEqual(accessRefusalActions({ ...base, code: "write_permission_denied" }), ["open-project-access"]);
  assert.equal(isAccessRefusalCode("project_write_access_required"), true);
  assert.equal(isAccessRefusalCode("project_access_denied"), false, "a revoked project keeps its own recovery");
  assert.equal(isAccessRefusalCode(undefined), false);
});

test("per-chat access round-trips, clears, ignores bad data and stays bounded", () => {
  const storage = memoryStorage();
  assert.equal(readChatAccessOverride(storage, "s1"), null);
  writeChatAccessOverride(storage, "s1", "full");
  writeChatAccessOverride(storage, "s2", "read");
  assert.equal(readChatAccessOverride(storage, "s1"), "full");
  assert.equal(readChatAccessOverride(storage, "s2"), "read");
  writeChatAccessOverride(storage, "s1", null);
  assert.equal(readChatAccessOverride(storage, "s1"), null);
  assert.equal(readChatAccessOverride(storage, null), null);
  writeChatAccessOverride(storage, null, "full");
  storage.data.set("cave:chat-access-overrides:v1", JSON.stringify([["s3", "admin"], ["", "full"], "junk", ["s4", "full"]]));
  assert.equal(readChatAccessOverride(storage, "s3"), null);
  assert.equal(readChatAccessOverride(storage, "s4"), "full");
  storage.data.set("cave:chat-access-overrides:v1", "{not json");
  assert.equal(readChatAccessOverride(storage, "s4"), null);
  for (let index = 0; index < 120; index += 1) writeChatAccessOverride(storage, `chat-${index}`, "full");
  assert.equal(readChatAccessOverride(storage, "chat-0"), null, "the oldest chats fall off");
  assert.equal(readChatAccessOverride(storage, "chat-119"), "full");
  assert.equal(JSON.parse(storage.data.get("cave:chat-access-overrides:v1")!).length, 100);
});

// Mirrors /api/project-grants: an `expectedAccess` precondition that no longer
// matches the current direct grant is refused whole with 409 grant_changed.
function grantServer(initial: Array<{ familiarId: string; projectId: string; access: string }>) {
  let grants = [...initial];
  const calls: Array<{ method: string; body: unknown }> = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") return new Response(JSON.stringify({ ok: true, grants }));
    const body = JSON.parse(String(init?.body));
    calls.push({ method, body });
    const current = grants.find((grant) => grant.familiarId === body.targetFamiliarId && grant.projectId === body.projectId)?.access ?? null;
    if ("expectedAccess" in body && body.expectedAccess !== current) {
      return new Response(JSON.stringify({ ok: false, code: "grant_changed", error: "access changed after it was shown", current }), { status: 409 });
    }
    grants = grants.filter((grant) => !(grant.familiarId === body.targetFamiliarId && grant.projectId === body.projectId));
    if (method === "POST") grants.push({ familiarId: body.targetFamiliarId, projectId: body.projectId, access: body.access });
    return new Response(JSON.stringify({ ok: true }));
  }) as typeof fetch;
  return { fetchImpl, calls, set: (next: typeof initial) => { grants = [...next]; }, grants: () => grants };
}

const TARGET = { familiarId: "nova", familiarName: "Nova", projectId: "p1", projectName: "Coven Cave" };

test("a grant from Chat records the previous direct grant, and Undo restores it exactly", async () => {
  const fromRead = grantServer([{ familiarId: "nova", projectId: "p1", access: "read" }, { familiarId: "sage", projectId: "p1", access: "write" }]);
  const undo = await grantProjectAccess(fromRead.fetchImpl, TARGET, "write");
  assert.equal(undo.previous, "read");
  assert.equal(undo.granted, "write");
  await undoProjectGrant(fromRead.fetchImpl, undo);
  // Each change names the grant it expects to replace.
  assert.deepEqual(fromRead.calls, [
    { method: "POST", body: { targetFamiliarId: "nova", projectId: "p1", access: "write", expectedAccess: "read" } },
    { method: "POST", body: { targetFamiliarId: "nova", projectId: "p1", access: "read", expectedAccess: "write" } },
  ]);

  // No direct grant before (for example, read through an access group): Undo revokes.
  const fromGroup = grantServer([]);
  const groupUndo = await grantProjectAccess(fromGroup.fetchImpl, TARGET, "write");
  assert.equal(groupUndo.previous, null);
  await undoProjectGrant(fromGroup.fetchImpl, groupUndo);
  assert.deepEqual(fromGroup.calls[0], { method: "POST", body: { targetFamiliarId: "nova", projectId: "p1", access: "write", expectedAccess: null } });
  assert.deepEqual(fromGroup.calls.at(-1), { method: "DELETE", body: { targetFamiliarId: "nova", projectId: "p1", expectedAccess: "write" } });
});

test("a stale Undo is refused and leaves the newer grant in place", async () => {
  const server = grantServer([{ familiarId: "nova", projectId: "p1", access: "read" }]);
  const undo = await grantProjectAccess(server.fetchImpl, TARGET, "write");
  // Someone else lowers the grant after Chat's change; Undo must not overwrite it.
  server.set([{ familiarId: "nova", projectId: "p1", access: "read" }]);
  await assert.rejects(undoProjectGrant(server.fetchImpl, undo), (error: unknown) =>
    error instanceof GrantChangeError && error.code === "grant_changed" && error.status === 409);
  assert.deepEqual(server.grants(), [{ familiarId: "nova", projectId: "p1", access: "read" }]);
  // Revoked elsewhere: an Undo that would revoke is refused too.
  const fresh = grantServer([]);
  const revokeUndo = await grantProjectAccess(fresh.fetchImpl, TARGET, "write");
  fresh.set([]);
  await assert.rejects(undoProjectGrant(fresh.fetchImpl, revokeUndo), /changed after it was shown/);
});

test("a refused grant change surfaces the server's reason and changes nothing locally", async () => {
  const refused = (async (_url: string, init?: RequestInit) => (init?.method ?? "GET") === "GET"
    ? new Response(JSON.stringify({ ok: true, grants: [] }))
    : new Response(JSON.stringify({ ok: false, error: "grant changes must be confirmed from the local desktop" }), { status: 403 })) as typeof fetch;
  await assert.rejects(grantProjectAccess(refused, TARGET, "write"), /confirmed from the local desktop/);
  const unreadable = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  await assert.rejects(grantProjectAccess(unreadable, TARGET, "write"), /couldn't read project access/);
});

test("only a local Claude binding without Coven write scope reports Build unavailable", () => {
  const claude = { harness: "claude", localBinding: true, writeScopeSupported: false, permissionForwarding: true };
  assert.deepEqual(chatBuildAccessFor(claude), {
    available: false, code: "scoped_write_unavailable", message: claudeBuildUnavailableMessage(true),
  });
  assert.match(chatBuildAccessFor({ ...claude, permissionForwarding: false }).available === false
    ? (chatBuildAccessFor({ ...claude, permissionForwarding: false }) as { message: string }).message : "", /Update Coven and restart Cave/);
  assert.deepEqual(chatBuildAccessFor({ ...claude, writeScopeSupported: true }), { available: true });
  assert.deepEqual(chatBuildAccessFor({ ...claude, localBinding: false }), { available: true }, "SSH bindings keep the send route's own decision");
  assert.deepEqual(chatBuildAccessFor({ ...claude, harness: "codex" }), { available: true });
});
