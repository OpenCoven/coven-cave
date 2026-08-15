# Externalized Research Desk - Implementation Specification

**Date:** 2026-08-15

**Status:** Approved specification; implementation planned

**Owner:** Research Desk

**Approval note:** Reviewed against `src/lib/research-missions.ts` and the
existing Salem-style model-connection pattern. Two blocking findings from
review are resolved in this text: (1) §11.1 requires the dual v1/v2
`parseResearchMission` to ship in Unit 3 itself, with rollback keeping v2
records readable; (2) §12.2/§13.3 add the `POST
/v1/model-tasks/{id}/lease/renew` endpoint and its idempotency/conflict rules.
Two non-blocking findings are also resolved: the pack/run retention
precedence rule (§8.4) and the complete four-value `ModelTaskV1.phase` enum
mapped to run states (§8.7). No open blocking issues remain; approved for
implementation planning of Units 0-5 per §21-23.

**Scope:** Coven Cave local discovery, portable Research Run Protocol, hosted
Research Cloud, and Cave-side user-model execution

## 1. Decision

Build the externalized Research Desk as five independently shippable units
behind one versioned protocol:

1. Protocol schemas and conformance fixtures.
2. Local Context Packs and evidence-linked topic discovery.
3. Research Mission v2 bindings and a local/hosted run gateway.
4. A Cave Device Executor that uses the user's existing familiar, model, and
   provider connection.
5. A hosted control and public-retrieval plane.

The hosted product follows Salem's privacy boundary:

- The cloud coordinates durable runs, retrieves approved public sources,
  delivers ordered events, and stores minimized metadata.
- Cave keeps raw sessions, memory, private attachments, provider credentials,
  and locally assembled prompts.
- Cave resolves and invokes the user's connected model.
- A cloud run may wait durably while Cave is offline; it must not claim to be
  progressing without an authorized executor.

The first production release is units 1 and 2. It provides useful local topic
discovery without depending on the cloud architecture. Units 3 through 5 add
portable and hosted execution without changing the Context Pack or Topic
Proposal contracts.

## 2. Goals

### 2.1 Product goals

- Let users explicitly select sessions, thread reports, missions, saved
  resources, and attachments as research context.
- Show exactly what is included, redacted, local-only, or eligible for remote
  processing before any model call.
- Produce 3-7 inspectable research topics grounded in exact evidence selectors.
- Require an explicit user accept or edit action before creating a Research
  Mission.
- Run accepted research locally, through a user-controlled executor, or through
  hosted orchestration with the same portable run contract.
- Make status, cost bounds, evidence, artifacts, retention, and completion
  receipts independently inspectable.
- Attribute model execution to the familiar, runtime, effective model, and
  provider relationship that actually performed it.

### 2.2 Engineering goals

- Keep the current seven-phase Research Mission engine as the first local
  executor.
- Put a provider-neutral gateway in front of local and hosted execution.
- Make every create, control, task-result, and artifact-registration operation
  idempotent.
- Make event streams resumable from a monotonic sequence number.
- Preserve protocol portability: no public schema contains a Cloudflare,
  filesystem, daemon, or provider-specific identifier.
- Fail closed on tenant, device, signature, digest, retention, or consent
  mismatches.

## 3. Non-goals

- Scanning every conversation in the background.
- Uploading raw conversation history by default.
- A centralized transcript or memory lake.
- Silent Research Mission creation from model-generated recommendations.
- Provider credential custody in the initial hosted product.
- Cloud progress through model-dependent phases while no Cave or
  user-controlled executor is online.
- Chain-of-thought storage, transfer, or display.
- Inheriting tools or write authority from a source session.
- Replacing the existing Research Mission workspace, artifact publication, or
  evidence ledger in the local release.
- Building the MCP adapter before the core HTTP/event protocol is stable.
- Selecting a permanent shared-package repository before a second protocol
  consumer exists.

## 4. Approaches considered

| Approach | Benefit | Failure | Decision |
| --- | --- | --- | --- |
| One full cloud-first implementation | Demonstrates the final topology early | Couples topic usefulness, privacy, device auth, orchestration, and cloud operations into one untestable launch | Reject |
| Add topic generation directly to the current mission composer | Smallest UI diff | Has no immutable context object, evidence selectors, consent boundary, or reusable run contract | Reject |
| **Protocol-first, local-first, then hosted adapters** | Delivers user value early and isolates each trust boundary | Requires deliberate schema and conformance work before cloud UI | **Adopt** |

This specification is an umbrella design, not one implementation plan. Each
delivery unit below receives its own plan and pull request series.

## 5. System invariants

These invariants are load-bearing. Implementations must enforce them in domain
modules, not only in route handlers or UI components.

### I1 - Explicit context selection

A Context Pack contains only resources selected by the user or selected by a
saved view the user explicitly enabled. An empty selection is valid; an implicit
"all history" selection is not.

### I2 - Sealed packs are immutable

After sealing, a Context Pack manifest and its normalized resource blobs never
change. New content creates a new pack id and digest.

### I3 - Evidence selectors are verifiable

Every Topic Proposal evidence item resolves to a resource in its Context Pack
and to an exact turn range, JSON pointer, text span, or artifact section.
Unsupported selectors invalidate the proposal.

### I4 - Context has no authority

Text from sessions, files, web pages, analytics, prior model output, filenames,
and metadata is untrusted data. It never supplies system instructions, tool
grants, identity, or permission.

### I5 - Discovery cannot start research

A Topic Discovery Job may read a sealed pack and existing mission metadata. It
cannot create a mission, schedule an automation, publish an artifact, promote
memory, or call a write-capable tool.

### I6 - Provider credentials stay with the executor

The default hosted path never uploads, proxies, logs, or asks for provider API
keys, runtime credentials, or local provider configuration.

### I7 - One task result advances one durable step

A Model Task has one stable id and input digest. Replaying the same result
returns the existing receipt. A different result for an already accepted task
is a conflict and cannot advance the run.

### I8 - Waiting is not running

When a model-dependent step lacks an eligible executor, the run state is
`waiting_for_executor`. UI, notifications, metrics, and receipts must preserve
that distinction.

### I9 - Artifact identity is content-addressed

Every registered artifact has a digest. Registering metadata and uploading
artifact content are separate operations and separate consent decisions.

### I10 - Cancellation is not deletion

Cancel stops new work. Retention and deletion are separate, auditable actions.

### I11 - Tenant identity comes from authentication

Cloud handlers derive tenant and user identity from validated authentication,
never from request JSON, object keys, vector metadata, or URL parameters alone.

### I12 - Unknown usage remains unknown

The product reports model cost or tokens only when the selected runtime provides
trustworthy usage telemetry. Unknown values are `null`, never estimated as
actual spend.

## 6. Architecture

