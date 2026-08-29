import { NextResponse } from "next/server.js";

import { caveResearchTopicDiscovery } from "../../../../../lib/feature-flags.ts";
import { rejectNonLocalRequest } from "../../../../../lib/server/api-security.ts";
import {
  createTopicDiscoveryStore,
  TopicDiscoveryStoreError,
  type TopicDiscoveryStore,
} from "../../../../../lib/server/research-topic-discovery-store.ts";
import { topicDiscoveryNotFoundResponse } from "../../topic-jobs/route.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

type Params = { params: Promise<{ id: string }> };

export type TopicProposalItemRouteDependencies = {
  enabled?: () => boolean;
  store?: Pick<TopicDiscoveryStore, "getProposal">;
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

export function createTopicProposalItemRouteHandlers(dependencies: TopicProposalItemRouteDependencies = {}) {
  const enabled = dependencies.enabled ?? caveResearchTopicDiscovery;
  const store = dependencies.store ?? createTopicDiscoveryStore();

  return {
    async GET(req: Request, { params }: Params) {
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
        // Manifest only: evidence excerpts already live on the proposal.
        return NextResponse.json({ ok: true, proposal }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error instanceof TopicDiscoveryStoreError && error.code === "invalid-id") {
          return invalidTopicProposalIdResponse(error.message);
        }
        return corruptionResponse();
      }
    },
  };
}

const handlers = createTopicProposalItemRouteHandlers();
export const GET = handlers.GET;
