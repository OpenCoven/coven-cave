import assert from "node:assert/strict";
import test from "node:test";
import { resolveHomeComposerFamiliar, resolveHomeComposerProject } from "./home-composer-context.ts";

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
  assert.equal(resolveHomeComposerProject(projects, "missing", "__no-project__")?.id, "one");
  assert.equal(resolveHomeComposerProject(projects, "__no-project__", "__no-project__"), null);
});
