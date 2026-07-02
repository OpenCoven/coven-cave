// @ts-nocheck
import assert from "node:assert/strict";
import { addChatProject, projectNameForRoot } from "./chat-add-project.ts";

// projectNameForRoot: the leaf folder is the human name.
assert.equal(projectNameForRoot("/Users/me/code/coven-cave"), "coven-cave");
assert.equal(projectNameForRoot("C:\\Users\\me\\proj"), "proj");
assert.equal(projectNameForRoot("/trailing/slash/"), "slash");
assert.equal(projectNameForRoot(""), "");

// Unregistered root → create the project (auto-named from the leaf) then grant
// it to the active familiar.
{
  const calls = [];
  const createProject = async (name, root) => {
    calls.push(["create", name, root]);
    return { id: "p1", name, root };
  };
  const fetchImpl = async (url, init) => {
    calls.push(["fetch", url, JSON.parse(init.body)]);
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const result = await addChatProject({ root: "/code/orphan", familiarId: "sage", createProject, fetchImpl });
  assert.deepEqual(result, { ok: true, projectId: "p1" });
  assert.deepEqual(calls[0], ["create", "orphan", "/code/orphan"]);
  assert.equal(calls[1][1], "/api/project-grants");
  // The grant route rejects any `familiarId` field — only targetFamiliarId is sent.
  assert.deepEqual(calls[1][2], { targetFamiliarId: "sage", projectId: "p1" });
}

// Already-registered root (only the grant is missing) → skip creation, grant the id.
{
  let created = false;
  const createProject = async () => {
    created = true;
    return null;
  };
  let grantBody = null;
  const fetchImpl = async (_url, init) => {
    grantBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const result = await addChatProject({
    root: "/code/known",
    familiarId: "sage",
    createProject,
    existingProjectId: "known-id",
    fetchImpl,
  });
  assert.equal(created, false, "existing project should not be re-created");
  assert.deepEqual(result, { ok: true, projectId: "known-id" });
  assert.deepEqual(grantBody, { targetFamiliarId: "sage", projectId: "known-id" });
}

// No familiar (operator/Supreme view) → register, but issue no grant.
{
  let granted = false;
  const createProject = async (name, root) => ({ id: "p2", name, root });
  const fetchImpl = async () => {
    granted = true;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const result = await addChatProject({ root: "/code/solo", familiarId: null, createProject, fetchImpl });
  assert.deepEqual(result, { ok: true, projectId: "p2" });
  assert.equal(granted, false, "no familiar means nothing to grant");
}

// createProject fails → error, and no grant is attempted.
{
  let granted = false;
  const createProject = async () => null;
  const fetchImpl = async () => {
    granted = true;
    return { ok: true, json: async () => ({}) };
  };
  const result = await addChatProject({ root: "/x", familiarId: "sage", createProject, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(granted, false);
}

// Grant fails → surface the server error.
{
  const createProject = async (name, root) => ({ id: "p3", name, root });
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: "grant changes must be confirmed directly by the human" }),
  });
  const result = await addChatProject({ root: "/y", familiarId: "sage", createProject, fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /confirmed directly/);
}

// Blank root → guarded before any I/O.
{
  let touched = false;
  const result = await addChatProject({
    root: "  ",
    familiarId: "sage",
    createProject: async () => {
      touched = true;
      return { id: "z" };
    },
    fetchImpl: async () => {
      touched = true;
      return { ok: true, json: async () => ({}) };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(touched, false);
}

console.log("chat-add-project.test.ts passed");
