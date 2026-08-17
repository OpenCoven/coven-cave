import {
  fail,
  isRecord,
  type ProtocolParseResult,
} from "./common.ts";
import { parseContextPackV1, type ContextPackV1 } from "./context-pack.ts";
import {
  parseModelTaskResultV1,
  parseModelTaskV1,
  type ModelTaskResultV1,
  type ModelTaskV1,
} from "./model-task.ts";
import {
  parseResearchRunV1,
  parseRunEventV1,
  type ResearchRunV1,
  type RunEventV1,
} from "./research-run.ts";
import { parseRunManifestV1, type RunManifestV1 } from "./run-manifest.ts";
import {
  parseTopicDiscoveryJobV1,
  parseTopicProposalV1,
  type TopicDiscoveryJobV1,
  type TopicProposalV1,
} from "./topic-discovery.ts";

export * from "./common.ts";
export * from "./context-pack.ts";
export * from "./digest.ts";
export * from "./model-task.ts";
export * from "./research-run.ts";
export * from "./run-manifest.ts";
export * from "./topic-discovery.ts";

/**
 * Every Research Protocol v1 schema identifier, in the fixed order the
 * protocol defines them. This is the single source of truth for "which
 * schemas exist" — keep it in sync with the object types dispatched below.
 */
export const RESEARCH_PROTOCOL_SCHEMAS = [
  "opencoven.context-pack/v1",
  "opencoven.topic-discovery-job/v1",
  "opencoven.topic-proposal/v1",
  "opencoven.research-run/v1",
  "opencoven.run-event/v1",
  "opencoven.model-task/v1",
  "opencoven.model-task-result/v1",
  "opencoven.run-manifest/v1",
] as const;

export type ResearchProtocolObjectV1 =
  | ContextPackV1
  | TopicDiscoveryJobV1
  | TopicProposalV1
  | ResearchRunV1
  | RunEventV1
  | ModelTaskV1
  | ModelTaskResultV1
  | RunManifestV1;

/**
 * Dispatches a value to the parser for its exact `schema` string. This is a
 * thin router, not a validator: it only ever inspects `schema` to pick a
 * parser and then hands the value off unchanged, so the returned result
 * (success or failure) is identical to calling the underlying parser
 * directly. Any schema string that isn't one of `RESEARCH_PROTOCOL_SCHEMAS`
 * exactly — including a different major version of a known family, such as
 * `opencoven.run-event/v2` — is rejected as `unknown_major` without ever
 * reaching a parser.
 */
export function parseResearchProtocolObject(
  value: unknown,
): ProtocolParseResult<ResearchProtocolObjectV1> {
  if (!isRecord(value) || typeof value.schema !== "string") {
    return fail("missing_field", "$.schema", "Missing required field schema");
  }

  switch (value.schema) {
    case "opencoven.context-pack/v1":
      return parseContextPackV1(value);
    case "opencoven.topic-discovery-job/v1":
      return parseTopicDiscoveryJobV1(value);
    case "opencoven.topic-proposal/v1":
      return parseTopicProposalV1(value);
    case "opencoven.research-run/v1":
      return parseResearchRunV1(value);
    case "opencoven.run-event/v1":
      return parseRunEventV1(value);
    case "opencoven.model-task/v1":
      return parseModelTaskV1(value);
    case "opencoven.model-task-result/v1":
      return parseModelTaskResultV1(value);
    case "opencoven.run-manifest/v1":
      return parseRunManifestV1(value);
    default:
      return fail("unknown_major", "$.schema", `Unsupported schema ${value.schema}`);
  }
}