```text
LOCAL CAVE

selected resources
      |
      v
Context Pack Builder -> local content-addressed blob store
      |
      v
Topic Discovery Runner -> validated Topic Proposals
      |
      v
user accepts/edits
      |
      v
Mission Compiler -> Research Run Gateway
                         | local
                         +------> existing Research Mission runner
                         |
                         | hosted
                         +------> Research Cloud
                                      |
                                      +--> public retrieval
                                      +--> durable workflow
                                      +--> ordered run events
                                      |
                                Model Task lease
                                      |
                                      v
                              Cave Device Executor
                                      |
                              local prompt assembly
                                      |
                              user-connected model
                                      |
                           signed structured result
```

### 6.1 Responsibility boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| Context Pack Builder | selection, normalization, redaction preview, local snapshots, digest | topic ranking, mission creation |
| Topic Discovery Runner | mine, challenge, deduplicate, score, validate | web search, write tools, automatic mission creation |
| Mission Compiler | accepted question, pack binding, bounds, execution profile | research execution |
| Research Run Gateway | provider-neutral lifecycle operations | UI state, provider credentials |
| Local gateway | mapping to existing mission runner | hosted tenant state |
| Hosted gateway | Research Cloud API and event adaptation | local private pack contents |
| Device Executor | capability advertisement, task lease, local prompt assembly, model invocation, signed result | run orchestration, cloud retention policy |
| Research Cloud | auth, tenant policy, public retrieval, workflow, events, minimized artifacts | private Cave context and default provider credentials |

## 7. Canonical protocol

### 7.1 Versioning

All wire objects use a namespaced schema string:

```text
opencoven.context-pack/v1
opencoven.topic-discovery-job/v1
opencoven.topic-proposal/v1
opencoven.research-run/v1
opencoven.run-event/v1
opencoven.model-task/v1
opencoven.model-task-result/v1
opencoven.run-manifest/v1
```

Rules:

- A consumer rejects an unknown major version.
- Additive optional fields are allowed within a major version.
- Required-field changes, enum removals, or semantic changes require a new
  major version.
- Unknown fields survive proxying but are not interpreted.
- Canonical digests use RFC 8785 JSON canonicalization and SHA-256.
- An object's own `digest` field is omitted while computing that object digest;
  referenced blob and child-object digests remain included.
- Timestamps are UTC RFC 3339 strings.
- IDs are opaque strings with a type prefix; consumers do not parse meaning from
  them.

### 7.2 Canonical local schema location

Until a second production consumer exists, Cave owns the source-of-truth schema
and fixtures:

```text
schemas/research/v1/
  context-pack.schema.json
  topic-discovery-job.schema.json
  topic-proposal.schema.json
  research-run.schema.json
  run-event.schema.json
  model-task.schema.json
  model-task-result.schema.json
  run-manifest.schema.json
  fixtures/
    valid/
    invalid/
```

TypeScript types, parsers, canonicalization, and digest helpers live under:

```text
src/lib/research-protocol/
```

Schema files are authoritative. Hand-written TypeScript parsers must run against
the same valid and invalid fixtures. When Research Cloud becomes the second
consumer, these schemas move into a versioned `@opencoven/research-protocol`
package without changing their identifiers or fixture corpus.

## 8. Domain contracts

### 8.1 Context Pack

```ts
type ContextPackV1 = {
  schema: "opencoven.context-pack/v1";
  id: string;
  digest: string;
  createdAt: string;
  createdBy: {
    client: "coven-cave";
    userId?: string;
  };
  purpose: "topic-discovery" | "research-run";
  subject: {
    familiarId: string;
    projectId?: string;
  };
  consent: {
    selectionMode: "explicit" | "saved-view";
    allowRemoteQueries: boolean;
    allowRemoteContent: boolean;
    artifactContentSync: boolean;
    retention: "run-only" | "7-days" | "project";
  };
  resources: ContextPackResourceV1[];
  policy: {
    treatResourceTextAsData: true;
    toolAuthority: "none";
    allowedPurposes: Array<"topic-discovery" | "research-run">;
  };
  transforms: {
    secretScanVersion: string;
    redactionMapDigest?: string;
  };
};

type ContextPackResourceV1 = {
  id: string;
  kind:
    | "session"
    | "thread-self-report"
    | "mission"
    | "artifact"
    | "attachment"
    | "saved-resource"
    | "metric-snapshot";
  uri: string;
  digest: string;
  localBlobDigest: string;
  selector: ContextSelectorV1;
  trust:
    | "user-authored"
    | "agent-output"
    | "mixed-conversation"
    | "model-derived"
    | "imported-source";
  sensitivity: "public" | "private" | "restricted";
  capturedAt: string;
  title?: string;
  mediaType: string;
};
```

Selectors are a tagged union:

```ts
type ContextSelectorV1 =
  | { type: "turn-range"; start: number; end: number }
  | { type: "json-pointer"; pointer: string }
  | { type: "text-span"; start: number; end: number }
  | { type: "markdown-section"; headingPath: string[] }
  | { type: "whole-resource" };
```

`whole-resource` requires an explicit per-resource confirmation when the
resource is private or restricted.

If the user declines that confirmation, the resource is excluded from the pack.
The builder does not silently narrow the selector or include a partial snapshot;
the user must make a narrower explicit selection to include content from it.

### 8.2 Topic Discovery Job

```ts
type TopicDiscoveryJobV1 = {
  schema: "opencoven.topic-discovery-job/v1";
  id: string;
  contextPackId: string;
  contextPackDigest: string;
  familiarId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  proposalIds: string[];
  modelReceipt?: ResearchModelReceiptV1;
  failure?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};
```

### 8.3 Topic Proposal

```ts
type TopicProposalV1 = {
  schema: "opencoven.topic-proposal/v1";
  id: string;
  discoveryJobId: string;
  contextPackId: string;
  title: string;
  question: string;
  whyNow: string;
  evidence: TopicEvidenceRefV1[];
  counterevidence: TopicEvidenceRefV1[];
  scores: {
    groundability: number;
    decisionValue: number;
    unresolvedness: number;
    recurrence: number;
    novelty: number;
    timeliness: number;
    familiarFit: number;
    feasibility: number;
    humanResonance: number;
    riskPenalty: number;
    visibleTotal: number;
  };
  suggested: {
    mode: "brief" | "sweep" | "paper" | "autoresearch";
    deliverable: string;
    sourceTarget: number;
    wallClockMinutes: number;
  };
  uncertainty: string;
  relatedMissionIds: string[];
  createdAt: string;
};

type TopicEvidenceRefV1 = {
  resourceId: string;
  selector: ContextSelectorV1;
  excerpt: string;
  excerptDigest: string;
};
```

Score dimensions are integers from 0 through 4. `riskPenalty` is also 0 through
4 and is subtracted. `visibleTotal` is recomputed by Cave; model output cannot
set it authoritatively.

