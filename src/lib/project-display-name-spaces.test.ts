// @ts-nocheck
// Regression coverage for cave-8e7q: a project display name containing spaces
// must survive registration, picker selection, and chat root resolution.
//
// Nothing here is a new guarantee — spaces already survive, but only because no
// code along the path happens to transform the name. Identity is id + root and
// the name is presentation text, so a future slugify/tokenize/encode step could
// silently turn `My Project Two` into an identifier again and every existing
// test would still pass. These pins make that regression fail loudly instead.
//
// Deliberately a spaced NAME over an ordinary ROOT: spaced paths are a separate
// concern already covered by project-root-normalizers.test.ts ("/w/app with
// spaces"), and mixing the two would hide which one broke.
import assert from "node:assert/strict";

import { addChatProject, projectNameForRoot } from "./chat-add-project.ts";
import { chatProjectById, projectIdForRoot, resolveChatProjectSelection } from "./chat-projects.ts";
import { resetProjectRegistryListenersForTests } from "./project-registry-events.ts";

const SPACED_NAME = "My Project Two";
const ROOT = "/w/app";

// Registration: the name reaches createProject exactly as typed.
{
  resetProjectRegistryListenersForTests();
  const calls = [];
  const createProject = async (name, root, options) => {
    calls.push(["create", name, root, options]);
    return { id: "p-spaced", name, root };
  };
  const fetchImpl = async (url, init) => {
    calls.push(["fetch", url, JSON.parse(init.body)]);
    return { ok: true, json: async () => ({ ok: true }) };
  };

  const result = await addChatProject({
    root: ROOT,
    name: SPACED_NAME,
    familiarId: "sage",
    createProject,
    fetchImpl,
  });

  assert.deepEqual(result, { ok: true, projectId: "p-spaced" });
  assert.deepEqual(
    calls[0],
    ["create", SPACED_NAME, ROOT, { emitMutation: false }],
    "the spaced display name is registered verbatim — not split, slugified, or encoded",
  );
  // The grant travels by id. A display name appearing in this payload would
  // make it a de-facto connection identifier, which is the bug this bead is about.
  assert.deepEqual(calls[1][2], { targetFamiliarId: "sage", projectId: "p-spaced" });
  assert.doesNotMatch(
    JSON.stringify(calls[1][2]),
    /My Project Two/,
    "the grant identifies the project by id, never by display name",
  );
}

// A root whose leaf folder contains spaces keeps them in the derived name.
assert.equal(projectNameForRoot("/w/My App With Spaces"), "My App With Spaces");

// Picker selection and chat root resolution both key off id, and hand back the
// unchanged root for a project whose name has spaces.
{
  const projects = [
    { id: "p-spaced", name: SPACED_NAME, root: ROOT },
    { id: "p-other", name: "Other", root: "/w/other" },
  ];

  assert.equal(chatProjectById("p-spaced", projects)?.root, ROOT);
  assert.equal(chatProjectById("p-spaced", projects)?.name, SPACED_NAME);
  assert.equal(projectIdForRoot(ROOT, projects), "p-spaced");

  // The picker emits an id; chat resolves that id back to the canonical root.
  const selection = resolveChatProjectSelection({
    draftId: "p-spaced",
    hasSession: false,
    sessionProjectRoot: null,
    fallbackProjectRoot: null,
    projects,
  });
  assert.equal(selection.projectId, "p-spaced");
  assert.equal(selection.project?.root, ROOT, "chat resolves the selection to the unchanged root");
  assert.equal(selection.project?.name, SPACED_NAME);
}

// A failed registration surfaces the API's own error and issues no grant.
{
  resetProjectRegistryListenersForTests();
  let granted = false;
  const createProject = async () => {
    throw new Error("project root is outside the allowed workspace");
  };
  const fetchImpl = async () => {
    granted = true;
    return { ok: true, json: async () => ({ ok: true }) };
  };

  const result = await addChatProject({
    root: ROOT,
    name: SPACED_NAME,
    familiarId: "sage",
    createProject,
    fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.error,
    "project root is outside the allowed workspace",
    "the specific API error reaches the caller instead of a generic 'could not register project'",
  );
  assert.equal(granted, false, "registration failure must not go on to attempt a grant");
}
