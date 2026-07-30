import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchMission } from "@/lib/research-missions";
import {
  filterResearchMissionsByText,
  groupResearchMissions,
  matchesResearchMissionScope,
  researchMissionScopeCounts,
} from "./research-desk-view.ts";

const mission = (
  id: string,
  status: ResearchMission["status"],
) => ({ id, status }) as ResearchMission;

const missions = [
  mission("checkpoint", "checkpoint"),
  mission("running", "running"),
  mission("failed", "failed"),
  mission("completed", "completed"),
  mission("archived", "archived"),
];

test("status scopes have explicit lifecycle membership", () => {
  assert.equal(matchesResearchMissionScope(missions[0], "active"), true);
  assert.equal(matchesResearchMissionScope(missions[2], "active"), false);
  assert.equal(matchesResearchMissionScope(missions[2], "needs-review"), true);
  assert.equal(matchesResearchMissionScope(missions[3], "finished"), true);
  assert.equal(matchesResearchMissionScope(missions[4], "all"), true);
});

test("scope counts derive from the full mission set", () => {
  assert.deepEqual(researchMissionScopeCounts(missions), {
    all: 5,
    active: 2,
    "needs-review": 2,
    finished: 1,
  });
});

test("text filtering is case-insensitive across mission title and intent", () => {
  const searchable = [
    {
      ...mission("memory", "running"),
      title: "Agent memory survey",
      intent: "Compare durable context systems.",
    },
    {
      ...mission("vector", "checkpoint"),
      title: "Vector database pricing",
      intent: "Review vendor plans.",
    },
  ];

  assert.deepEqual(
    filterResearchMissionsByText(searchable, "DURABLE").map(({ id }) => id),
    ["memory"],
  );
  assert.deepEqual(
    filterResearchMissionsByText(searchable, " vector ").map(({ id }) => id),
    ["vector"],
  );
  assert.equal(filterResearchMissionsByText(searchable, "").length, 2);
});

test("groups preserve source order inside the priority order", () => {
  const groups = groupResearchMissions(missions);
  assert.deepEqual(
    groups.map((group) => [
      group.id,
      group.missions.map(({ id }) => id),
    ]),
    [
      ["needs-review", ["checkpoint", "failed"]],
      ["in-progress", ["running"]],
      ["recent", ["completed"]],
      ["archived", ["archived"]],
    ],
  );
});