### 8.4 Research execution bindings

Do not overload `ResearchSourceRef`. Context used to formulate a question and
sources discovered during research are separate provenance classes.

```ts
type ResearchContextBindingV1 = {
  contextPackId: string;
  contextPackDigest: string;
  topicProposalId?: string;
};

type ResearchExecutionProfileV1 = {
  location: "local" | "hosted";
  modelExecution: "cave-device" | "user-hosted-executor";
  modelBinding: {
    familiarId: string;
    selection: "resolve-at-run-start" | "pinned";
    model?: string;
  };
  strategy: "single-agent" | "orchestrator-workers";
};

type ResearchPrivacyPolicyV1 = {
  remoteQueries: boolean;
  remoteContent: boolean;
  artifactContentSync: boolean;
  retention: "run-only" | "7-days" | "project";
  allowMemoryPromotion: false;
};
```

`allowMemoryPromotion` is fixed to `false` in v1. Memory promotion remains a
separate, human-reviewed product action.

Retention values have a strict maximum-duration order:
`run-only < 7-days < project`. A run's retention must not exceed the bound
sealed into its Context Pack consent. The Mission Compiler rejects a longer
run retention with `retention_exceeds_context_consent`; when no pack is bound,
the run retention governs. Context Pack retention limits remote persistence,
not the lifetime of the user's local sealed pack.

### 8.5 Research Run

```ts
type ResearchRunStatusV1 =
  | "queued"
  | "scoping"
  | "gathering_public_sources"
  | "waiting_for_executor"
  | "challenging"
  | "synthesizing"
  | "controlling"
  | "awaiting_checkpoint"
  | "publishing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

type ResearchRunV1 = {
  schema: "opencoven.research-run/v1";
  id: string;
  tenantOpaqueId?: string;
  context: ResearchContextBindingV1;
  acceptedTopic: {
    proposalId?: string;
    question: string;
    editedByUser: boolean;
  };
  execution: ResearchExecutionProfileV1;
  privacy: ResearchPrivacyPolicyV1;
  bounds: ResearchBounds;
  status: ResearchRunStatusV1;
  waitingReason?: "executor" | "checkpoint" | "provider-attention";
  waitingForPhase?: "scope" | "challenge" | "synthesize" | "control";
  createdAt: string;
  updatedAt: string;
  nextEventSequence: number;
  artifactManifest?: RunManifestV1;
  failure?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};
```

`tenantOpaqueId` is omitted from Cave-created local runs. Cloud responses may
include an opaque support correlator, but clients never use it for
authorization.

### 8.6 Run Event

```ts
type RunEventV1 = {
  schema: "opencoven.run-event/v1";
  runId: string;
  sequence: number;
  type:
    | "run.created"
    | "run.status"
    | "phase.started"
    | "phase.completed"
    | "model-task.available"
    | "model-task.leased"
    | "model-task.completed"
    | "checkpoint.required"
    | "artifact.registered"
    | "run.completed"
    | "run.failed"
    | "run.cancelled"
    | "retention.changed"
    | "content.deleted";
  at: string;
  data: Record<string, unknown>;
};
```

Sequences begin at 1 and increase by one per run. Clients treat a gap as a
resync condition and call `GET /v1/research-runs/{id}/events?after=<sequence>`.

### 8.7 Model Task and result

```ts
type ModelTaskV1 = {
  schema: "opencoven.model-task/v1";
  id: string;
  runId: string;
  phase: "scope" | "challenge" | "synthesize" | "control";
  attempt: number;
  inputDigest: string;
  input: {
    topicProposalId?: string;
    contextPack: {
      id: string;
      digest: string;
      availability: "device-local";
    };
    publicEvidenceRefs: string[];
  };
  modelBinding: ResearchExecutionProfileV1["modelBinding"];
  policy: {
    permissionMode: "read";
    allowedOutputs: string[];
    allowRemoteQueries: boolean;
    maxOutputTokens: number;
  };
  outputSchema: string;
  leaseExpiresAt: string;
};

type ModelTaskResultV1 = {
  schema: "opencoven.model-task-result/v1";
  taskId: string;
  runId: string;
  attempt: number;
  inputDigest: string;
  output: Record<string, unknown>;
  outputDigest: string;
  executorDeviceId: string;
  modelReceipt: ResearchModelReceiptV1;
  completedAt: string;
  signature: string;
};

type ResearchModelReceiptV1 = {
  familiarId: string;
  runtime: string;
  effectiveModel: string | null;
  modelSource:
    | "next-message"
    | "session"
    | "familiar-default"
    | "runtime-default"
    | "global-default";
  providerBilling: "user-connected";
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    reportedByRuntime: boolean;
  };
};
```

The signature covers canonical JSON containing `taskId`, `runId`, `attempt`,
`inputDigest`, `outputDigest`, `executorDeviceId`, and `completedAt`.

Model phases map to run states as follows:

| Model Task phase | Active run state | Purpose |
| --- | --- | --- |
| `scope` | `scoping` | Turn the accepted question and bounds into research questions and a public retrieval plan |
| `challenge` | `challenging` | Test gathered evidence for contradictions, omissions, duplication, and weak support |
| `synthesize` | `synthesizing` | Produce structured findings and artifact content from the approved evidence set |
| `control` | `controlling` | Choose checkpoint or publish against evidence quality and explicit bounds |

`gathering_public_sources` is performed by the cloud retrieval service and
creates no Model Task. `publishing` registers manifests and opted-in artifact
content and also creates no Model Task.

## 9. Local Context Pack implementation

### 9.1 Storage

Use a dedicated local store:

```text
<caveHome>/research-context-packs/
  manifests/<pack-id>.json
  blobs/sha256/<first-two-hex>/<digest>
  redactions/<redaction-map-digest>.json
  topic-jobs/<job-id>.json
  topic-proposals/<proposal-id>.json
```

Requirements:

- Create directories with user-only permissions.
- Write blobs and manifests through temp-file plus atomic rename.
- Refuse symlinks and paths outside the store root.
- Deduplicate blobs by digest.
- Verify every blob digest on read.
- Seal the manifest only after every referenced blob is durable.
- Keep original source URIs in the manifest, but never dereference them while
  replaying a sealed pack.
- Deleting a pack deletes its manifest and unreferenced local blobs. Shared
  blobs survive until no manifest references them.

### 9.2 Resource adapters

Each source kind implements:

```ts
type ContextResourceAdapter = {
  kind: ContextPackResourceV1["kind"];
  preview(selection: unknown): Promise<ContextResourcePreview>;
  snapshot(
    selection: unknown,
    redactions: RedactionDecision[],
  ): Promise<ContextResourceSnapshot>;
};
```

