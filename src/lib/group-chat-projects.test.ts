// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

import { intersectAccessibleProjects } from "./group-chat-projects.ts";

const project = (id, access, root = `/repo/${id}`) => ({
  id,
  name: id.toUpperCase(),
  root,
  access,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

test("returns only projects every familiar can access", () => {
  assert.deepEqual(
    intersectAccessibleProjects([
      [project("alpha", "write"), project("shared", "write")],
      [project("shared", "write"), project("beta", "read")],
    ]).map((entry) => entry.id),
    ["shared"],
  );
});

test("reports the least access level shared across the group", () => {
  const [shared] = intersectAccessibleProjects([
    [project("shared", "write")],
    [project("shared", "read")],
    [project("shared", "write")],
  ]);
  assert.equal(shared.access, "read");
});

test("omits unverified rows and returns no choices without participants", () => {
  assert.deepEqual(
    intersectAccessibleProjects([
      [project("shared", "write")],
      [{ ...project("shared", "write"), access: undefined }],
    ]),
    [],
  );
  assert.deepEqual(intersectAccessibleProjects([]), []);
});
