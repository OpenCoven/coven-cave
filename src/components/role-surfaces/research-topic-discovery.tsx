"use client";

/**
 * Topic Discovery panel (Unit 2, cave-6sles.11): pack picker (reuses the Unit 1
 * context-pack client), "Run discovery" action, job status, and the proposal
 * card list. "Use this topic" accepts the proposal and hands the draft off via
 * `onUseTopic` for the accept→composer prefill.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StandardSelect } from "@/components/ui/select";
import type { TopicProposalDraftV1 } from "@/lib/research-topic-discovery";
import { fetchContextPacks } from "@/lib/research-context-pack-client";
import type { ContextPackV1 } from "@/lib/research-protocol/context-pack";
import type { TopicProposalV1 } from "@/lib/research-protocol/topic-discovery";
import { ResearchTopicCard } from "./research-topic-card";
import { useResearchTopicDiscovery } from "./use-research-topic-discovery";

export type ResearchTopicDiscoveryProps = {
  familiarId: string;
  onUseTopic(draft: TopicProposalDraftV1): void;
};

export function ResearchTopicDiscovery({ familiarId, onUseTopic }: ResearchTopicDiscoveryProps) {
  const discovery = useResearchTopicDiscovery(familiarId);
  const [packs, setPacks] = useState<ContextPackV1[]>([]);
  const [packId, setPackId] = useState<string>("");
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchContextPacks()
      .then((next) => {
        if (cancelled) return;
        setPacks(next);
        if (next.length > 0 && !packId) setPackId(next[0].id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [packId]);

  const selectedJob = discovery.jobs.find((job) => job.id === discovery.selectedJobId);

  const runDiscovery = async () => {
    if (!packId) return;
    await discovery.create({ version: 1, contextPackId: packId, familiarId });
  };

  const handleUseTopic = async (proposal: TopicProposalV1) => {
    setBusyProposalId(proposal.id);
    try {
      const draft = await discovery.accept(proposal.id);
      if (draft) onUseTopic(draft);
    } finally {
      setBusyProposalId(null);
    }
  };

  return (
    <div className="research-topic-discovery" data-testid="research-topic-discovery">
      <header className="research-topic-discovery__head">
        <div>
          <h2>Discover topics</h2>
          <p>Mine a sealed context pack for grounded research topics.</p>
        </div>
        <div className="research-topic-discovery__controls">
          <StandardSelect<string>
            label="Context pack"
            value={packId}
            onChange={setPackId}
            className="research-topic-discovery__pack"
            options={
              packs.length === 0
                ? [{ value: "", label: "No sealed packs" }]
                : packs.map((pack) => ({ value: pack.id, label: pack.id }))
            }
          />
          <Button size="sm" variant="primary" disabled={!packId || discovery.loading} onClick={() => void runDiscovery()}>
            Run discovery
          </Button>
        </div>
      </header>

      {discovery.error ? (
        <p className="research-topic-discovery__error" role="alert">{discovery.error}</p>
      ) : null}

      {selectedJob ? (
        <p className="research-topic-discovery__status" role="status">
          Job {selectedJob.id} · {selectedJob.status}
        </p>
      ) : null}

      {discovery.proposals.length === 0 && !discovery.loading ? (
        <EmptyState
          compact
          headline="No topics yet"
          subtitle="Seal a context pack, then run discovery."
        />
      ) : (
        <div className="research-topic-discovery__cards">
          {discovery.proposals.map((proposal) => (
            <ResearchTopicCard
              key={proposal.id}
              proposal={proposal}
              busy={busyProposalId === proposal.id}
              onUse={(next) => void handleUseTopic(next)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
