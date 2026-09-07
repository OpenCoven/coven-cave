import { NextResponse } from "next/server.js";

import { caveResearchTopicDiscovery } from "../../../../lib/feature-flags.ts";
import { readJsonBody, rejectNonLocalRequest } from "../../../../lib/server/api-security.ts";
import { ContextPackStoreError } from "../../../../lib/server/research-context-pack-store.ts";
import {
  createTopicDiscoveryRunner,
  TopicDiscoveryRunnerError,
  type TopicDiscoveryRunner,
} from "../../../../lib/server/research-topic-discovery-runner.ts";
import {
  createTopicDiscoveryStore,
  type TopicDiscoveryStore,
} from "../../../../lib/server/research-topic-discovery-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

export type TopicJobsRouteDependencies = {
  enabled?: () => boolean;
  runner?: Pick<TopicDiscoveryRunner, "createJob">;
  store?: Pick<TopicDiscoveryStore, "listJobs">;
};

export function topicDiscoveryNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "topic_discovery_not_found", error: "topic discovery unavailable" },
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

function corruptionResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "topic_discovery_corrupt", error: "topic discovery store unavailable" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

function invalidContextPackIdResponse(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, code: "invalid_context_pack_id", error: message },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

function contextPackNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: "context_pack_not_found", error: "context pack not found" },
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

function purposeNotAllowedResponse(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, code: "purpose_not_allowed", error: message },
    { status: 409, headers: NO_STORE_HEADERS },
  );
}

function invalidInputResponse(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, code: "invalid_input", error: message },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

export function createTopicJobsRouteHandlers(dependencies: TopicJobsRouteDependencies = {}) {
  const enabled = dependencies.enabled ?? caveResearchTopicDiscovery;
  const runner = dependencies.runner ?? createTopicDiscoveryRunner();
  const store = dependencies.store ?? createTopicDiscoveryStore();

  return {
    async GET(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return topicDiscoveryNotFoundResponse();

      try {
        const jobs = await store.listJobs();
        return NextResponse.json({ ok: true, jobs }, { headers: NO_STORE_HEADERS });
      } catch {
        return corruptionResponse();
      }
    },

    async POST(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) {
        forbidden.headers.set("cache-control", "no-store");
        return forbidden;
      }
      if (!enabled()) return topicDiscoveryNotFoundResponse();

      const body = await readJsonBody<{ contextPackId?: unknown; familiarId?: unknown }>(req, 16 * 1024);
      if (!body.ok) {
        body.response.headers.set("cache-control", "no-store");
        return body.response;
      }
      const { contextPackId, familiarId } = body.body;
      if (typeof contextPackId !== "string" || typeof familiarId !== "string") {
        return invalidInputResponse("contextPackId and familiarId are required");
      }

      try {
        const result = await runner.createJob({ version: 1, contextPackId, familiarId });
        if (result.job.status === "completed") {
          return NextResponse.json(
            { ok: true, job: result.job, proposals: result.proposals },
            { status: 201, headers: NO_STORE_HEADERS },
          );
        }
        return NextResponse.json({ ok: true, job: result.job }, { status: 201, headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error instanceof ContextPackStoreError) {
          if (error.code === "invalid-id") return invalidContextPackIdResponse(error.message);
          if (error.code === "missing") return contextPackNotFoundResponse();
          return corruptionResponse();
        }
        if (error instanceof TopicDiscoveryRunnerError) {
          if (error.code === "purpose_not_allowed") return purposeNotAllowedResponse(error.message);
          if (error.code === "invalid-input") return invalidInputResponse(error.message);
        }
        return corruptionResponse();
      }
    },
  };
}

const handlers = createTopicJobsRouteHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
