import assert from "node:assert/strict";
import test from "node:test";
import {
  homeComposerProjectLaunchMessage,
  isHomeComposerProjectLaunchReady,
  projectsForHomeComposerScope,
  resolveHomeComposerFamiliar,
  resolveHomeComposerProject,
  shouldClearHomeComposerProjectSelection,
} from "./home-composer-context.ts";

test("home composer shows the unscoped registry, then filters to familiar access", () => {
  const projects = [
    { id: "open", name: "Open", root: "/work/open", access: undefined },
    { id: "readable", name: "Readable", root: "/work/readable", access: "read" },
  ] as never[];
  assert.deepEqual(
    projectsForHomeComposerScope(projects, null).map((project) => project.id),
    ["open", "readable"],
    "initial setup must retain every locally registered project",
  );
  assert.deepEqual(
    projectsForHomeComposerScope(projects, "sage").map((project) => project.id),
    ["readable"],
    "a familiar scope must retain only projects with server-derived access",
  );
});

test("home composer never treats project access as launch permission without a familiar", () => {
  const selectedProject = { root: "/work/readable", access: "read" } as never;
  const readyArgs = {
    projectsLoadedSuccessfully: true,
    projectsLoading: false,
    projectsError: null,
    selectedProject,
  };
  assert.equal(
    isHomeComposerProjectLaunchReady({ ...readyArgs, familiarId: null }),
    false,
    "chat launch must remain blocked before familiar setup even if a stale access field is present",
  );
  assert.equal(
    isHomeComposerProjectLaunchReady({ ...readyArgs, familiarId: "sage" }),
    true,
    "a loaded project with familiar access is launchable",
  );
});

test("home composer explains the familiar prerequisite while projects are loading", () => {
  assert.equal(
    homeComposerProjectLaunchMessage({
      familiarId: null,
      projectsLoading: true,
      projectsError: null,
      projectsLoadedSuccessfully: false,
      projectCount: 0,
    }),
    "Summon a familiar before starting chat.",
  );
  assert.equal(
    homeComposerProjectLaunchMessage({
      familiarId: "sage",
      projectsLoading: false,
      projectsError: null,
      projectsLoadedSuccessfully: true,
      projectCount: 0,
    }),
    "Add a project this familiar can access before starting chat.",
  );
});

test("home composer keeps an explicit project through a pending familiar scope", () => {
  const project = { id: "selected", name: "Selected", root: "/work/selected" } as never;
  assert.equal(
    shouldClearHomeComposerProjectSelection([], "selected", false),
    false,
    "the masked list during a scope request is not proof that the selected project disappeared",
  );
  assert.equal(
    shouldClearHomeComposerProjectSelection([project], "selected", true),
    false,
    "an accessible selected project remains selected after the scoped response",
  );
  assert.equal(
    shouldClearHomeComposerProjectSelection([], "selected", true),
    true,
    "an explicitly selected project is cleared once the settled scope excludes it",
  );
});

test("home composer excludes archived familiars and falls back from an archived active familiar", () => {
  const familiars = [
    { id: "archived", display_name: "Archived" },
    { id: "live", display_name: "Live" },
  ] as never[];
  const resolved = resolveHomeComposerFamiliar(familiars, "archived", { archived: true });
  assert.deepEqual(resolved.visibleFamiliars.map((familiar) => familiar.id), ["live"]);
  assert.equal(resolved.selectedFamiliarId, "live");
  assert.equal(resolveHomeComposerFamiliar(familiars, "live", {}).selectedFamiliar?.id, "live");
});

test("home composer project selection honors no-project and stable fallback", () => {
  const projects = [{ id: "one", name: "One" }, { id: "two", name: "Two" }] as never[];
  assert.equal(resolveHomeComposerProject(projects, "two", "__no-project__")?.id, "two");
  assert.equal(
    resolveHomeComposerProject(projects, "missing", "__no-project__"),
    null,
    "a stale explicit id never silently substitutes another project",
  );
  assert.equal(resolveHomeComposerProject(projects, "__no-project__", "__no-project__"), null);
});

test("home composer defaults an unset pick to the most recent chat's project", () => {
  const projects = [
    { id: "one", name: "One", root: "/work/one" },
    { id: "two", name: "Two", root: "/work/two" },
  ] as never[];
  assert.equal(
    resolveHomeComposerProject(projects, "", "__no-project__", "/work/two")?.id,
    "two",
    "an unset pick resolves to the recent chat's project before projects[0]",
  );
  assert.equal(
    resolveHomeComposerProject(projects, "one", "__no-project__", "/work/two")?.id,
    "one",
    "an explicit pick beats the recency default",
  );
  assert.equal(
    resolveHomeComposerProject(projects, "__no-project__", "__no-project__", "/work/two"),
    null,
    "an explicit No-project pick beats the recency default",
  );
  assert.equal(
    resolveHomeComposerProject(projects, "", "__no-project__", "/somewhere/unregistered")?.id,
    "one",
    "an unregistered recent root falls through to projects[0]",
  );
  assert.equal(
    resolveHomeComposerProject(projects, "", "__no-project__", null)?.id,
    "one",
    "no recency signal keeps the stable projects[0] fallback",
  );
});
