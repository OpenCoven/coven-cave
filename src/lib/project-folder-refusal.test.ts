// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

const { refusedUnconfirmedProjectId } = await import(
  new URL("./project-folder-refusal.ts", import.meta.url).href
);

test("an unconfirmed-folder refusal yields the project the server named", () => {
  assert.equal(
    refusedUnconfirmedProjectId({ ok: false, code: "project_root_unconfirmed", projectId: "N94C2pFgDH", error: "…" }),
    "N94C2pFgDH",
  );
});

test("a moved folder keeps its settings route and yields no project", () => {
  assert.equal(refusedUnconfirmedProjectId({ code: "project_root_moved", projectId: "N94C2pFgDH" }), null);
});

test("a refusal without a usable project id yields none", () => {
  for (const body of [
    null,
    undefined,
    "project_root_unconfirmed",
    { code: "project_root_unconfirmed" },
    { code: "project_root_unconfirmed", projectId: 42 },
    { code: "project_root_unconfirmed", projectId: "   " },
    { code: "project_root_unconfirmed", projectId: "../projects" },
    { code: "project_root_unconfirmed", projectId: "a/b" },
  ]) {
    assert.equal(refusedUnconfirmedProjectId(body), null, JSON.stringify(body));
  }
});
