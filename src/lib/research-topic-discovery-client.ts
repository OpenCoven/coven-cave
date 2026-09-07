// Client-safe Topic Discovery wrapper (Unit 2, cave-6sles.11).
//
// Mirrors the research-context-pack-client style: ordinary no-store fetch over
// the flag-gated API, bounded error mapping, no blob bytes over HTTP.

import type {
  TopicDiscoveryJobV1,
  TopicProposalV1,
} from "./research-protocol/topic-discovery.ts";
import type {
  TopicDiscoveryJobCreateInputV1,
  TopicProposalDraftV1,
} from "./research-topic-discovery.ts";

export type TopicDiscoveryApiError = {
  code?: string;
  error: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `topic discovery request failed (${response.status})`;
    throw new Error(message);
  }
  if (!body) throw new Error("topic discovery response was empty");
  return body;
}

export async function listTopicJobs(
  request: typeof fetch = fetch,
): Promise<TopicDiscoveryJobV1[]> {
  const response = await request("/api/research/topic-jobs", { cache: "no-store" });
  const body = await readJson<{ ok?: boolean; jobs?: TopicDiscoveryJobV1[] }>(response);
  return body.jobs ?? [];
}

export async function createTopicJob(
  input: TopicDiscoveryJobCreateInputV1,
  request: typeof fetch = fetch,
): Promise<{ job: TopicDiscoveryJobV1; proposals: TopicProposalV1[] }> {
  const response = await request("/api/research/topic-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const body = await readJson<{ ok?: boolean; job?: TopicDiscoveryJobV1; proposals?: TopicProposalV1[] }>(response);
  if (!body.job) throw new Error("topic discovery create response was missing the job");
  return { job: body.job, proposals: body.proposals ?? [] };
}

export async function getTopicJob(
  id: string,
  request: typeof fetch = fetch,
): Promise<TopicDiscoveryJobV1> {
  const response = await request(`/api/research/topic-jobs/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const body = await readJson<{ ok?: boolean; job?: TopicDiscoveryJobV1 }>(response);
  if (!body.job) throw new Error("topic discovery job response was missing the job");
  return body.job;
}

export async function cancelTopicJob(
  id: string,
  request: typeof fetch = fetch,
): Promise<TopicDiscoveryJobV1> {
  const response = await request(`/api/research/topic-jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    cache: "no-store",
  });
  const body = await readJson<{ ok?: boolean; job?: TopicDiscoveryJobV1 }>(response);
  if (!body.job) throw new Error("topic discovery cancel response was missing the job");
  return body.job;
}

export async function listTopicProposals(
  jobId: string,
  request: typeof fetch = fetch,
): Promise<TopicProposalV1[]> {
  const response = await request(
    `/api/research/topic-proposals?jobId=${encodeURIComponent(jobId)}`,
    { cache: "no-store" },
  );
  const body = await readJson<{ ok?: boolean; proposals?: TopicProposalV1[] }>(response);
  return body.proposals ?? [];
}

export async function getTopicProposal(
  id: string,
  request: typeof fetch = fetch,
): Promise<TopicProposalV1> {
  const response = await request(`/api/research/topic-proposals/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const body = await readJson<{ ok?: boolean; proposal?: TopicProposalV1 }>(response);
  if (!body.proposal) throw new Error("topic proposal response was missing the proposal");
  return body.proposal;
}

export async function acceptTopicProposal(
  id: string,
  request: typeof fetch = fetch,
): Promise<TopicProposalDraftV1> {
  const response = await request(`/api/research/topic-proposals/${encodeURIComponent(id)}/accept`, {
    method: "POST",
    cache: "no-store",
  });
  const body = await readJson<{ ok?: boolean; draft?: TopicProposalDraftV1 }>(response);
  if (!body.draft) throw new Error("topic proposal accept response was missing the draft");
  return body.draft;
}