Adapters are read-only. Initial adapters:

1. Conversation sessions.
2. Thread self-reports.
3. Research Missions and their artifacts.
4. Saved resources.
5. Local attachments already inside an allowed project or Cave-owned store.

Metric snapshots are deferred until the analytics aggregation API exposes a
stable selector.

### 9.3 Redaction flow

1. Normalize selected content.
2. Run secret-pattern detection.
3. Present each finding with resource, selector, category, and proposed
   replacement.
4. Require user confirmation before sealing when any private or restricted
   resource is selected.
5. Store only the redacted snapshot in the pack blob store.
6. Store the redaction map separately; its manifest digest proves which
   transform ran without exposing removed text in telemetry.

Automated scanning is advisory. The UI must not call a pack "safe" or
"secret-free".

## 10. Topic Discovery implementation

### 10.1 Pipeline

One job performs five bounded stages:

1. **Normalize** - build compact resource summaries with exact selectors.
2. **Mine** - generate up to 20 candidate questions from unresolved goals,
   contradictions, repeated blockers, weak evidence, and cross-resource
   connections.
3. **Challenge** - search the same pack and prior mission metadata for
   counterevidence, already-resolved outcomes, duplicates, and privacy risk.
4. **Score and deduplicate** - compute visible scores, reject unsupported
   evidence, then apply diversity selection.
5. **Present** - persist 3-7 proposals.

No stage performs web search.

### 10.2 Model execution

Add a server-side `executeResearchModelTask` boundary. It must:

- Resolve the familiar and effective model through the existing model-state
  hierarchy.
- Use `permissionMode: "read"`.
- Supply no project root and no write-capable tool grant.
- Wrap all pack content in explicit untrusted-data delimiters.
- Request structured JSON matching the stage output schema.
- Enforce input and output byte/token caps.
- Return the effective model and runtime receipt.

This wrapper may initially call the same internal chat execution path used by
`/api/chat/send`, but discovery code must not construct an HTTP request to its
own route. Extract and call the shared server function instead.

### 10.3 Deterministic scoring

Initial weights:

```ts
const TOPIC_SCORE_WEIGHTS = {
  groundability: 0.18,
  decisionValue: 0.16,
  unresolvedness: 0.13,
  recurrence: 0.10,
  novelty: 0.10,
  timeliness: 0.08,
  familiarFit: 0.08,
  feasibility: 0.08,
  humanResonance: 0.09,
  riskPenalty: -0.20,
} as const;
```

The model proposes component scores and reasons. Cave validates ranges and
recomputes `visibleTotal`. Evidence-selector validity is a hard gate, not a
score. Maximal marginal relevance or equivalent deterministic diversity
selection prevents near-duplicate final cards.

### 10.4 Proposal acceptance

Accepting a proposal opens the existing mission composer prefilled with:

- question;
- suggested mode;
- deliverable;
- source target;
- wall-clock bound;
- immutable Context Pack binding.

The user may edit every mission field. `editedByUser` records whether the
accepted question changed. Starting research remains the only operation that
creates a mission.

## 11. Research Mission v2 and gateway

### 11.1 Backward-compatible mission model

Keep the existing local `ResearchMissionStatus` lifecycle. Do not force cloud
states into it. Add:

```ts
type ResearchExecutionStateV1 = {
  runId: string;
  gateway: "local" | "hosted";
  status: ResearchRunStatusV1;
  waitingReason?: ResearchRunV1["waitingReason"];
  lastEventSequence: number;
  updatedAt: string;
};

type ResearchMissionV2 = Omit<ResearchMission, "version"> & {
  version: 2;
  context?: ResearchContextBindingV1;
  executionProfile: ResearchExecutionProfileV1;
  privacy: ResearchPrivacyPolicyV1;
  executionState?: ResearchExecutionStateV1;
};
```

Parsing rules:

- Version 1 records parse unchanged and normalize in memory to a local execution
  profile with no Context Pack.
- The dual v1/v2 parser lands with v2 writes disabled before any v2 record can
  be persisted.
- Version 1 is rewritten as version 2 only on the next successful mutation.
- Missing v2 fields on a v1 record receive local, privacy-preserving defaults.
- Invalid v2 bindings fail parse; they are never silently discarded.
- `ResearchSourceRef[]` remains unchanged.

This migration uses expand, enable, contract. The rollback target after v2
writes begin must retain the dual parser even when all v2 UI and gateway flags
are disabled. A release that understands only v1 is not a valid rollback target
after the write flag has been enabled. V2 records remain readable and locally
executable with hosted features disabled.

### 11.2 Gateway interface

```ts
interface ResearchRunGateway {
  create(input: CreateResearchRunInput): Promise<ResearchRunV1>;
  get(runId: string): Promise<ResearchRunV1>;
  listEvents(runId: string, after: number): Promise<RunEventV1[]>;
  cancel(runId: string, idempotencyKey: string): Promise<ResearchRunV1>;
  checkpoint(
    runId: string,
    decision: "continue" | "refine" | "finish" | "pause",
    idempotencyKey: string,
  ): Promise<ResearchRunV1>;
  registerArtifact(
    runId: string,
    artifact: ArtifactRegistrationV1,
    idempotencyKey: string,
  ): Promise<RunManifestV1>;
}
```

Implementations:

- `LocalResearchRunGateway` adapts the existing
  `ResearchMissionRunner` and local mission actions.
- `HostedResearchRunGateway` calls Research Cloud and maps its errors and events
  without changing domain objects.

The UI and mission compiler depend only on this interface.

### 11.3 Derived display state

Add one pure `researchMissionDisplayState` function. It maps:

- hosted `waiting_for_executor` -> `Waiting for Cave`;
- hosted `awaiting_checkpoint` -> `Needs review`;
- hosted `expired` -> `Expired`;
- other hosted active states -> `Running`;
- no hosted execution state -> current local mission status.

List filters, cards, notifications, and detail views use this function. The
persisted local mission status remains the current lifecycle source of truth.

## 12. Cave Device Executor

### 12.1 Credential reuse

Do not create a second Ed25519/keychain implementation. Extract the general
device identity, signing, and macOS Keychain mechanics from
`src/lib/server/openclaw-device-credentials.ts` into a service-namespaced
`DeviceCredentialStore`.

Requirements preserved from the existing implementation:

- Ed25519 keypair.
- Device id is SHA-256 of the raw public key.
- Private key and device token live in the OS credential store.
- Secrets reach the macOS `security` tool over stdin, never argv.
- Corrupt paired identity fails loudly and is not silently replaced.
- Unsupported operating systems fail closed.

OpenClaw and Research Cloud use separate service names and token accounts.
Cross-platform credential stores are separate delivery units; until they ship,
Research Cloud device execution is available only where a supported store
exists.

### 12.2 Connection lifecycle

