import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { scopeSessionsToFamiliarProjects } from "@/lib/session-project-scope";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { SessionRow } from "@/lib/types";

const proj = (id: string, root: string): CaveProject => ({
  id,
  name: id,
  root,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const session = (id: string, root: string): SessionRow =>
  ({ id, project_root: root } as SessionRow);

const all = [proj("a", "/work/alpha"), proj("b", "/work/beta")];

test("keeps sessions in a permitted project", () => {
  const out = scopeSessionsToFamiliarProjects([session("s1", "/work/alpha")], all, [all[0]]);
  assert.deepEqual(out.map((s) => s.id), ["s1"]);
});

test("drops sessions in a known but forbidden project", () => {
  const out = scopeSessionsToFamiliarProjects([session("s2", "/work/beta")], all, [all[0]]);
  assert.deepEqual(out, []);
});

test("keeps sessions whose root maps to no known project (the '(no project)' bucket)", () => {
  const out = scopeSessionsToFamiliarProjects([session("s3", "/tmp/scratch")], all, [all[0]]);
  assert.deepEqual(out.map((s) => s.id), ["s3"]);
});

test("keeps rootless sessions", () => {
  const out = scopeSessionsToFamiliarProjects([session("s4", "")], all, []);
  assert.deepEqual(out.map((s) => s.id), ["s4"]);
});

test("supreme familiar (all projects permitted) drops nothing", () => {
  const sessions = [session("s1", "/work/alpha"), session("s2", "/work/beta")];
  const out = scopeSessionsToFamiliarProjects(sessions, all, all);
  assert.deepEqual(out.map((s) => s.id), ["s1", "s2"]);
});

test("matches roots regardless of trailing slash / separator", () => {
  const out = scopeSessionsToFamiliarProjects([session("s5", "/work/alpha/")], all, [all[0]]);
  assert.deepEqual(out.map((s) => s.id), ["s5"]);
});

// ── Wiring assertions (source-level) ────────────────────────────────────────
const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

test("the sessions/list route scopes by familiar grants", () => {
  // The scoping moved into the shared compute (cave-9rwd.1); the route still
  // parses the parameter that drives it, so each half is read where it lives.
  const route = read("src/app/api/sessions/list/route.ts");
  const compute = read("src/lib/server/sessions-list.ts");
  assert.match(compute, /filterProjectsForFamiliar/, "imports the grant filter");
  assert.match(compute, /scopeSessionsToFamiliarProjects/, "applies the session scope helper");
  // Naming the helper is not the same as reaching it. Before cave-9rwd.1 this
  // assertion read the route, where `scopeForFamiliar`'s own body mentions the
  // helper — so deleting the CALL left the string in place and the test green.
  // Pin the call site too.
  assert.match(
    compute,
    /const scoped = await scopeForFamiliar\(sessions, projects, familiarId\)/,
    "the compute actually applies the familiar scope to the merged rows",
  );
  assert.match(route, /searchParams\.get\("familiarId"\)/, "reads the familiarId param");
  assert.match(
    route,
    /computeSessionsList\(includeArchived, familiarId, collapseFamiliarWorkspace\)/,
    "threads the parsed familiar id into the scoped compute",
  );
});

test("useProjects scopes the project list by familiarId", () => {
  const hook = read("src/lib/use-projects.ts");
  const cache = read("src/lib/use-projects-cache.ts");
  assert.match(hook, /fetchProjectsFromCache\(familiarId, opts\)/, "the hook delegates loads to the shared scoped cache helper");
  assert.match(cache, /familiarId\s*\?\s*`\/api\/projects\?familiarId=/, "the shared cache helper passes familiarId to the API");
});

test("chat surface consumers pass the active familiar scope", () => {
  assert.match(read("src/components/chat-list.tsx"), /useProjects\(\{ familiarId: familiar\?\.id/, "chat-list scopes its project rail");
  // The Projects surface is the access console: it deliberately loads
  // UNSCOPED so every registered project is visible to grant or revoke.
  assert.match(
    read("src/components/projects-view.tsx"),
    /useProjects\(\)/,
    "ProjectsView loads unscoped — it manages the grants themselves",
  );
  assert.match(read("src/components/workspace.tsx"), /\/api\/sessions\/list\$\{scope\}/, "workspace scopes the session poll by familiar");
});

test("chat/send still gates project access for the acting familiar", () => {
  const send = read("src/app/api/chat/send/route.ts");
  assert.match(send, /authorizeChatProjectLaunch/, "chat/send uses the shared project launch gate");
  assert.match(
    send,
    /assertProjectAccess\(\{ familiarId: requestedFamiliarId \}, projectId, surface\)/,
    "chat/send enforces the gate's selected familiar and permission surface",
  );
});
