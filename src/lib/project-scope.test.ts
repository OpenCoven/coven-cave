import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isCurrentProjectScope,
  isProjectPickerReady,
  projectScopeKey,
  projectsForCurrentScope,
} from "./project-scope.ts";

test("a completed project response becomes unavailable immediately when familiar scope changes", () => {
  const globalResult = projectScopeKey(null);
  const familiarAResult = projectScopeKey("familiar-a");

  assert.equal(isCurrentProjectScope(globalResult, null), true, "the unscoped result is usable for an unscoped picker");
  assert.equal(isCurrentProjectScope(globalResult, "familiar-a"), false, "a familiar must not see the retained global result");
  assert.equal(isCurrentProjectScope(familiarAResult, "familiar-a"), true, "the matching familiar may use its completed result");
  assert.equal(isCurrentProjectScope(familiarAResult, "familiar-b"), false, "a second familiar must not see familiar A's retained result");
});

test("pending or failed scoped loads never become ready", () => {
  assert.equal(isCurrentProjectScope(null, "familiar-a"), false, "a pending scope has no successful result");
  assert.equal(isCurrentProjectScope(null, null), false, "a failed unscoped request has no successful result");
});

test("a prior familiar's projects are synchronously masked before effects run", () => {
  const familiarAProjects = ["only-familiar-a"];
  const familiarAScope = projectScopeKey("familiar-a");

  // This models the transition render: React still holds A's useState array,
  // but props have already changed to B and useEffect has not run yet.
  assert.deepEqual(
    projectsForCurrentScope(familiarAProjects, familiarAScope, "familiar-b"),
    [],
    "familiar B cannot render familiar A's retained project option",
  );
  assert.deepEqual(
    projectsForCurrentScope(["global-project"], projectScopeKey(null), "familiar-b"),
    [],
    "a familiar cannot render a retained global project option",
  );
  assert.deepEqual(
    projectsForCurrentScope(familiarAProjects, familiarAScope, "familiar-a"),
    familiarAProjects,
    "the matching familiar keeps its completed project options",
  );
  assert.deepEqual(
    projectsForCurrentScope(familiarAProjects, null, "familiar-b"),
    [],
    "a failed familiar B request keeps prior options hidden",
  );
});

test("a reopened modal keeps its previous familiar's result unavailable until new defaults load", () => {
  assert.equal(
    isProjectPickerReady({ opening: true, loadedSuccessfully: true, loading: false }),
    false,
    "reopening must not expose familiar A's retained result before default familiar B applies",
  );
  assert.equal(
    isProjectPickerReady({ opening: false, loadedSuccessfully: false, loading: true }),
    false,
    "familiar B stays unavailable while its request is pending",
  );
  assert.equal(
    isProjectPickerReady({ opening: false, loadedSuccessfully: false, loading: false }),
    false,
    "a failed familiar B request stays unavailable",
  );
  assert.equal(
    isProjectPickerReady({ opening: false, loadedSuccessfully: true, loading: false }),
    true,
    "only familiar B's completed result enables the picker",
  );
});