The executor is an outbound-only server process component:

1. Load or create the Research Cloud device identity.
2. Register the public key after user account authentication.
3. Exchange a signed challenge for a short-lived, audience-bound device token.
4. Connect to the executor WebSocket.
5. Advertise familiar, runtime, and model capabilities without credentials.
6. Resume events from the last persisted sequence.
7. Lease one compatible task.
8. Execute, validate, sign, and submit the result.
9. Renew the lease only while the local model call is alive, using the same
   device, attempt, and input digest before the current expiry.
10. Reconnect with bounded exponential backoff and jitter.

Polling `POST /v1/model-tasks/{id}/lease` is the fallback when WebSocket
delivery is unavailable. The WebSocket is never the source of truth.

### 12.3 Local task execution

For each leased task:

- Verify schema, signature, tenant binding, run id, task id, attempt, input
  digest, deadline, output schema, and local Context Pack digest.
- Refuse the task if the pack is absent or changed.
- Fetch only the public evidence refs named by the task.
- Assemble the private prompt locally.
- Treat public and private evidence as untrusted quoted data.
- Resolve the effective model once at task start.
- Invoke the familiar with read permission and no inherited session tools.
- Validate structured output.
- Remove fields not allowed by `allowedOutputs`.
- Never include hidden reasoning, the complete local prompt, provider
  credentials, or unselected Context Pack content.
- Sign and submit the result idempotently.

### 12.4 Executor failures

| Code | Meaning | Cloud behavior |
| --- | --- | --- |
| `context_pack_missing` | Required local pack is unavailable | Wait for another eligible executor or user repair |
| `context_pack_digest_mismatch` | Local pack does not match the sealed input | Terminal for the task; require a cloned run |
| `model_unavailable` | Selected model id cannot run | Pause for model selection |
| `provider_attention_required` | Provider auth, quota, or account action is needed | Pause; never request the credential |
| `output_invalid` | Model output fails the required schema | Retry within attempt bounds |
| `executor_revoked` | Device lost authorization | Release lease after expiry |
| `task_expired` | Result arrived after the accepted lease | Reject with `lease_expired`; executor may acquire a fresh lease if the task remains unfilled |
| `lease_renewal_late` | Renewal arrived after lease expiry | Reject renewal; executor stops local work if possible and submits no result |

## 13. Research Cloud

### 13.1 Deployment binding

The initial adapter uses Cloudflare:

- Worker: HTTP API, authentication, quotas, and tenant policy.
- Workflow: durable research phases, retries, waits, checkpoints, and
  cancellation.
- Agents SDK/Durable Object: per-run coordination, task leases, connected
  devices, ordered event sequencing, and broadcast.
- D1: tenant, run, policy, device, idempotency, and artifact metadata.
- R2: immutable public-source snapshots and opted-in artifact content.
- Vectorize: public or explicitly remote-approved content only.
- Queue: ingestion/indexing with retries and a dead-letter queue.

Cloudflare binding names and ids remain private adapter details. If the shared
OpenCoven Cloud control plane adopts another durable runtime, it implements the
same protocol and conformance suite.

### 13.2 Cloud state machine

```text
queued
  -> waiting_for_executor (scope)
  -> scoping
  -> gathering_public_sources
  -> waiting_for_executor (challenge)
  -> challenging
  -> waiting_for_executor (synthesize)
  -> synthesizing
  -> waiting_for_executor (control)
  -> controlling
  -> awaiting_checkpoint | publishing
  -> completed

Any non-terminal state -> failed | cancelled
waiting_for_executor -> expired
```

`waitingForPhase` is required when status is `waiting_for_executor` and absent
otherwise. It identifies the phase to resume after a compatible executor leases
the task.

Allowed control transitions:

- `cancel`: any non-terminal state -> `cancelled`.
- `pause`: active state -> Workflow paused; public status remains its current
  phase with `waitingReason: checkpoint`.
- `continue`: `awaiting_checkpoint` -> next planned phase.
- `refine`: `awaiting_checkpoint` -> `scoping` with a new direction event.
- `finish`: `awaiting_checkpoint` -> `publishing`.

No other transition is accepted.

### 13.3 Cloud API

All mutation endpoints accept `Idempotency-Key`. The key scope is
`tenant + method + canonical route`. Reusing a key with a different request
digest returns `409 idempotency_conflict`.

| Endpoint | Operation |
| --- | --- |
| `POST /v1/context-packs` | Register pack metadata and digest; no private blobs by default |
| `POST /v1/topic-jobs` | Optional remote discovery for remote-approved packs |
| `GET /v1/topic-jobs/{id}` | Read job and proposals |
| `POST /v1/research-runs` | Create a durable run |
| `GET /v1/research-runs/{id}` | Read run state and manifest |
| `GET /v1/research-runs/{id}/events?after=N` | Read ordered events after a cursor |
| `GET /v1/research-runs/{id}/stream?after=N` | Resumable SSE |
| `POST /v1/research-runs/{id}/cancel` | Cancel idempotently |
| `POST /v1/research-runs/{id}/checkpoint` | Continue, refine, finish, or pause |
| `POST /v1/research-runs/{id}/artifacts` | Register artifact metadata/digest |
| `POST /v1/research-runs/{id}/retention` | Change retention within policy |
| `POST /v1/devices` | Register a device public key |
| `DELETE /v1/devices/{id}` | Revoke device and stop new leases |
| `GET /v1/executor/connect` | Authenticated executor WebSocket |
| `POST /v1/model-tasks/{id}/lease` | Polling lease fallback |
| `POST /v1/model-tasks/{id}/lease/renew` | Extend an unexpired lease for the same device, attempt, and input digest |
| `POST /v1/model-tasks/{id}/result` | Submit a signed result |
| `POST /v1/model-tasks/{id}/failure` | Submit a typed executor failure |

Standard errors:

```ts
type ResearchApiErrorV1 = {
  schema: "opencoven.error/v1";
  code: string;
  message: string;
  requestId: string;
  retryable: boolean;
  field?: string;
};
```

No error includes raw prompts, private excerpts, credentials, or object-store
paths.

Lease renewal is idempotent for a given task, device, attempt, input digest, and
requested expiry. It succeeds only before the current expiry and extends by one
server-defined lease period. A different device, attempt, or digest receives
`409 lease_conflict`; an expired lease receives `409 lease_expired`.

### 13.4 Public retrieval

Inputs:

- sanitized research question;
- allowed connector ids;
- source date/language/domain constraints;
- maximum result and byte counts.

Outputs:

- stable public evidence id;
- canonical URL;
- title and publisher;
- fetched timestamp;
- content digest;
- exact passage;
- passage selector;
- retrieval and reranking scores;
- snapshot reference.

