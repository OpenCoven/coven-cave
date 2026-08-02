import assert from "node:assert/strict";
import test from "node:test";
import {
  isHomeComposerProjectLaunchReady,
  projectsForHomeComposerScope,
  resolveHomeComposerFamiliar,
  resolveHomeComposerProject,
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
