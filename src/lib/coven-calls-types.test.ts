// @ts-nocheck
import assert from "node:assert/strict";
import { aggregateEdges, type CovenCall } from "./coven-calls-types.ts";

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
