// @ts-nocheck
import assert from "node:assert/strict";
import {
  aggregateEdges,
  buildDelegationGraph,
  inferDelegationTraces,
  type CovenCall,
} from "./coven-calls-types.ts";

const calls: CovenCall[] = [
  {
    id: "call-1",
    callerFamiliarId: "nova",
    calleeFamiliarId: "cody",
    request: "first request",
    status: "completed",
    createdAt: "2026-06-06T01:00:00.000Z",
  },
  {
    id: "call-2",
    callerFamiliarId: "nova",
    calleeFamiliarId: "cody",
    request: "latest request",
    status: "running",
    createdAt: "2026-06-06T01:05:00.000Z",
  },
  {
    id: "call-3",
    callerFamiliarId: "cody",
    calleeFamiliarId: "nova",
    request: "reverse request",
    status: "failed",
    createdAt: "2026-06-06T01:03:00.000Z",
  },
];

assert.deepEqual(aggregateEdges(calls), [
  {
    caller: "nova",
    callee: "cody",
    count: 2,
    mostRecentRequest: "latest request",
    hasRunning: true,
  },
  {
    caller: "cody",
    callee: "nova",
    count: 1,
    mostRecentRequest: "reverse request",
    hasRunning: false,
  },
]);

const inferred = inferDelegationTraces({
  cards: [
    {
      id: "card-1",
      title: "Research delegation graph UX",
      status: "running",
      lifecycle: "running",
      familiarId: "sage",
      sessionId: "session-cody",
      createdAt: "2026-06-06T01:10:00.000Z",
      updatedAt: "2026-06-06T01:12:00.000Z",
    },
    {
      id: "card-same-owner",
      title: "Same familiar owns session and card",
      status: "running",
      lifecycle: "running",
      familiarId: "cody",
      sessionId: "session-cody",
      createdAt: "2026-06-06T01:11:00.000Z",
      updatedAt: "2026-06-06T01:13:00.000Z",
    },
  ],
  sessions: [
    {
      id: "session-cody",
      familiarId: "cody",
      title: "Cody working session",
      status: "running",
      created_at: "2026-06-06T01:09:00.000Z",
      updated_at: "2026-06-06T01:14:00.000Z",
    },
    {
      id: "session-cody-from-charm",
      familiarId: "cody",
      title: "Charm asked Cody to inspect Cave traces",
      status: "running",
      created_at: "2026-06-06T01:20:00.000Z",
      updated_at: "2026-06-06T01:24:00.000Z",
      initiator: { kind: "familiar", label: "Charm", agentId: "charm" },
    },
    {
      id: "session-self-start",
      familiarId: "cody",
      title: "Cody started its own chat",
      status: "running",
      created_at: "2026-06-06T01:21:00.000Z",
      updated_at: "2026-06-06T01:25:00.000Z",
      initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
    },
  ],
});

assert.equal(inferred.length, 2);
assert.deepEqual(
  {
    source: inferred[1].source,
    callerFamiliarId: inferred[1].callerFamiliarId,
    calleeFamiliarId: inferred[1].calleeFamiliarId,
    linkedCardId: inferred[1].linkedCardId,
    status: inferred[1].status,
  },
  {
    source: "inferred",
    callerFamiliarId: "cody",
    calleeFamiliarId: "sage",
    linkedCardId: "card-1",
    status: "running",
  },
);
assert.deepEqual(
  {
    source: inferred[0].source,
    callerFamiliarId: inferred[0].callerFamiliarId,
    calleeFamiliarId: inferred[0].calleeFamiliarId,
    sessionId: inferred[0].sessionId,
    status: inferred[0].status,
  },
  {
    source: "inferred",
    callerFamiliarId: "charm",
    calleeFamiliarId: "cody",
    sessionId: "session-cody-from-charm",
    status: "running",
  },
);
assert.equal(
  inferred.some((trace) => trace.sessionId === "session-self-start"),
  false,
  "sessions started by their own familiar should not become delegation traces",
);

const graph = buildDelegationGraph({
  explicitCalls: calls,
  inferredTraces: inferred,
  includeInferred: true,
});

assert.deepEqual(
  graph.edges.map((edge) => ({
    caller: edge.caller,
    callee: edge.callee,
    source: edge.source,
    explicitCount: edge.explicitCount,
    inferredCount: edge.inferredCount,
    count: edge.count,
    hasRunning: edge.hasRunning,
  })),
  [
    {
      caller: "nova",
      callee: "cody",
      source: "explicit",
      explicitCount: 2,
      inferredCount: 0,
      count: 2,
      hasRunning: true,
    },
    {
      caller: "charm",
      callee: "cody",
      source: "inferred",
      explicitCount: 0,
      inferredCount: 1,
      count: 1,
      hasRunning: true,
    },
    {
      caller: "cody",
      callee: "sage",
      source: "inferred",
      explicitCount: 0,
      inferredCount: 1,
      count: 1,
      hasRunning: true,
    },
    {
      caller: "cody",
      callee: "nova",
      source: "explicit",
      explicitCount: 1,
      inferredCount: 0,
      count: 1,
      hasRunning: false,
    },
  ],
);

assert.equal(
  buildDelegationGraph({
    explicitCalls: calls,
    inferredTraces: inferred,
    includeInferred: false,
  }).edges.some((edge) => edge.source === "inferred"),
  false,
);
