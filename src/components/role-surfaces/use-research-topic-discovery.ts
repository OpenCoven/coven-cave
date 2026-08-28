"use client";

/**
 * Client hook for Topic Discovery (Unit 2, cave-6sles.11): jobs, proposals,
 * the selected job, loading/error state, create, refresh, and accept. Mirrors
 * the use-research-missions lifecycle: create/refresh settle state and accept
 * returns the composer draft for the accept→composer handoff.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  TopicDiscoveryJobV1,
  TopicProposalV1,
} from "@/lib/research-protocol/topic-discovery";
import {
  acceptTopicProposal,
  createTopicJob,
  listTopicJobs,
  listTopicProposals,
} from "@/lib/research-topic-discovery-client";
import type {
  TopicDiscoveryJobCreateInputV1,
  TopicProposalDraftV1,
} from "@/lib/research-topic-discovery";

export type UseResearchTopicDiscovery = {
  jobs: TopicDiscoveryJobV1[];
  proposals: TopicProposalV1[];
  selectedJobId: string | null;
  loading: boolean;
  error: string | null;
  create(
    input: TopicDiscoveryJobCreateInputV1,
  ): Promise<{ job: TopicDiscoveryJobV1; proposals: TopicProposalV1[] } | null>;
  refresh(): Promise<void>;
  accept(proposalId: string): Promise<TopicProposalDraftV1 | null>;
  selectJob(jobId: string): void;
};

export function useResearchTopicDiscovery(familiarId: string): UseResearchTopicDiscovery {
  const [jobs, setJobs] = useState<TopicDiscoveryJobV1[]>([]);
  const [proposals, setProposals] = useState<TopicProposalV1[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextJobs = await listTopicJobs();
      setJobs(nextJobs);
      const nextSelected = selectedJobId ?? nextJobs[0]?.id ?? null;
      setSelectedJobId(nextSelected);
      if (nextSelected) {
        setProposals(await listTopicProposals(nextSelected));
      } else {
        setProposals([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Topic discovery could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [selectedJobId]);

  useEffect(() => {
    void refresh();
  }, [familiarId, refresh]);

  const create = useCallback<UseResearchTopicDiscovery["create"]>(async (input) => {
    setLoading(true);
    setError(null);
    try {
      const result = await createTopicJob(input);
      setJobs((current) => [result.job, ...current.filter((job) => job.id !== result.job.id)]);
      setSelectedJobId(result.job.id);
      setProposals(result.proposals);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Topic discovery could not start.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const accept = useCallback(async (proposalId: string) => {
    setError(null);
    try {
      return await acceptTopicProposal(proposalId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The topic could not be used.");
      return null;
    }
  }, []);

  const selectJob = useCallback(async (jobId: string) => {
    setSelectedJobId(jobId);
    try {
      setProposals(await listTopicProposals(jobId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Proposals could not be loaded.");
    }
  }, []);

  return { jobs, proposals, selectedJobId, loading, error, create, refresh, accept, selectJob };
}
