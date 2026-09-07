import { NextResponse } from "next/server.js";

import { caveResearchTopicDiscovery } from "../../../../../lib/feature-flags.ts";
import { rejectNonLocalRequest } from "../../../../../lib/server/api-security.ts";
import {
  createTopicDiscoveryStore,
  TopicDiscoveryStoreError,
  type TopicDiscoveryStore,
} from "../../../../../lib/server/research-topic-discovery-store.ts";
import { topicDiscoveryNotFoundResponse } from "../route.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

type Params = { params: Promise<{ id: string }> };

export type TopicJobItemRouteDependencies = {
  enabled?: () => boolean;
  store?: Pick<TopicDiscoveryStore, "getJob">;
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

export function createTopicJobItemRouteHandlers(dependencies: TopicJobItemRouteDependencies = {}) {
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
        const job = await store.getJob(id);
        if (!job) return topicDiscoveryNotFoundResponse();
        return NextResponse.json({ ok: true, job }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error instanceof TopicDiscoveryStoreError && error.code === "invalid-id") {
          return invalidTopicJobIdResponse(error.message);
        }
        return corruptionResponse();
      }
    },
  };
}

const handlers = createTopicJobItemRouteHandlers();
export const GET = handlers.GET;
