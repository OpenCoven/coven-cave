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
  const route = read("src/app/api/sessions/list/route.ts");
  assert.match(route, /filterProjectsForFamiliar/, "imports the grant filter");
  assert.match(route, /scopeSessionsToFamiliarProjects/, "applies the session scope helper");
  assert.match(route, /searchParams\.get\("familiarId"\)/, "reads the familiarId param");
});

test("useProjects scopes the project list by familiarId", () => {
  const hook = read("src/lib/use-projects.ts");
  assert.match(hook, /familiarId\s*\?\s*`\/api\/projects\?familiarId=/, "passes familiarId to the API");
});

test("chat surface consumers pass the active familiar scope", () => {
  assert.match(read("src/components/chat-list.tsx"), /useProjects\(\{ familiarId: familiar\?\.id/, "chat-list scopes its project rail");
  assert.match(read("src/components/projects-view.tsx"), /useProjects\(\{ familiarId: activeFamiliarId \}\)/, "ProjectsView scopes its project list");
  assert.match(read("src/components/workspace.tsx"), /\/api\/sessions\/list\$\{scope\}/, "workspace scopes the session poll by familiar");
});

test("chat/send still gates project access for the acting familiar", () => {
  const send = read("src/app/api/chat/send/route.ts");
  assert.match(send, /assertProjectAccess\(\{ familiarId: body\.familiarId \}, chatProjectId, "chat"\)/, "chat/send enforces project access");
});