Retrieval never receives private Context Pack blobs in the default mode.
Connectors reject loopback, private-network, link-local, and cloud-metadata
targets after every redirect.

### 13.5 Tenant isolation

Every persisted row and object includes `tenant_id`. Enforcement:

- API derives tenant from auth.
- D1 queries include tenant in the primary access predicate.
- Durable Object names are an HMAC of tenant and run id, not a raw user value.
- R2 object keys are tenant-prefixed and accessed only through authenticated
  Workers; buckets are not public.
- Vector queries require a tenant/project filter even for public snapshots.
- Device tokens are audience-, tenant-, device-, and scope-bound.
- Task leases bind tenant, run, task, attempt, device, input digest, and expiry.

Cross-tenant tests are release blockers.

## 14. Data placement and retention

| Data | Default | Remote opt-in |
| --- | --- | --- |
| Raw sessions and memory | Cave only | Not supported in v1 |
| Private attachments | Cave only | Not supported in v1 |
| Redacted Context Pack blobs | Cave only | Supported only after separate content preview |
| Provider credentials | Existing local runtime/keychain | Not supported in v1 |
| Full assembled prompts | Cave only | Not supported in v1 |
| Topic title/question and accepted edits | Local; cloud for hosted runs | Required for hosted run |
| Sanitized public search queries | Cloud for hosted runs | Required for hosted retrieval |
| Public evidence snapshots | Cloud | Required for reproducibility |
| Structured Model Task outputs | Cloud, minimized | Required to advance hosted workflow |
| Chain-of-thought | Not durable | Never |
| Final private artifact content | Cave only | Separate artifact-sync consent |
| Artifact digest and manifest | Local and cloud | Required for hosted completion receipt |
| Run events and deletion receipts | Cloud | Required for hosted lifecycle |

Retention behavior:

- `run-only`: delete content after terminal state plus a 24-hour recovery
  window; retain minimized audit metadata for 30 days.
- `7-days`: delete content seven days after terminal state.
- `project`: retain until project deletion or explicit retention change.
- A deletion job emits `content.deleted` with object counts and manifest
  status, not deleted content.
- Cancellation does not shorten retention automatically.
- Changing to a shorter policy schedules deletion; changing to a longer policy
  requires fresh consent.

These are product defaults. Legal or operational policy may shorten them but
must not silently lengthen them.

## 15. Cave API and UI

### 15.1 Local API routes

All routes use the current local-request rejection and bounded JSON readers.

```text
POST   /api/research/context-packs
GET    /api/research/context-packs/:id
DELETE /api/research/context-packs/:id
POST   /api/research/topic-jobs
GET    /api/research/topic-jobs/:id
POST   /api/research/topic-jobs/:id/cancel
GET    /api/research/topic-proposals/:id
POST   /api/research/topic-proposals/:id/accept
GET    /api/research/cloud/status
POST   /api/research/cloud/devices
DELETE /api/research/cloud/devices/:id
```

`accept` returns a mission-composer draft. It does not create the mission.

### 15.2 Research surface

Add `Discover topics` beside `New research`, not inside a running mission.

Flow:

1. Choose explicit resources.
2. Preview counts, selected spans, sensitivity, and local/remote placement.
3. Review redactions and seal the pack.
4. Run local topic discovery.
5. Review 3-7 proposal cards.
6. Open `Why this?` to inspect evidence and counterevidence.
7. Dismiss, edit, or accept.
8. Start the accepted draft in the existing mission composer.

Proposal card requirements:

- title and question;
- why now;
- visible score breakdown;
- evidence count and exact excerpts;
- counterevidence and uncertainty;
- related prior missions;
- suggested mode, effort, and source target;
- `Dismiss`, `Edit question`, and `Use this topic`.

No infinite feed, urgency manipulation, hidden engagement score, or automatic
launch.

### 15.3 Hosted run status

Research Desk shows:

- execution location;
- familiar/runtime/effective model;
- current phase;
- waiting reason;
- executor device availability;
- declared bounds and provider-reported actual usage;
- public evidence count;
- artifact manifest and local/cloud placement;
- retention policy and deletion receipt.

Copy requirements:

- `waiting_for_executor`: "Waiting for an authorized Cave to continue."
- `provider_attention_required`: "Your connected provider needs attention in
  Cave. Open the model settings to continue."
- `expired`: "No executor became available before this run expired. Clone the
  run to try again."

Do not render any waiting state as a progress percentage.

## 16. File and module map

### 16.1 Coven Cave

New logical modules:

```text
schemas/research/v1/**
src/lib/research-protocol/**
src/lib/research-context-pack.ts
src/lib/research-topic-discovery.ts
src/lib/research-run-gateway.ts
src/lib/server/research-context-pack-store.ts
src/lib/server/research-context-resource-adapters.ts
src/lib/server/research-topic-discovery-runner.ts
src/lib/server/research-model-task-executor.ts
src/lib/server/research-run-local-gateway.ts
src/lib/server/research-run-hosted-gateway.ts
src/lib/server/research-cloud-device-credentials.ts
src/lib/server/research-cloud-executor.ts
src/components/role-surfaces/research-topic-discovery.tsx
src/components/role-surfaces/research-context-picker.tsx
src/components/role-surfaces/research-topic-card.tsx
src/app/api/research/context-packs/**
src/app/api/research/topic-jobs/**
src/app/api/research/topic-proposals/**
src/app/api/research/cloud/**
```

Modified seams:

```text
src/lib/research-missions.ts
src/lib/research-mission-client.ts
src/lib/research-mission-flow.ts
src/lib/server/research-mission-lifecycle.ts
src/lib/server/research-mission-runner.ts
src/components/role-surfaces/researcher-surface.tsx
src/components/role-surfaces/research-tab-prompt.tsx
src/components/role-surfaces/research-tab-desk.tsx
src/components/role-surfaces/use-research-missions.ts
src/lib/server/openclaw-device-credentials.ts
```

The device-credential extraction must preserve OpenClaw behavior and tests.

### 16.2 Research Cloud adapter

Logical modules in the hosted service:

```text
src/api/**
src/auth/**
src/agents/research-run-coordinator.ts
src/workflows/research-run-workflow.ts
src/retrieval/**
src/model-tasks/**
src/artifacts/**
src/retention/**
src/observability/**
src/protocol/**
```

The hosted repository name and deployment account are operational choices, not
protocol fields.

## 17. Security requirements

Release-blocking controls:

1. Secret scan and human redaction preview before sealing private packs.
2. Resource text enclosed as data with no instruction authority.
3. No source-session tool or permission inheritance.
4. URI parsing with redirect revalidation and private-address denial.
5. Request, response, event, and artifact byte limits.
6. Content-type and UTF-8 validation.
7. Device challenge-response and signed Model Task results.
8. Short task leases with digest and attempt binding.
9. Tenant predicates on every cloud read/write.
10. Non-public object storage.
11. No raw content, prompts, credentials, or excerpts in metrics and traces.
12. Explicit approval before remote content, artifact sync, publication,
    task creation, or memory promotion.
