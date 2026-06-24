// @ts-nocheck
import assert from "node:assert/strict";
import { deriveComuxProjects, projectTint, projectMonogram } from "./comux-projects.ts";
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

// ── projectTint: deterministic, stable, in-gamut ──
{
  assert.equal(
    projectTint("/Users/buns/.coven/workspaces/familiars/nova"),
    projectTint("/Users/buns/.coven/workspaces/familiars/nova"),
    "same root yields the same tint across calls",
  );
  assert.notEqual(
    projectTint("/work/alpha"),
    projectTint("/work/beta"),
    "distinct roots get distinct hues",
  );
  const tint = projectTint("/work/alpha");
  assert.match(tint, /^oklch\(0\.74 0\.12 \d{1,3}\)$/, "tint is a well-formed oklch colour");
  const hue = Number(tint.match(/ (\d{1,3})\)$/)[1]);
  assert.ok(hue >= 0 && hue < 360, "hue stays within [0, 360)");
}

// ── projectMonogram: disambiguates a prefix-heavy family ──
{
  // Multi-segment names take first + last segment initials, so coven-* differ.
  assert.equal(projectMonogram("coven-cave"), "CC");
  assert.equal(projectMonogram("coven-github"), "CG");
  assert.equal(projectMonogram("coven-grimoire"), "CG"); // collisions still possible, that's ok
  assert.equal(projectMonogram("familiars/nova"), "FN");
  // Single-word names fall back to first two letters.
  assert.equal(projectMonogram("charm"), "CH");
  assert.equal(projectMonogram("nova"), "NO");
  // camelCase splits into segments.
  assert.equal(projectMonogram("myCoolApp"), "MA");
  // Symbols stripped; never blank.
  assert.equal(projectMonogram(".config"), "CO");
  assert.equal(projectMonogram("!!!"), "•");
  // Always uppercase, never longer than 2.
  for (const n of ["coven-cave", "charm", "a-b-c-d", "x"]) {
    const m = projectMonogram(n);
    assert.ok(m.length >= 1 && m.length <= 2, `monogram length 1–2 for ${n}`);
    assert.equal(m, m.toUpperCase(), `monogram uppercase for ${n}`);
  }
}

console.log("comux-projects.test.ts: dedup + disambiguation + tint + monogram ok");
