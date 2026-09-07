import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptTopicProposal,
  cancelTopicJob,
  createTopicJob,
  getTopicJob,
  getTopicProposal,
  listTopicJobs,
  listTopicProposals,
} from "./research-topic-discovery-client.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("listTopicJobs requests the list route and returns jobs", async () => {
  const calls: string[] = [];
  const fake = async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return jsonResponse({ ok: true, jobs: [{ id: "topicjob_a" }] });
  };
  const jobs = await listTopicJobs(fake as unknown as typeof fetch);
  assert.equal(jobs[0]?.id, "topicjob_a");
  assert.equal(calls[0], "/api/research/topic-jobs");
});

test("createTopicJob posts the input and returns the job + proposals", async () => {
  const fake = async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), "/api/research/topic-jobs");
    assert.equal(init?.method, "POST");
    return jsonResponse({ ok: true, job: { id: "topicjob_a" }, proposals: [{ id: "proposal_a" }] }, 201);
  };
  const result = await createTopicJob(
    { version: 1, contextPackId: "ctx_a", familiarId: "charm" },
    fake as unknown as typeof fetch,
  );
  assert.equal(result.job.id, "topicjob_a");
  assert.equal(result.proposals[0]?.id, "proposal_a");
});

test("getTopicJob requests the detail route", async () => {
  const fake = async (url: RequestInfo | URL) => {
    assert.equal(String(url), "/api/research/topic-jobs/topicjob_a");
    return jsonResponse({ ok: true, job: { id: "topicjob_a" } });
  };
  const job = await getTopicJob("topicjob_a", fake as unknown as typeof fetch);
  assert.equal(job.id, "topicjob_a");
});

test("cancelTopicJob posts to the cancel route", async () => {
  const fake = async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), "/api/research/topic-jobs/topicjob_a/cancel");
    assert.equal(init?.method, "POST");
    return jsonResponse({ ok: true, job: { id: "topicjob_a", status: "cancelled" } });
  };
  const job = await cancelTopicJob("topicjob_a", fake as unknown as typeof fetch);
  assert.equal(job.status, "cancelled");
});

test("listTopicProposals appends the jobId query param", async () => {
  const fake = async (url: RequestInfo | URL) => {
    assert.equal(String(url), "/api/research/topic-proposals?jobId=topicjob_a");
    return jsonResponse({ ok: true, proposals: [{ id: "proposal_a" }] });
  };
  const proposals = await listTopicProposals("topicjob_a", fake as unknown as typeof fetch);
  assert.equal(proposals[0]?.id, "proposal_a");
});

test("getTopicProposal requests the proposal detail route", async () => {
  const fake = async (url: RequestInfo | URL) => {
    assert.equal(String(url), "/api/research/topic-proposals/proposal_a");
    return jsonResponse({ ok: true, proposal: { id: "proposal_a" } });
  };
  const proposal = await getTopicProposal("proposal_a", fake as unknown as typeof fetch);
  assert.equal(proposal.id, "proposal_a");
});

test("acceptTopicProposal posts to the accept route and returns the draft", async () => {
  const fake = async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), "/api/research/topic-proposals/proposal_a/accept");
    assert.equal(init?.method, "POST");
    return jsonResponse({ ok: true, draft: { version: 1, proposalId: "proposal_a" } });
  };
  const draft = await acceptTopicProposal("proposal_a", fake as unknown as typeof fetch);
  assert.equal(draft.proposalId, "proposal_a");
});

test("a non-ok response surfaces the server error message", async () => {
  const fake = async () => jsonResponse({ ok: false, code: "topic_discovery_not_found", error: "topic discovery unavailable" }, 404);
  await assert.rejects(() => listTopicJobs(fake as unknown as typeof fetch), /topic discovery unavailable/);
});

console.log("research topic discovery client: ok");
