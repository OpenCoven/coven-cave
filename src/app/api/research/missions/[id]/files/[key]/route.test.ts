import assert from "node:assert/strict";
import test from "node:test";

import type { ResearchMission } from "@/lib/research-missions";
import { createResearchMissionFileRouteHandlers } from "./route.ts";

const SOURCE = {
  id: "manual-primary",
  title: "Primary source",
  url: "https://example.com/source",
  sourceType: "web",
  status: "used",
} as const;

function mission(): ResearchMission {
  return {
    version: 1,
    id: "mission-1",
    familiarId: "sage",
    title: "Mission",
    intent: "Investigate the evidence",
    mode: "brief",
    modeSource: "user",
    deliverable: "Findings",
    constraints: [],
    bounds: {
      wallClockMinutes: 30,
      maxIterations: 3,
      sourceTarget: 5,
      checkpointEvery: 1,
      stopWhenCostUnavailable: true,
    },
    status: "completed",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T01:00:00.000Z",
    iterations: [{ number: 1, status: "completed" }],
    artifacts: [{
      key: "findings",
      kind: "findings",
      title: "Findings",
      relativePath: "findings.md",
      iteration: 1,
      state: "working",
      updatedAt: "2026-08-29T01:00:00.000Z",
    }],
    sources: [{ ...SOURCE }],
  };
}

function localRequest(): Request {
  return new Request(
    "http://localhost:3000/api/research/missions/mission-1/files/findings",
    { headers: { host: "localhost" } },
  );
}

function context() {
  return { params: Promise.resolve({ id: "mission-1", key: "findings" }) };
}

test("artifact response carries the independently validated current source ledger", async () => {
  const reads: string[] = [];
  const { GET } = createResearchMissionFileRouteHandlers({
    loadMission: async () => mission(),
    readFile: async (_id, relativePath) => {
      reads.push(relativePath);
      if (relativePath === "findings.md") return "# Findings";
      if (relativePath === "sources.json") return JSON.stringify([SOURCE]);
      throw new Error(`unexpected path ${relativePath}`);
    },
    workspacePath: () => "/workspace/mission-1",
  });

  const response = await GET(localRequest(), context());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(reads, ["findings.md", "sources.json"]);
  assert.deepEqual(body.file.sourceLedger, {
    state: "available",
    sources: [SOURCE],
  });
});

test("a valid empty source ledger is distinct from a failed source ledger", async () => {
  const { GET } = createResearchMissionFileRouteHandlers({
    loadMission: async () => mission(),
    readFile: async (_id, relativePath) =>
      relativePath === "findings.md" ? "# Findings" : "[]",
    workspacePath: () => "/workspace/mission-1",
  });

  const response = await GET(localRequest(), context());
  const body = await response.json();
  assert.deepEqual(body.file.sourceLedger, { state: "empty", sources: [] });
});

test("missing, unreadable, and malformed ledgers fail closed without stale sources or raw errors", async () => {
  const cases = [
    async () => {
      const error = new Error("missing sources.json") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    },
    async () => {
      const error = new Error("permission denied: /secret/path") as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    },
    async () => "{not-json",
    async () => JSON.stringify([{
      id: "invalid-source",
      title: "Missing URL or local path",
      sourceType: "web",
      status: "used",
    }]),
  ];

  for (const readLedger of cases) {
    const { GET } = createResearchMissionFileRouteHandlers({
      loadMission: async () => mission(),
      readFile: async (_id, relativePath) =>
        relativePath === "findings.md" ? "# Findings" : readLedger(),
      workspacePath: () => "/workspace/mission-1",
    });

    const response = await GET(localRequest(), context());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.file.sourceLedger, {
      state: "failed",
      sources: [],
    });
    assert.doesNotMatch(JSON.stringify(body), /permission denied|secret\/path/);
  }
});
