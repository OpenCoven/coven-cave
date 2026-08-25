import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  createChatProjectIndex,
  deriveChatProjectGroups,
  projectForRoot,
} from "../src/lib/chat-projects.ts";
import { deriveChatListProjectGroups } from "../src/lib/chat-list-grouping.ts";

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }
  return value;
}

const sessionCount = positiveInteger("CAVE_BENCH_CHAT_SESSIONS", 10_000);
const projectCount = positiveInteger("CAVE_BENCH_CHAT_PROJECTS", 1_000);
const iterations = positiveInteger("CAVE_BENCH_ITERATIONS", 7);

const projects = Array.from({ length: projectCount }, (_, index) => ({
  id: `project-${index}`,
  name: `Project ${index}`,
  root: `/work/project-${index}`,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
}));
const sessions = Array.from({ length: sessionCount }, (_, index) => ({
  id: `session-${index}`,
  project_root: index % 8 === 0 ? `/unregistered/${index}` : projects[index % projectCount].root,
  harness: "codex",
  title: `Session ${index}`,
  status: "completed",
  exit_code: null,
  archived_at: null,
  created_at: new Date(Date.UTC(2026, 7, 24, 0, 0, index % 60)).toISOString(),
  updated_at: new Date(Date.UTC(2026, 7, 24, 0, 0, index % 60)).toISOString(),
  familiarId: "nova",
  origin: "chat",
})).sort((a, b) => (
  b.updated_at.localeCompare(a.updated_at)
  || a.id.localeCompare(b.id, undefined, { numeric: true })
));

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(run) {
  const durations = [];
  let checksum = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    checksum ^= run();
    durations.push(performance.now() - startedAt);
  }
  assert.ok(Number.isInteger(checksum), "benchmark result must be consumed");
  return Number(median(durations).toFixed(2));
}

const projectIndex = createChatProjectIndex(projects);
const linearProjectIndex = {
  byId: { get: (id) => projects.find((project) => project.id === id) ?? null },
  byRoot: { get: (root) => projectForRoot(root, projects) },
};
const groupChecksum = (groups) => groups.reduce(
  (total, group) => total + group.sessions.length + (group.projectRoot?.length ?? 0),
  0,
);
const baselineGroups = deriveChatProjectGroups(
  sessions,
  projects,
  linearProjectIndex,
  { sessionsNewestFirst: true },
);
const indexedGroups = deriveChatProjectGroups(
  sessions,
  projects,
  projectIndex,
  { sessionsNewestFirst: true },
);
assert.deepEqual(indexedGroups, baselineGroups, "indexed grouping must preserve baseline output");
assert.equal(
  indexedGroups.reduce((total, group) => total + group.sessions.length, 0),
  sessionCount,
  "grouping must retain every fixture session",
);
for (const group of indexedGroups) {
  for (let index = 1; index < group.sessions.length; index += 1) {
    assert.ok(
      group.sessions[index - 1].updated_at >= group.sessions[index].updated_at,
      "sessionsNewestFirst fixture must satisfy the fast-path precondition",
    );
  }
}
const linearLookupMs = measure(() => {
  let found = 0;
  for (const session of sessions) {
    if (projectForRoot(session.project_root, projects)) found += 1;
  }
  return found;
});
const indexedLookupMs = measure(() => {
  let found = 0;
  for (const session of sessions) {
    if (projectForRoot(session.project_root, projects, projectIndex)) found += 1;
  }
  return found;
});
const linearFullGroupingMs = measure(() => groupChecksum(
  deriveChatProjectGroups(sessions, projects, linearProjectIndex, { sessionsNewestFirst: true }),
));
const indexedFullGroupingMs = measure(() => groupChecksum(
  deriveChatProjectGroups(sessions, projects, projectIndex, { sessionsNewestFirst: true }),
));
const sharedResult = deriveChatListProjectGroups(
  sessions,
  sessions,
  projects,
  projectIndex,
  {},
);
assert.equal(
  sharedResult.sidebarGroups,
  sharedResult.grouped,
  "the default chat list must reuse one project-grouping result",
);
const doubleGroupingMs = measure(() => {
  const main = deriveChatProjectGroups(
    sessions,
    projects,
    projectIndex,
    { sessionsNewestFirst: true },
  );
  const rail = deriveChatProjectGroups(
    sessions,
    projects,
    projectIndex,
    { sessionsNewestFirst: true },
  );
  return groupChecksum(main) + groupChecksum(rail);
});
const sharedGroupingMs = measure(() => {
  const { grouped, sidebarGroups } = deriveChatListProjectGroups(
    sessions,
    sessions,
    projects,
    projectIndex,
    {},
  );
  return groupChecksum(grouped) + groupChecksum(sidebarGroups);
});

console.log(JSON.stringify({
  fixture: { sessionCount, projectCount, iterations },
  linearLookupP50Ms: linearLookupMs,
  indexedLookupP50Ms: indexedLookupMs,
  linearFullGroupingP50Ms: linearFullGroupingMs,
  indexedFullGroupingP50Ms: indexedFullGroupingMs,
  doubleGroupingP50Ms: doubleGroupingMs,
  sharedGroupingP50Ms: sharedGroupingMs,
  lookupSpeedup: Number((linearLookupMs / indexedLookupMs).toFixed(1)),
  fullGroupingSpeedup: Number((linearFullGroupingMs / indexedFullGroupingMs).toFixed(1)),
  sharedGroupingSpeedup: Number((doubleGroupingMs / sharedGroupingMs).toFixed(1)),
}, null, 2));
