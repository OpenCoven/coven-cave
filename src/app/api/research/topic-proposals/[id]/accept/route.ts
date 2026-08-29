import { NextResponse } from "next/server.js";

import { caveResearchTopicDiscovery } from "../../../../../../lib/feature-flags.ts";
import {
  localMissionIdFromPortable,
  parseTopicProposalDraftV1,
} from "../../../../../../lib/research-topic-discovery.ts";
import { rejectNonLocalRequest } from "../../../../../../lib/server/api-security.ts";
import {
  createTopicDiscoveryStore,
  TopicDiscoveryStoreError,
  type TopicDiscoveryStore,
} from "../../../../../../lib/server/research-topic-discovery-store.ts";
import { topicDiscoveryNotFoundResponse } from "../../../topic-jobs/route.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

type Params = { params: Promise<{ id: string }> };

export type TopicProposalAcceptRouteDependencies = {
  enabled?: () => boolean;
  store?: Pick<TopicDiscoveryStore, "getProposal" | "getJob">;
};

function corruptionResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "topic_discovery_corrupt", error: "topic discovery store unavailable" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

function invalidTopicProposalIdResponse(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, code: "invalid_topic_proposal_id", error: message },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

export function createTopicProposalAcceptRouteHandlers(
  dependencies: TopicProposalAcceptRouteDependencies = {},
) {
  const enabled = dependencies.enabled ?? caveResearchTopicDiscovery;
  const store = dependencies.store ?? createTopicDiscoveryStore();

  return {
    async POST(req: Request, { params }: Params) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return topicDiscoveryNotFoundResponse();
      const { id } = await params;
      try {
        const proposal = await store.getProposal(id);
        if (!proposal) return topicDiscoveryNotFoundResponse();
        const job = await store.getJob(proposal.discoveryJobId);
        if (!job) return corruptionResponse();

        // Resolve portable relatedMissionIds to local ids server-side; the
        // draft never carries a mission creation side effect.
        const draft = {
          version: 1,
          proposalId: proposal.id,
          contextPackId: proposal.contextPackId,
          contextPackDigest: job.contextPackDigest,
          title: proposal.title,
          question: proposal.question,
          mode: proposal.suggested.mode,
          deliverable: proposal.suggested.deliverable,
          sourceTarget: proposal.suggested.sourceTarget,
          wallClockMinutes: proposal.suggested.wallClockMinutes,
          relatedMissionIds: proposal.relatedMissionIds
            .map((portableId) => localMissionIdFromPortable(portableId))
            .filter((localId): localId is string => localId !== null),
        };
        const checked = parseTopicProposalDraftV1(draft);
        if (!checked.ok) return corruptionResponse();
        return NextResponse.json({ ok: true, draft: checked.value }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error instanceof TopicDiscoveryStoreError && error.code === "invalid-id") {
          return invalidTopicProposalIdResponse(error.message);
        }
        return corruptionResponse();
      }
    },
  };
}

const handlers = createTopicProposalAcceptRouteHandlers();
export const POST = handlers.POST;
