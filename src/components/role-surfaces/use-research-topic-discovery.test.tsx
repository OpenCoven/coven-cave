// @ts-nocheck
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";

vi.mock("@/lib/research-topic-discovery-client", () => ({
  listTopicJobs: vi.fn(async () => [
    {
      schema: "opencoven.topic-discovery-job/v1",
      id: "topicjob_a",
      contextPackId: "ctx_a",
      contextPackDigest: "a".repeat(64),
      familiarId: "charm",
      status: "completed",
      requestedAt: "2026-08-28T10:00:00.000Z",
      finishedAt: "2026-08-28T10:02:00.000Z",
      proposalIds: ["proposal_a", "proposal_b", "proposal_c"],
    },
  ]),
  listTopicProposals: vi.fn(async () => [
    {
      schema: "opencoven.topic-proposal/v1",
      id: "proposal_a",
      discoveryJobId: "topicjob_a",
      contextPackId: "ctx_a",
      title: "T",
      question: "Q?",
      whyNow: "now",
      evidence: [{ resourceId: "resource_a", selector: { type: "whole-resource" }, excerpt: "x", excerptDigest: "a".repeat(64) }],
      counterevidence: [],
      scores: { groundability: 2, decisionValue: 2, unresolvedness: 2, recurrence: 2, novelty: 2, timeliness: 2, familiarFit: 2, feasibility: 2, humanResonance: 2, riskPenalty: 0, visibleTotal: 2 },
      suggested: { mode: "brief", deliverable: "r", sourceTarget: 3, wallClockMinutes: 30 },
      uncertainty: "low",
      relatedMissionIds: [],
      createdAt: "2026-08-28T10:00:00.000Z",
    },
  ]),
  createTopicJob: vi.fn(async () => ({
    job: {
      schema: "opencoven.topic-discovery-job/v1",
      id: "topicjob_new",
      contextPackId: "ctx_a",
      contextPackDigest: "a".repeat(64),
      familiarId: "charm",
      status: "completed",
      requestedAt: "2026-08-28T10:00:00.000Z",
      finishedAt: "2026-08-28T10:02:00.000Z",
      proposalIds: ["proposal_a", "proposal_b", "proposal_c"],
    },
    proposals: [],
  })),
  acceptTopicProposal: vi.fn(async () => ({ version: 1, proposalId: "proposal_a" })),
}));

import { useResearchTopicDiscovery } from "./use-research-topic-discovery";
import { createTopicJob, listTopicJobs, listTopicProposals } from "@/lib/research-topic-discovery-client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ expose }) {
  const discovery = useResearchTopicDiscovery("charm");
  expose.current = discovery;
  return null;
}

test("loads jobs and proposals on mount, then create and accept settle state", async () => {
  const expose = { current: null };
  let renderer;
  await act(async () => {
    renderer = create(<Harness expose={expose} />);
  });
  await act(async () => {});

  expect(listTopicJobs).toHaveBeenCalled();
  expect(listTopicProposals).toHaveBeenCalledWith("topicjob_a");
  expect(expose.current.jobs.length).toBe(1);
  expect(expose.current.proposals.length).toBe(1);
  expect(expose.current.selectedJobId).toBe("topicjob_a");

  const result = await act(async () =>
    expose.current.create({ version: 1, contextPackId: "ctx_a", familiarId: "charm" }));
  expect(createTopicJob).toHaveBeenCalled();
  expect(result.job.id).toBe("topicjob_new");

  const draft = await act(async () => expose.current.accept("proposal_a"));
  expect(draft.proposalId).toBe("proposal_a");

  renderer.unmount();
});
