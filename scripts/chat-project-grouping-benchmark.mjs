import { performance } from "node:perf_hooks";
import {
  createChatProjectIndex,
  deriveChatProjectGroups,
  projectForRoot,
} from "../src/lib/chat-projects.ts";

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
}));

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(run) {
  const durations = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    run();
    durations.push(performance.now() - startedAt);
  }
  return Number(median(durations).toFixed(2));
}

const projectIndex = createChatProjectIndex(projects);
const linearLookupMs = measure(() => {
  for (const session of sessions) projectForRoot(session.project_root, projects);
});
const indexedLookupMs = measure(() => {
  for (const session of sessions) projectForRoot(session.project_root, projects, projectIndex);
});
const fullGroupingMs = measure(() => {
  deriveChatProjectGroups(sessions, projects, projectIndex, { sessionsNewestFirst: true });
});

console.log(JSON.stringify({
  fixture: { sessionCount, projectCount, iterations },
  linearLookupP50Ms: linearLookupMs,
  indexedLookupP50Ms: indexedLookupMs,
  indexedFullGroupingP50Ms: fullGroupingMs,
  lookupSpeedup: Number((linearLookupMs / indexedLookupMs).toFixed(1)),
}, null, 2));
