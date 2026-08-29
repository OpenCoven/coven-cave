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

function mission(sources: ResearchMission["sources"] = [{ ...SOURCE }]): ResearchMission {
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
    sources,
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

test("a valid empty source ledger preserves a mission-only manual attachment", async () => {
  const { GET } = createResearchMissionFileRouteHandlers({
    loadMission: async () => mission(),
    readFile: async (_id, relativePath) =>
      relativePath === "findings.md" ? "# Findings" : "[]",
    workspacePath: () => "/workspace/mission-1",
  });

  const response = await GET(localRequest(), context());
  const body = await response.json();
  assert.deepEqual(body.file.sourceLedger, {
    state: "available",
    sources: [SOURCE],
  });
});

test("persisted mission edits win over stale file fields without losing file or provider fields", async () => {
  const persisted = {
    ...SOURCE,
    id: "manual-current",
    title: "Current user title",
    publisher: "Mission publisher",
    note: "Current user note",
    status: "used" as const,
    provider: "x" as const,
    externalId: "post-1",
    availability: "available" as const,
  };
  const staleFileSource = {
    id: "runner-stale",
    title: "Stale runner title",
    url: SOURCE.url,
    publishedAt: "2026-08-01",
    sourceType: "journal",
    note: "Stale runner note",
    status: "candidate",
  };
  const { GET } = createResearchMissionFileRouteHandlers({
    loadMission: async () => mission([persisted]),
    readFile: async (_id, relativePath) =>
      relativePath === "findings.md"
        ? "# Findings"
        : JSON.stringify([staleFileSource]),
    workspacePath: () => "/workspace/mission-1",
  });

  const response = await GET(localRequest(), context());
  const body = await response.json();
  assert.deepEqual(body.file.sourceLedger, {
    state: "available",
    sources: [{
      ...staleFileSource,
      ...persisted,
      publishedAt: "2026-08-01",
    }],
  });
});

test("valid ledgers keep mission order before unmatched file-only additions", async () => {
  const missionSources = [
    { ...SOURCE, id: "mission-first", title: "Mission first" },
    {
      id: "mission-second",
      title: "Mission second",
      localPath: "/workspace/manual.pdf",
      sourceType: "file",
      status: "candidate" as const,
    },
  ];
  const fileOnly = {
    id: "file-only",
    title: "Runner addition",
    url: "https://example.com/file-only",
    sourceType: "web",
    status: "candidate",
  };
  const { GET } = createResearchMissionFileRouteHandlers({
    loadMission: async () => mission(missionSources),
    readFile: async (_id, relativePath) =>
      relativePath === "findings.md"
        ? "# Findings"
        : JSON.stringify([
          { ...missionSources[1], title: "Stale second" },
          fileOnly,
          { ...missionSources[0], title: "Stale first" },
        ]),
    workspacePath: () => "/workspace/mission-1",
  });

  const response = await GET(localRequest(), context());
  const body = await response.json();
  assert.deepEqual(body.file.sourceLedger, {
    state: "available",
    sources: [...missionSources, fileOnly],
  });
});

test("ambiguous source identities fail closed without exposing source content", async () => {
  const cases: Array<{
    name: string;
    missionSources: ResearchMission["sources"];
    fileSources: ResearchMission["sources"];
  }> = [
    {
      name: "URL merge would duplicate the mission id",
      missionSources: [{
        ...SOURCE,
        id: "manual-current",
        title: "sensitive mission title",
      }],
      fileSources: [
        {
          ...SOURCE,
          id: "runner-stale",
          title: "sensitive stale title",
        },
        {
          ...SOURCE,
          id: "manual-current",
          title: "sensitive duplicate title",
          url: "https://example.com/other",
        },
      ],
    },
    {
      name: "file rows duplicate an id",
      missionSources: [],
      fileSources: [
        {
          ...SOURCE,
          id: "duplicate-file-id",
          title: "sensitive duplicate one",
          url: "https://example.com/first",
        },
        {
          ...SOURCE,
          id: "duplicate-file-id",
          title: "sensitive duplicate two",
          url: "https://example.com/second",
        },
      ],
    },
    {
      name: "one mission row bridges distinct URL and path rows",
      missionSources: [{
        ...SOURCE,
        id: "mission-bridge",
        title: "sensitive bridge title",
        localPath: "/workspace/sensitive.pdf",
      }],
      fileSources: [
        {
          ...SOURCE,
          id: "url-row",
          title: "sensitive URL title",
        },
        {
          ...SOURCE,
          id: "path-row",
          title: "sensitive path title",
          url: undefined,
          localPath: "/workspace/sensitive.pdf",
          sourceType: "file",
        },
      ],
    },
  ];

  for (const current of cases) {
    const { GET } = createResearchMissionFileRouteHandlers({
      loadMission: async () => mission(current.missionSources),
      readFile: async (_id, relativePath) =>
        relativePath === "findings.md"
          ? "# Findings"
          : JSON.stringify(current.fileSources),
      workspacePath: () => "/workspace/mission-1",
    });

    const response = await GET(localRequest(), context());
    const body = await response.json();
    assert.deepEqual(
      body.file.sourceLedger,
      { state: "failed", sources: [] },
      current.name,
    );
    assert.doesNotMatch(
      JSON.stringify(body),
      /sensitive|ambiguous|duplicate-file-id|workspace\/sensitive/,
      current.name,
    );
  }
});

test("a legacy missing ledger fails closed without exposing stale mission sources", async () => {
  const { GET } = createResearchMissionFileRouteHandlers({
    loadMission: async () => mission(),
    readFile: async (_id, relativePath) => {
      if (relativePath === "findings.md") return "# Findings";
      const error = new Error("missing sources.json") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    },
    workspacePath: () => "/workspace/mission-1",
  });

  const response = await GET(localRequest(), context());
  const body = await response.json();
  assert.deepEqual(body.file.sourceLedger, {
    state: "failed",
    sources: [],
  });
  assert.doesNotMatch(JSON.stringify(body), /Primary source/);
});

test("a malformed ledger fails closed without exposing stale mission sources or raw errors", async () => {
  const { GET } = createResearchMissionFileRouteHandlers({
    loadMission: async () => mission(),
    readFile: async (_id, relativePath) =>
      relativePath === "findings.md" ? "# Findings" : "{not-json",
    workspacePath: () => "/workspace/mission-1",
  });

  const response = await GET(localRequest(), context());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.file.sourceLedger, {
    state: "failed",
    sources: [],
  });
  assert.doesNotMatch(JSON.stringify(body), /malformed|Primary source/);
});

test("unreadable and structurally invalid ledgers also fail closed", async () => {
  const cases = [
    async () => {
      const error = new Error("permission denied: /secret/path") as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    },
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
    const body = await response.json();
    assert.deepEqual(body.file.sourceLedger, {
      state: "failed",
      sources: [],
    });
    assert.doesNotMatch(
      JSON.stringify(body),
      /permission denied|secret\/path|Primary source/,
    );
  }
});