13. Rate limits per user, tenant, device, connector, and run.
14. Audit records for device registration/revocation, run control, retention
    changes, and deletion.

Threat fixtures include prompt injection in:

- user turns;
- assistant output;
- thread self-reports;
- Markdown links;
- PDF text;
- filenames;
- attachment metadata;
- source titles;
- public retrieved passages;
- prior artifacts;
- model-generated topic evidence.

Passing means no fixture changes identity, grants tools, bypasses approval,
reaches a denied network target, or produces an unsupported evidence selector.

## 18. Reliability and error handling

| Failure | Required behavior |
| --- | --- |
| Context source changes after selection | Pack uses sealed snapshot; original URI is informational |
| Pack write interrupted | No manifest becomes visible until every blob and digest is durable |
| Discovery model returns malformed JSON | Typed failure; retry within bound; never persist partial proposals |
| Proposal references missing evidence | Reject proposal; job may complete with fewer cards |
| All proposals fail validation | Job fails with `no_grounded_proposals` |
| Local mission creation fails after proposal accept | Keep proposal and draft; no duplicate run is created |
| Hosted create response is lost | Retry same idempotency key and receive same run |
| WebSocket disconnects | Resume from cursor; polling fallback remains available |
| Cave disconnects before lease | Task remains available |
| Cave disconnects during lease | Lease expires and becomes claimable |
| Duplicate matching result | Return existing receipt |
| Duplicate conflicting result | `409 result_conflict`; do not advance |
| Public source changes | Keep the original snapshot and mark freshness |
| Workflow retries | Reuse stable task and idempotency ids |
| Provider rejects model | Pause for user model selection |
| Provider auth/quota fails | Pause; never request credentials in cloud UI |
| User cancels | Stop new leases and workflow; preserve retention-independent audit receipt |
| No executor before deadline | `expired`, not `failed`; offer clone |
| Retention deletion partially fails | Retry object deletion; manifest remains `deletion_pending` |

## 19. Observability

### 19.1 Metrics

Product:

- packs sealed by resource kind and sensitivity, without content;
- proposal acceptance, dismissal reason, and edit distance;
- at least one "worth running" proposal per benchmark pack;
- evidence-selector validation failures;
- duplicate-topic rate;
- run completion within bounds;
- time spent waiting for executor;
- provider-attention pauses;
- artifact open/save/action rate;
- deletion completion and overdue deletion count.

Reliability:

- API latency/error rate by operation;
- workflow phase duration and retries;
- event-sequence gaps;
- task lease expiry and replay conflicts;
- WebSocket reconnects and polling fallback use;
- retrieval failures and denied SSRF targets;
- D1, R2, Vectorize, and Queue errors;
- cross-tenant authorization denials.

### 19.2 Logs and traces

Allowed:

- opaque tenant, user, run, task, device, request, and artifact ids;
- schema version;
- phase/status/error code;
- byte and item counts;
- digests;
- latency and reported usage.

Forbidden:

- raw prompts;
- Context Pack text;
- excerpts;
- provider credentials;
- model output content;
- filenames from private resources;
- local filesystem paths;
- chain-of-thought.

## 20. Testing strategy

### 20.1 Protocol conformance

- Every valid fixture parses in Cave and Research Cloud.
- Every invalid fixture is rejected with the same error class.
- Canonical JSON produces identical digests across runtimes.
- Unknown additive fields round-trip.
- Unknown major versions fail.
- Event sequence and idempotency fixtures cover duplicates, gaps, and conflicts.

### 20.2 Local unit tests

- Pack selection includes only explicit resources.
- Resource adapters produce stable snapshots and selectors.
- Atomic store rejects symlinks, traversal, corrupt blobs, and digest mismatch.
- Redaction maps never leak removed text into metadata.
- Topic evidence selectors resolve exactly.
- Visible score is recomputed and risk penalty is subtracted.
- Diversity selection removes near duplicates.
- Discovery cannot call web or write tools.
- Proposal accept returns a draft and never creates a mission.
- Mission v1 reads and mutates into v2 without losing harness/model/artifacts.
- Display state distinguishes waiting, checkpoint, expired, and running.
- Local gateway preserves current Research Mission behavior.

### 20.3 Device executor tests

- Reuse the existing hermetic fake Keychain pattern.
- OpenClaw and Research Cloud credentials cannot collide.
- Private key never appears on argv, logs, events, or result JSON.
- Challenge and result signatures verify.
- Corrupt paired identity fails closed.
- Unsupported platform disables executor.
- Lease validation covers tenant, task, attempt, digest, expiry, and device.
- Late, duplicate, and conflicting results follow the state table.
- Prompt assembly never leaves the device.
- Output filtering removes unallowed fields and hidden reasoning.

### 20.4 Cloud tests

- Every API path enforces tenant identity.
- Direct-id guessing, object-key guessing, omitted vector filters, stale device
  tokens, stale leases, replayed signatures, and event-cursor confusion fail.
- Workflow retries do not duplicate tasks, events, or artifacts.
- Waiting workflows resume from buffered executor/checkpoint events.
- Cancellation stops new leases.
- Retention jobs produce deletion receipts and retry partial failures.
- Redirect chains cannot reach denied networks.
- Queue poison messages reach the dead-letter queue without blocking a run.

### 20.5 End-to-end scenarios

1. Local pack -> local discovery -> accept -> existing local mission completes.
2. Hosted run -> online Cave -> user-connected model -> cloud manifest -> local
   private artifact.
3. Hosted run starts offline -> waits -> Cave reconnects -> resumes.
4. Provider quota failure -> attention state -> user repairs provider -> retry.
5. Cave disconnects mid-task -> lease expires -> the executor restarts on the
   same device and local pack store -> task resumes without duplicate advance.
6. User cancels while waiting -> no later device may lease.
7. Retention expires -> content deleted -> receipt remains.
8. Injection corpus produces no authority or tool escalation.

### 20.6 Evaluation gate

Before enabling topic discovery by default:

- Use 50-100 opt-in Context Packs.
- Generate five proposals per pack.
- Blind-rate groundability, novelty, decision value, resonance, privacy comfort,
  and feasibility.
- Require zero unsupported evidence references.
- Pilot target: at least one proposal rated worth running in 70% of packs.

The 70% value is a launch hypothesis. Adjusting it requires an evaluation
record, not a code-only change.

## 21. Delivery units

### Unit 0 - Protocol and fixtures

Deliver:

- v1 schemas, TypeScript parsers, canonical digest helper, and fixtures;
- Context Pack and Topic Proposal contracts;
- Research Run, Event, Model Task, and Run Manifest contracts;
- conformance test entry point.

