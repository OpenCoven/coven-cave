import { NextResponse } from "next/server.js";

import { caveResearchTopicDiscovery } from "../../../../lib/feature-flags.ts";
import { rejectNonLocalRequest } from "../../../../lib/server/api-security.ts";
import {
  createTopicDiscoveryStore,
  TopicDiscoveryStoreError,
  type TopicDiscoveryStore,
} from "../../../../lib/server/research-topic-discovery-store.ts";
import { topicDiscoveryNotFoundResponse } from "../topic-jobs/route.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

export type TopicProposalsRouteDependencies = {
  enabled?: () => boolean;
  store?: Pick<TopicDiscoveryStore, "listProposals">;
};

function corruptionResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "topic_discovery_corrupt", error: "topic discovery store unavailable" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

function invalidTopicJobIdResponse(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, code: "invalid_topic_job_id", error: message },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

export function createTopicProposalsRouteHandlers(dependencies: TopicProposalsRouteDependencies = {}) {
  const enabled = dependencies.enabled ?? caveResearchTopicDiscovery;
  const store = dependencies.store ?? createTopicDiscoveryStore();

  return {
    async GET(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return topicDiscoveryNotFoundResponse();

      const jobId = new URL(req.url).searchParams.get("jobId");
      if (!jobId) {
        return invalidTopicJobIdResponse("jobId query parameter is required");
      }
      try {
        const proposals = await store.listProposals(jobId);
        return NextResponse.json({ ok: true, proposals }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error instanceof TopicDiscoveryStoreError && error.code === "invalid-id") {
          return invalidTopicJobIdResponse(error.message);
        }
        return corruptionResponse();
      }
    },
  };
}

const handlers = createTopicProposalsRouteHandlers();
export const GET = handlers.GET;
