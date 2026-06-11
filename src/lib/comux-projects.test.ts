// @ts-nocheck
import assert from "node:assert/strict";
import { deriveComuxProjects } from "./comux-projects.ts";
import type { SessionRow } from "./types.ts";

function session(
  id: string,
  project_root: string,
  updated_at: string,
  status = "completed",
  familiarId: string | null = null,
): SessionRow {
  return {
    id,
    project_root,
    harness: "codex",
    title: id,
    status,
    exit_code: null,
    archived_at: null,
    created_at: updated_at,
    updated_at,
    familiarId,
    origin: "chat",
  };
}

const projects = deriveComuxProjects(
  [
    session("old", "/work/beta", "2026-06-01T00:00:00.000Z", "completed", "sage"),
    session("new", "/work/alpha", "2026-06-03T00:00:00.000Z", "running", "cody"),
    session("also-alpha", "/work/alpha", "2026-06-02T00:00:00.000Z", "queued", "sage"),
    session("blank", "", "2026-06-04T00:00:00.000Z"),
  ],
  "/workspace/fallback",
);

assert.deepEqual(
  projects.map((project) => ({
    name: project.name,
    root: project.root,
    sessionCount: project.sessionCount,
    runningCount: project.runningCount,
    familiarCount: project.familiarCount,
    latestSessionId: project.latestSessionId,
  })),
  [
    {
      name: "alpha",
      root: "/work/alpha",
      sessionCount: 2,
      runningCount: 2,
      familiarCount: 2,
      latestSessionId: "new",
    },
    {
      name: "beta",
      root: "/work/beta",
      sessionCount: 1,
      runningCount: 0,
      familiarCount: 1,
      latestSessionId: "old",
    },
  ],
);

assert.deepEqual(deriveComuxProjects([], "/workspace/fallback"), [
  {
    name: "fallback",
    root: "/workspace/fallback",
    sessionCount: 0,
    runningCount: 0,
    familiarCount: 0,
    latestSessionId: null,
    updatedAt: null,
  },
]);

// ── Trailing-slash roots bucket as ONE project (was: duplicate rail rows) ──
{
  const merged = deriveComuxProjects([
    session("a", "/work/server", "2026-06-02T00:00:00.000Z"),
    session("b", "/work/server/", "2026-06-03T00:00:00.000Z"),
  ]);
  assert.equal(merged.length, 1, "trailing-slash variant of the same root must not create a second project");
  assert.equal(merged[0].sessionCount, 2, "both sessions land in the merged bucket");
  assert.equal(merged[0].root, "/work/server", "root is stored normalized");
}

// ── Basename collisions get parent/name labels ──
{
  const collided = deriveComuxProjects([
    session("a", "/work/server", "2026-06-02T00:00:00.000Z"),
    session("b", "/infra/server", "2026-06-03T00:00:00.000Z"),
  ]);
  assert.equal(collided.length, 2, "distinct roots stay distinct projects");
  const names = collided.map((p) => p.name).sort();
  assert.deepEqual(names, ["infra/server", "work/server"], "colliding basenames are disambiguated with the parent segment");
}

// ── Unique basenames keep their short label ──
{
  const plain = deriveComuxProjects([
    session("a", "/work/alpha", "2026-06-02T00:00:00.000Z"),
  ]);
  assert.equal(plain[0].name, "alpha", "non-colliding projects keep the bare basename");
}

console.log("comux-projects.test.ts: dedup + disambiguation ok");