Exit criteria:

- Valid/invalid fixture suite passes.
- No provider/cloud implementation names appear in wire schemas.
- Digest output is deterministic.
- Retention-order fixtures reject a run that exceeds its pack consent.

### Unit 1 - Local Context Packs

Deliver:

- selection adapters;
- redaction preview;
- local content-addressed store;
- pack preview and deletion;
- local APIs and UI picker.

Exit criteria:

- A user can seal and reopen a pack containing at least sessions, self-reports,
  missions, artifacts, saved resources, and allowed attachments.
- Original source changes do not alter the sealed pack.
- No network request occurs.

### Unit 2 - Local Topic Discovery

Deliver:

- bounded model-task wrapper;
- mine/challenge/dedupe/score/present pipeline;
- proposal cards and evidence inspector;
- accept-to-composer handoff;
- offline evaluation harness.

Exit criteria:

- Every displayed proposal has valid evidence.
- Discovery has no write or web authority.
- Accepting does not create a mission.
- Starting from the composer binds the pack and creates one mission.

### Unit 3 - Mission v2 and run gateway

Deliver:

- v1-to-v2 additive migration;
- context, execution, privacy, and execution-state fields;
- local gateway;
- hosted gateway contract and fake adapter;
- derived display state and resumable event client.

Exit criteria:

- Existing v1 missions behave unchanged.
- The dual parser lands before v2 writes; disabling Unit 3 features leaves v2
  records readable and locally executable.
- Local conformance tests pass through the gateway.
- UI can render a fake hosted run, including waiting and expired states.

### Unit 4 - Cave Device Executor

Deliver:

- shared device credential extraction;
- Research Cloud keychain namespace;
- registration, challenge, WebSocket/polling, task lease, model execution,
  result signing, retry, and revocation;
- executor status in Research Desk.

Exit criteria:

- Existing OpenClaw tests remain green.
- Device integration tests prove no credential or private prompt leaves Cave.
- Disconnect and replay scenarios pass.
- Lease renewal accepts only the current device/attempt/digest before expiry.

### Unit 5 - Hosted Research Cloud

Deliver:

- authenticated API;
- durable workflow and run coordinator;
- public retrieval and snapshots;
- D1/R2/Vectorize/Queue storage adapters;
- task leases, events, artifacts, retention, and audit;
- cross-tenant and chaos suites.

Exit criteria:

- Units 0-4 conformance scenarios pass against staging.
- Cross-tenant tests have zero unauthorized reads/writes.
- Offline run visibly waits and later resumes.
- V1 failover is limited to an executor that already possesses the exact local
  Context Pack. Cross-device pack transfer remains deferred.
- Deletion receipts complete within the declared policy window.
- No provider credentials are accepted by any v1 endpoint.

### Unit 6 - MCP and scheduled discovery

This unit begins only after the HTTP/event contract is stable.

Deliver:

- read-only MCP resources for sealed packs and proposals;
- scheduled discovery for explicit saved views;
- finite notification digest;
- no automatic research launch.

## 22. Rollout and compatibility

1. Ship Unit 0 behind no UI flag.
2. Ship Unit 1 behind `researchContextPacks`.
3. Ship Unit 2 behind `researchTopicDiscovery` to opt-in evaluators.
4. Promote local discovery after the evaluation gate.
5. Ship Unit 3 with the local gateway selected for every existing mission.
6. Ship Unit 4 disabled until account pairing and supported credential storage
   are available.
7. Enable hosted staging for internal tenants.
8. Enable hosted beta per account, with remote queries and artifact sync shown
   as separate controls.
9. Keep local execution first-class; do not make cloud availability a
   prerequisite for Research Desk.

Rollback:

- Units 1 and 2 can be disabled without changing existing missions.
- Unit 3 falls back to `LocalResearchRunGateway`.
- Device Executor disconnects and releases leases; it does not delete local
  packs.
- Hosted beta disablement prevents new runs but leaves existing runs readable
  and cancellable until retention completes.

## 23. Acceptance criteria

The implementation is complete only when all of the following are true:

1. A user can explicitly select, preview, redact, seal, reopen, and delete a
   local Context Pack.
2. A sealed pack is immutable and content-addressed.
3. Local discovery returns 3-7 proposals or a typed
   `no_grounded_proposals` failure.
4. Every displayed evidence excerpt resolves to its sealed resource selector.
5. Topic scores are visible and recomputed by Cave.
6. Discovery cannot perform web search, writes, mission creation, publication,
   task creation, or memory promotion.
7. Accepting a proposal opens an editable mission draft.
8. Starting the draft creates exactly one mission with Context Pack lineage.
9. Existing version 1 missions remain readable and executable.
10. Local and hosted run gateways pass the same lifecycle conformance tests.
11. A hosted run uses the user's Cave-selected familiar/model/provider without
    sending provider credentials to Research Cloud.
12. A run with no executor displays `waiting_for_executor`.
13. Reconnecting an authorized executor resumes from durable state without
    duplicating work.
14. Event cursors resume without loss or duplicate state transitions.
15. Duplicate requests and results are idempotent; conflicting replays fail.
16. Private pack blobs and full prompts do not appear in cloud storage, logs,
    traces, events, or error messages by default.
17. Cross-tenant authorization tests pass on every storage and retrieval path.
18. Cancellation, retention, deletion, and artifact sync remain separate
    operations.
19. Provider usage is reported only when supplied by the runtime.
20. Final completion includes an immutable Run Manifest with source, artifact,
    model, usage, retention, and deletion status.

## 24. Explicitly deferred decisions

These do not block Units 0-5:

- OpenCoven-hosted delegated provider credentials.
- Remote upload of raw sessions or private attachments.
- Cross-device encrypted Context Pack sync.
- Automatic failover to a different device that does not already possess the
  sealed Context Pack.
- Windows Credential Manager and Linux Secret Service implementations.
- Automatic multi-agent strategy selection beyond an explicit run profile.
- Memory promotion from research output.
- Training on proposal acceptance, edits, or dismissal.
- A permanent standalone protocol repository.

Each deferred capability requires a separate design and consent review. None
may be introduced as an additive endpoint under the v1 privacy promise.

## 25. Design review checklist

- [x] The useful first release is local and independently shippable.
- [x] Protocol objects are provider- and cloud-neutral.
- [x] Context, research evidence, and artifacts have separate provenance.
- [x] Private content and provider credentials remain local by default.
- [x] Offline behavior is explicit.
- [x] Existing Research Mission behavior has a backward-compatible path.
- [x] Security controls live at domain and storage boundaries.
- [x] Failure states are typed and recovery behavior is defined.
- [x] Test and rollout gates are measurable.
- [x] Deferred capabilities cannot silently weaken v1 consent.
