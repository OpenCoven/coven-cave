// @ts-nocheck
import assert from "node:assert/strict";
import { addChatProject, projectNameForRoot } from "./chat-add-project.ts";
import {
  LOCAL_PROJECT_CREATION_MESSAGE,
  LOCAL_REQUEST_REQUIRED_CODE,
  ProjectCreationError,
} from "./project-errors.ts";
import {
  resetProjectRegistryListenersForTests,
  subscribeProjectRegistryMutation,
} from "./project-registry-events.ts";

// projectNameForRoot: the leaf folder is the human name.
assert.equal(projectNameForRoot("/Users/me/code/coven-cave"), "coven-cave");
assert.equal(projectNameForRoot("C:\\Users\\me\\proj"), "proj");
assert.equal(projectNameForRoot("/trailing/slash/"), "slash");
assert.equal(projectNameForRoot(""), "");

// Unregistered root → create the project (auto-named from the leaf) then grant
// it to the active familiar.
{
  resetProjectRegistryListenersForTests();
  let notifications = 0;
  const unsubscribe = subscribeProjectRegistryMutation(() => {
    notifications += 1;
  });
  const calls = [];
  const createProject = async (name, root, options) => {
    calls.push(["create", name, root, options]);
    return { id: "p1", name, root };
  };
  const fetchImpl = async (url, init) => {
    calls.push(["fetch", url, JSON.parse(init.body)]);
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const result = await addChatProject({ root: "/code/orphan", familiarId: "sage", createProject, fetchImpl });
  assert.deepEqual(result, { ok: true, projectId: "p1" });
  assert.equal(calls[0][0], "create");
  assert.equal(calls[0][1], "orphan");
  assert.equal(calls[0][2], "/code/orphan");
  assert.equal(calls[0][3].emitMutation, false);
  assert.equal(typeof calls[0][3].onError, "function");
  assert.equal(calls[1][1], "/api/project-grants");
  // The grant route rejects any `familiarId` field — only targetFamiliarId is sent.
  assert.deepEqual(calls[1][2], { targetFamiliarId: "sage", projectId: "p1" });
  assert.equal(notifications, 1, "successful grant completion emits a post-grant refresh");
  unsubscribe();
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
  resetProjectRegistryListenersForTests();
  let notifications = 0;
  const unsubscribe = subscribeProjectRegistryMutation(() => {
    notifications += 1;
  });
  let granted = false;
  const createProject = async (name, root) => ({ id: "p2", name, root });
  const fetchImpl = async () => {
    granted = true;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const result = await addChatProject({ root: "/code/solo", familiarId: null, createProject, fetchImpl });
  assert.deepEqual(result, { ok: true, projectId: "p2" });
  assert.equal(granted, false, "no familiar means nothing to grant");
  assert.equal(notifications, 1, "no-familiar completion still emits a refresh for unscoped hooks");
  unsubscribe();
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
  assert.deepEqual(result, { ok: false, error: "could not register project" });
  assert.equal(granted, false);
}

// A nullable creator can report the typed server failure without changing its
// null-on-failure return contract; addChatProject must preserve both fields.
{
  let granted = false;
  const result = await addChatProject({
    root: "/remote-only-nullable",
    familiarId: "sage",
    createProject: async (_name, _root, options) => {
      options?.onError?.(new ProjectCreationError(LOCAL_PROJECT_CREATION_MESSAGE, LOCAL_REQUEST_REQUIRED_CODE));
      return null;
    },
    fetchImpl: async () => {
      granted = true;
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  assert.deepEqual(result, {
    ok: false,
    error: LOCAL_PROJECT_CREATION_MESSAGE,
    code: LOCAL_REQUEST_REQUIRED_CODE,
  });
  assert.equal(granted, false);
}

// When both creation paths are available, the throwing variant wins so a
// nullable caller cannot erase a stable local-only failure contract.
{
  let nullableCalled = false;
  let granted = false;
  const result = await addChatProject({
    root: "/remote-only",
    familiarId: "sage",
    createProject: async () => {
      nullableCalled = true;
      return null;
    },
    createProjectOrThrow: async () => {
      throw new ProjectCreationError(LOCAL_PROJECT_CREATION_MESSAGE, LOCAL_REQUEST_REQUIRED_CODE);
    },
    fetchImpl: async () => {
      granted = true;
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  assert.deepEqual(result, {
    ok: false,
    error: LOCAL_PROJECT_CREATION_MESSAGE,
    code: LOCAL_REQUEST_REQUIRED_CODE,
  });
  assert.equal(nullableCalled, false);
  assert.equal(granted, false);
}

// createProject throws a workspace guidance error → surface it, and do not grant.
{
  let granted = false;
  const message = "Choose a folder inside a configured Cave workspace.";
  const createProject = async () => {
    throw new Error(message);
  };
  const fetchImpl = async () => {
    granted = true;
    return { ok: true, json: async () => ({}) };
  };
  const result = await addChatProject({ root: "/x", familiarId: "sage", createProject, fetchImpl });
  assert.deepEqual(result, { ok: false, error: message });
  assert.equal(granted, false);
}

// Grant fails → surface the server error.
{
  resetProjectRegistryListenersForTests();
  let notifications = 0;
  const unsubscribe = subscribeProjectRegistryMutation(() => {
    notifications += 1;
  });
  const createProject = async (name, root) => ({ id: "p3", name, root });
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: "grant changes must be confirmed directly by the human" }),
  });
  const result = await addChatProject({ root: "/y", familiarId: "sage", createProject, fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /confirmed directly/);
  assert.equal(notifications, 1, "failed grants still publish the successful partial project creation");
  unsubscribe();
}

// Transport failure after creation → return an explicit error and publish the
// one needed refresh for the newly-created project.
{
  resetProjectRegistryListenersForTests();
  let notifications = 0;
  const unsubscribe = subscribeProjectRegistryMutation(() => {
    notifications += 1;
  });
  const createProject = async (name, root) => ({ id: "p4", name, root });
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const result = await addChatProject({ root: "/transport-fail", familiarId: "sage", createProject, fetchImpl });
  assert.deepEqual(result, { ok: false, error: "network down" });
  assert.equal(notifications, 1, "rejected grant transport still fans out the created project exactly once");
  unsubscribe();
}

// Caller created the project first (ProjectsView's scoped create path) → a grant
// failure should still publish the new project to unscoped consumers.
{
  resetProjectRegistryListenersForTests();
  let notifications = 0;
  const unsubscribe = subscribeProjectRegistryMutation(() => {
    notifications += 1;
  });
  let created = false;
  const createProject = async () => {
    created = true;
    return null;
  };
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: "grant failed" }),
  });
  const result = await addChatProject({
    root: "/scoped/new-project",
    familiarId: "sage",
    createProject,
    existingProjectId: "known-id",
    projectJustCreated: true,
    fetchImpl,
  });
  assert.equal(created, false, "a caller-owned precreated project should not be re-created");
  assert.equal(result.ok, false);
  assert.equal(notifications, 1, "failed scoped grants still fan out one generic registry refresh for the newly created project");
  unsubscribe();
}

// Create can succeed even when the grant fetch rejects later → surface the
// grant failure as a normal result so callers can keep the created project.
{
  const createProject = async (name, root) => ({ id: "p4", name, root });
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const result = await addChatProject({ root: "/z", familiarId: "sage", createProject, fetchImpl });
  assert.deepEqual(result, { ok: false, error: "network down" });
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
