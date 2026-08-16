# Research Protocol Unit 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the provider-neutral Research Run Protocol v1 as authoritative JSON Schemas, hand-written TypeScript parsers, canonical SHA-256 digests, shared fixtures, and a cross-environment conformance suite.

**Architecture:** Keep wire contracts in `schemas/research/v1/` and runtime code in small modules under `src/lib/research-protocol/`. JSON Schemas define the accepted wire shape; TypeScript parsers independently validate the same fixtures, preserve unknown additive fields, and enforce semantic rules that JSON Schema cannot express cleanly. Unit 0 does not modify Research Mission persistence, UI, local storage, device execution, or cloud APIs.

**Tech Stack:** TypeScript 6, Node.js 24 test runner, `canonicalize@3.0.0` for RFC 8785 canonical JSON, `node:crypto` SHA-256, `typebox/value` for JSON Schema fixture checks, pnpm 10.

**Source specification:** `docs/superpowers/specs/2026-08-15-externalized-research-desk-implementation-design.md` §§7-8, 20.1, and 21 Unit 0.

---

## File structure

Create these focused modules:

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
      context-pack.json
      topic-discovery-job.json
      topic-proposal.json
      research-run.json
      run-event.json
      model-task.json
      model-task-result.json
      run-manifest-assembling.json
      run-manifest-final-local.json
      run-manifest-final-cloud.json
      run-manifest-retention-update.json
    invalid/
      unknown-major.json
      context-pack-retention.json
      context-pack-pdf-selector.json
      topic-proposal-score.json
      research-run-waiting-phase.json
      run-event-sequence.json
      model-task-policy.json
      model-task-result-usage.json
      run-manifest-previous-digest.json
      run-manifest-final-mutation.json
      run-manifest-deletion-pair.json
      run-manifest-private-title.json
src/lib/research-protocol/
  common.ts
  digest.ts
  context-pack.ts
  topic-discovery.ts
  research-run.ts
  model-task.ts
  run-manifest.ts
  index.ts
  digest.test.ts
  context-pack.test.ts
  topic-discovery.test.ts
  research-run.test.ts
  model-task.test.ts
  run-manifest.test.ts
scripts/
  research-protocol-conformance.test.ts
```

Responsibilities:

- `common.ts`: shared primitive guards, timestamp/id rules, parse result/error types, retention ordering, and unknown-field preservation.
- `digest.ts`: RFC 8785 canonicalization and SHA-256 helpers.
- `context-pack.ts`: selectors, resources, Context Pack types and parser.
- `topic-discovery.ts`: model receipts, discovery jobs, evidence refs, proposals, and score recomputation.
- `research-run.ts`: execution bindings, privacy policy, run, event, and bounds parsers.
- `model-task.ts`: Model Task/result parsers and signed-payload projection.
- `run-manifest.ts`: artifact/source/usage/retention/deletion parsing plus revision-chain validation.
- `index.ts`: public exports and schema-string dispatcher.
- `research-protocol-conformance.test.ts`: runs every fixture through both its JSON Schema and TypeScript parser.

Do not add a generated-code step or a new dependency. Do not import server, React, mission-store, or provider modules into `src/lib/research-protocol/`.

**Execution precondition:** Commit the amended specification and this plan,
then execute Unit 0 in a dedicated worktree. Do not implement from the current
dirty `main` worktree, and do not stage `.beads/interactions.jsonl`,
`pnpm-lock.yaml`, or `WORKTREE-SWEEP-2026-08-15-READ-ME.md` unless a later task
explicitly owns those files.

### Task 1: Shared validation and canonical digests

**Files:**
- Create: `src/lib/research-protocol/common.ts`
- Create: `src/lib/research-protocol/digest.ts`
- Create: `src/lib/research-protocol/digest.test.ts`
- Modify: `scripts/run-tests.mjs:1728-1733`

- [ ] **Step 1: Write the failing digest tests**

Create `src/lib/research-protocol/digest.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  digestProtocolObject,
  sha256Digest,
} from "./digest.ts";

test("canonical JSON is stable across property insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, b: 3 } }),
    canonicalJson({ a: { b: 3, y: 2 }, z: 1 }),
  );
});

test("protocol object digest omits only its own digest field", () => {
  const left = {
    schema: "opencoven.context-pack/v1",
    id: "ctx_1",
    digest: "old-value",
    child: { digest: "child-value" },
  };
  const right = {
    schema: "opencoven.context-pack/v1",
    id: "ctx_1",
    child: { digest: "child-value" },
  };
  assert.equal(digestProtocolObject(left), digestProtocolObject(right));
  assert.notEqual(
    digestProtocolObject(left),
    digestProtocolObject({ ...right, child: { digest: "changed" } }),
  );
});

test("SHA-256 uses lowercase hexadecimal", () => {
  assert.equal(
    sha256Digest("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

test("non-JSON values fail canonicalization", () => {
  assert.throws(() => canonicalJson({ value: undefined }), /canonical JSON/i);
  assert.throws(() => canonicalJson({ value: Number.NaN }), /canonical JSON/i);
});
```

- [ ] **Step 2: Wire the test and verify it fails**

Append the test path to the `conformance` array in `scripts/run-tests.mjs`:

```js
conformance: [
  "scripts/cross-environment.test.ts",
  "scripts/daemon-connectivity-faults.test.ts",
  "scripts/windows-native-browser-regression.test.mjs",
  "scripts/cave-home-migration-windows.test.ts",
  "src/lib/research-protocol/digest.test.ts",
],
```

Run:

```bash
pnpm test:conformance
```

Expected: FAIL because `src/lib/research-protocol/digest.ts` does not exist.

- [ ] **Step 3: Implement shared guards and parse errors**

Create `src/lib/research-protocol/common.ts`:

```ts
export type UnknownFields = Record<string, unknown>;

export type ProtocolErrorCode =
  | "invalid_type"
  | "invalid_value"
  | "missing_field"
  | "unknown_major"
  | "digest_mismatch"
  | "semantic_conflict";

export type ProtocolParseError = {
  code: ProtocolErrorCode;
  path: string;
  message: string;
};

export type ProtocolParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProtocolParseError };

export const RETENTION_ORDER = {
  "run-only": 0,
  "7-days": 1,
  project: 2,
} as const;

export type RetentionPolicyV1 = keyof typeof RETENTION_ORDER;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    && value.endsWith("Z")
    && new Date(parsed).toISOString() === value;
}

export function isOpaqueId(value: unknown, prefix: string): value is string {
  return typeof value === "string"
    && value.startsWith(`${prefix}_`)
    && /^[a-z0-9][a-z0-9_-]*$/i.test(value);
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function retentionDoesNotExceed(
  requested: RetentionPolicyV1,
  consented: RetentionPolicyV1,
): boolean {
  return RETENTION_ORDER[requested] <= RETENTION_ORDER[consented];
}

export function fail<T>(
  code: ProtocolErrorCode,
  path: string,
  message: string,
): ProtocolParseResult<T> {
  return { ok: false, error: { code, path, message } };
}

export function pass<T>(value: T): ProtocolParseResult<T> {
  return { ok: true, value };
}

export type ResearchContextBindingV1 = {
  contextPackId: string;
  contextPackDigest: string;
  topicProposalId?: string;
};
```

Parser modules must spread the source record first and validated known fields second:

```ts
return pass({
  ...value,
  schema: "opencoven.example/v1",
  id: value.id,
});
```

This preserves unknown additive fields while preventing unvalidated values from replacing known fields.

- [ ] **Step 4: Implement canonicalization and hashing**

Create `src/lib/research-protocol/digest.ts`:

```ts
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { isRecord } from "./common.ts";

function assertJsonValue(value: unknown, path = "$"): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is not canonical JSON`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(entry, `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(`${path} is not canonical JSON`);
}

export function canonicalJson(value: unknown): string {
  assertJsonValue(value);
  const canonical = canonicalize(value);
  if (typeof canonical !== "string") {
    throw new TypeError("Value cannot be represented as canonical JSON");
  }
  return canonical;
}

export function sha256Digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digestProtocolObject(value: unknown): string {
  if (!isRecord(value)) {
    throw new TypeError("Protocol digest input must be an object");
  }
  const { digest: _ownDigest, ...digestInput } = value;
  return sha256Digest(canonicalJson(digestInput));
}
```

- [ ] **Step 5: Run the focused test and typecheck**

Run:

```bash
node --experimental-strip-types --test src/lib/research-protocol/digest.test.ts
pnpm typecheck
```

Expected: all digest tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/research-protocol/common.ts \
  src/lib/research-protocol/digest.ts \
  src/lib/research-protocol/digest.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(research): add protocol digest primitives"
```

### Task 2: Context Pack schema and parser

**Files:**
- Create: `schemas/research/v1/context-pack.schema.json`
- Create: `schemas/research/v1/fixtures/valid/context-pack.json`
- Create: `schemas/research/v1/fixtures/invalid/context-pack-retention.json`
- Create: `schemas/research/v1/fixtures/invalid/context-pack-pdf-selector.json`
- Create: `src/lib/research-protocol/context-pack.ts`
- Create: `src/lib/research-protocol/context-pack.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Create one valid and one invalid fixture**

The valid fixture must contain:

```json
{
  "schema": "opencoven.context-pack/v1",
  "id": "ctx_01",
  "digest": "f1a36e4a3e458fbb62c3e868988c0b3ed735efca17b994216e1a78f050891d5f",
  "createdAt": "2026-08-15T20:00:00.000Z",
  "createdBy": { "client": "coven-cave" },
  "purpose": "research-run",
  "subject": { "familiarId": "sage", "projectId": "project_01" },
  "consent": {
    "selectionMode": "explicit",
    "allowRemoteQueries": true,
    "allowRemoteContent": false,
    "artifactContentSync": false,
    "retention": "7-days"
  },
  "resources": [
    {
      "id": "resource_01",
      "kind": "session",
      "uri": "coven://session/session_01",
      "digest": "0b9c966e9a7c4831f255cebbba0e7726fc8410ed32998179b32221097b404f9b",
      "localBlobDigest": "4b94f5f75ee88c0e995251afe98fb468499215b33bbb6c18d01b1dd583f69e9d",
      "selector": { "type": "turn-range", "start": 2, "end": 5 },
      "trust": "mixed-conversation",
      "sensitivity": "private",
      "capturedAt": "2026-08-15T19:59:00.000Z",
      "title": "Selected research discussion",
      "mediaType": "application/json"
    }
  ],
  "policy": {
    "treatResourceTextAsData": true,
    "toolAuthority": "none",
    "allowedPurposes": ["research-run"]
  },
  "transforms": { "secretScanVersion": "1" },
  "futureExtension": { "preserve": true }
}
```

Create `context-pack-retention.json` by copying the fixture and changing `consent.retention` to `"forever"`.

Create `context-pack-pdf-selector.json` by copying the fixture, changing the
resource kind to `"artifact"`, the media type to `"application/pdf"`, and the
selector to:

```json
{ "type": "pdf-page-span", "page": 0, "start": 12, "end": 12 }
```

It is invalid because pages are one-based and evidence spans must be non-empty.

- [ ] **Step 2: Write the failing parser tests**

Create `src/lib/research-protocol/context-pack.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import invalidPdfSelector from "../../../schemas/research/v1/fixtures/invalid/context-pack-pdf-selector.json" with { type: "json" };
import invalidRetention from "../../../schemas/research/v1/fixtures/invalid/context-pack-retention.json" with { type: "json" };
import validContextPack from "../../../schemas/research/v1/fixtures/valid/context-pack.json" with { type: "json" };
import {
  parseContextPackV1,
  parseContextSelectorV1,
} from "./context-pack.ts";

test("parses a Context Pack and preserves additive fields", () => {
  const result = parseContextPackV1(validContextPack);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.futureExtension, { preserve: true });
});

test("rejects an unknown retention policy", () => {
  const result = parseContextPackV1(invalidRetention);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.path, "$.consent.retention");
});

test("enforces selector-specific bounds", () => {
  assert.equal(parseContextSelectorV1({ type: "turn-range", start: 2, end: 2 }).ok, false);
  assert.equal(parseContextSelectorV1({ type: "turn-range", start: 2, end: 3 }).ok, true);
  assert.equal(parseContextSelectorV1({ type: "turn-range", start: 3, end: 2 }).ok, false);
  assert.equal(parseContextSelectorV1({ type: "json-pointer", pointer: "/items/0" }).ok, true);
  assert.equal(parseContextSelectorV1({ type: "json-pointer", pointer: "items/0" }).ok, false);
  assert.equal(parseContextSelectorV1({ type: "markdown-section", headingPath: [] }).ok, false);
  assert.equal(
    parseContextSelectorV1({ type: "text-span", start: 0, end: 12 }).ok,
    true,
  );
  assert.equal(
    parseContextSelectorV1({ type: "text-span", start: 12, end: 12 }).ok,
    false,
  );
  assert.equal(
    parseContextSelectorV1({ type: "pdf-page-span", page: 1, start: 0, end: 12 }).ok,
    true,
  );
  assert.equal(
    parseContextSelectorV1({ type: "pdf-page-span", page: 0, start: 0, end: 12 }).ok,
    false,
  );
  assert.equal(parseContextPackV1(invalidPdfSelector).ok, false);
});
```

Add `src/lib/research-protocol/context-pack.test.ts` to the conformance suite.

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types --test src/lib/research-protocol/context-pack.test.ts
```

Expected: FAIL because `context-pack.ts` does not exist.

- [ ] **Step 4: Create the authoritative Context Pack schema**

Create a Draft 2020-12 schema with `$id: "opencoven.context-pack/v1"` and:

- `additionalProperties: true` on every object.
- Required fields exactly matching §8.1.
- `const` for `schema`, `createdBy.client`, `policy.treatResourceTextAsData`, and `policy.toolAuthority`.
- SHA-256 strings constrained by `^[a-f0-9]{64}$`.
- UTC timestamps constrained with `format: "date-time"` plus `pattern: "Z$"`.
- Opaque ids constrained by the corresponding prefixes: `ctx_`, `resource_`.
- Selector `oneOf` branches for all six selector types.
- Non-negative integer selector positions and `minItems: 1` for `headingPath`.
- `uniqueItems: true` and `minItems: 1` for `policy.allowedPurposes`.
- Exact enums from §8.1 for purpose, selection mode, retention, resource kind, trust, and sensitivity.

The schema cannot express `start < end`; the TypeScript parser must enforce it.

- [ ] **Step 5: Implement Context Pack parsing**

Create the exported types exactly as written in §8.1 and implement:

```ts
export function parseContextSelectorV1(
  value: unknown,
  path = "$.selector",
): ProtocolParseResult<ContextSelectorV1>;

export function parseContextPackResourceV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ContextPackResourceV1>;

export function parseContextPackV1(
  value: unknown,
): ProtocolParseResult<ContextPackV1>;
```

Enforce:

- Unknown `schema` major returns `unknown_major`.
- All required booleans are real booleans, not truthy values.
- `turn-range` uses zero-based safe non-negative turn indexes and `start < end`.
- JSON pointers are `""` or begin with `/`.
- `text-span` uses zero-based UTF-8 byte offsets and `start < end`.
- Markdown heading paths contain at least one non-empty string.
- `pdf-page-span` uses a one-based safe integer page and zero-based UTF-8 byte
  offsets with `start < end`.
- Resource arrays contain unique resource ids.
- `allowedPurposes` contains the pack's own `purpose`.
- Every digest is lowercase SHA-256.
- Every timestamp passes `isUtcTimestamp`.
- Unknown fields survive in the returned object.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
node --experimental-strip-types --test src/lib/research-protocol/context-pack.test.ts
pnpm typecheck
```

Expected: PASS.

```bash
git add schemas/research/v1/context-pack.schema.json \
  schemas/research/v1/fixtures/valid/context-pack.json \
  schemas/research/v1/fixtures/invalid/context-pack-retention.json \
  schemas/research/v1/fixtures/invalid/context-pack-pdf-selector.json \
  src/lib/research-protocol/context-pack.ts \
  src/lib/research-protocol/context-pack.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(research): define Context Pack protocol"
```

### Task 3: Topic discovery schemas and parsers

**Files:**
- Create: `schemas/research/v1/topic-discovery-job.schema.json`
- Create: `schemas/research/v1/topic-proposal.schema.json`
- Create: `schemas/research/v1/fixtures/valid/topic-discovery-job.json`
- Create: `schemas/research/v1/fixtures/valid/topic-proposal.json`
- Create: `schemas/research/v1/fixtures/invalid/topic-proposal-score.json`
- Create: `src/lib/research-protocol/topic-discovery.ts`
- Create: `src/lib/research-protocol/topic-discovery.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing score and lifecycle tests**

Create `src/lib/research-protocol/topic-discovery.test.ts` with:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTopicDiscoveryJobV1,
  parseTopicProposalV1,
  topicProposalVisibleTotal,
} from "./topic-discovery.ts";

const scores = {
  groundability: 4,
  decisionValue: 3,
  unresolvedness: 2,
  recurrence: 1,
  novelty: 4,
  timeliness: 2,
  familiarFit: 4,
  feasibility: 3,
  humanResonance: 4,
  riskPenalty: 2,
  visibleTotal: 25,
};

test("recomputes the visible proposal score", () => {
  assert.equal(topicProposalVisibleTotal(scores), 25);
  assert.equal(parseTopicProposalV1({
    schema: "opencoven.topic-proposal/v1",
    id: "proposal_01",
    discoveryJobId: "topicjob_01",
    contextPackId: "ctx_01",
    title: "A grounded question",
    question: "Which evidence should guide the decision?",
    whyNow: "The source set contains unresolved disagreement.",
    evidence: [{
      resourceId: "resource_01",
      selector: { type: "text-span", start: 0, end: 20 },
      excerpt: "Evidence excerpt",
      excerptDigest: "84e3d621a6705b03cc38559364169efff401aa7155f85cecd46b51660dd1ae42",
    }],
    counterevidence: [],
    scores,
    suggested: {
      mode: "brief",
      deliverable: "Decision brief",
      sourceTarget: 8,
      wallClockMinutes: 30,
    },
    uncertainty: "One source may be stale.",
    relatedMissionIds: [],
    createdAt: "2026-08-15T20:05:00.000Z",
  }).ok, true);
});

test("rejects a model-supplied total that does not recompute", () => {
  const invalid = { ...scores, visibleTotal: 26 };
  assert.equal(topicProposalVisibleTotal(invalid), 25);
});

test("requires lifecycle timestamps when their state has begun", () => {
  const result = parseTopicDiscoveryJobV1({
    schema: "opencoven.topic-discovery-job/v1",
    id: "topicjob_01",
    contextPackId: "ctx_01",
    contextPackDigest: "f1a36e4a3e458fbb62c3e868988c0b3ed735efca17b994216e1a78f050891d5f",
    familiarId: "sage",
    status: "running",
    requestedAt: "2026-08-15T20:00:00.000Z",
    proposalIds: [],
  });
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Add the test to `conformance`, then run:

```bash
node --experimental-strip-types --test src/lib/research-protocol/topic-discovery.test.ts
```

Expected: FAIL because `topic-discovery.ts` does not exist.

- [ ] **Step 3: Create both schemas and fixtures**

Encode §8.2 and §8.3 exactly. Apply these additional constraints:

- ids use `topicjob_`, `proposal_`, `ctx_`, `resource_`, and `mission_` prefixes;
- all ten component scores are integers from 0 through 4;
- evidence has `minItems: 1`;
- excerpt digests are lowercase SHA-256;
- suggested source target and wall-clock minutes are positive safe integers;
- proposal ids and related mission ids are unique;
- a running job requires `startedAt`;
- completed, failed, or cancelled jobs require `finishedAt`;
- a completed job has no `failure`;
- a failed job requires `failure`;
- `modelReceipt` uses the exact receipt shape in §8.7.

Set the invalid score fixture's `groundability` to `5`.

- [ ] **Step 4: Implement receipts, jobs, proposals, and score recomputation**

Export:

```ts
export type ResearchModelReceiptV1 = {
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

export function parseResearchModelReceiptV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ResearchModelReceiptV1>;

export function parseTopicDiscoveryJobV1(
  value: unknown,
): ProtocolParseResult<TopicDiscoveryJobV1>;

export function topicProposalVisibleTotal(
  scores: TopicProposalV1["scores"],
): number;

export function parseTopicProposalV1(
  value: unknown,
): ProtocolParseResult<TopicProposalV1>;
```

`topicProposalVisibleTotal` sums the nine positive dimensions and subtracts `riskPenalty`. `parseTopicProposalV1` rejects a mismatched `visibleTotal`; it does not silently replace it.

For usage, enforce non-negative safe integer token counts, non-negative finite cost, and:

- `reportedByRuntime: false` requires all three values to be `null`;
- `reportedByRuntime: true` requires at least one non-null value.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
node --experimental-strip-types --test src/lib/research-protocol/topic-discovery.test.ts
pnpm typecheck
```

Expected: PASS.

```bash
git add schemas/research/v1/topic-discovery-job.schema.json \
  schemas/research/v1/topic-proposal.schema.json \
  schemas/research/v1/fixtures/valid/topic-discovery-job.json \
  schemas/research/v1/fixtures/valid/topic-proposal.json \
  schemas/research/v1/fixtures/invalid/topic-proposal-score.json \
  src/lib/research-protocol/topic-discovery.ts \
  src/lib/research-protocol/topic-discovery.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(research): define topic discovery protocol"
```

### Task 4: Research Run and ordered event contracts

**Files:**
- Create: `schemas/research/v1/research-run.schema.json`
- Create: `schemas/research/v1/run-event.schema.json`
- Create: `schemas/research/v1/fixtures/valid/research-run.json`
- Create: `schemas/research/v1/fixtures/valid/run-event.json`
- Create: `schemas/research/v1/fixtures/invalid/research-run-waiting-phase.json`
- Create: `schemas/research/v1/fixtures/invalid/run-event-sequence.json`
- Modify: `src/lib/research-protocol/common.ts`
- Create: `src/lib/research-protocol/research-run.ts`
- Create: `src/lib/research-protocol/research-run.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing semantic tests**

Create tests covering:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseResearchRunV1,
  parseRunEventV1,
  validateRunEventSequence,
} from "./research-run.ts";

test("waiting_for_executor requires a resumable model phase", () => {
  const result = parseResearchRunV1({
    schema: "opencoven.research-run/v1",
    id: "run_01",
    acceptedTopic: {
      question: "What should we research?",
      editedByUser: false,
    },
    execution: {
      location: "hosted",
      modelExecution: "cave-device",
      modelBinding: {
        familiarId: "sage",
        selection: "resolve-at-run-start",
      },
      strategy: "single-agent",
    },
    privacy: {
      remoteQueries: true,
      remoteContent: false,
      artifactContentSync: false,
      retention: "run-only",
      allowMemoryPromotion: false,
    },
    bounds: {
      wallClockMinutes: 30,
      maxIterations: 1,
      sourceTarget: 5,
      checkpointEvery: 1,
      stopWhenCostUnavailable: true,
    },
    status: "waiting_for_executor",
    waitingReason: "executor",
    createdAt: "2026-08-15T20:00:00.000Z",
    updatedAt: "2026-08-15T20:01:00.000Z",
    nextEventSequence: 2,
  });
  assert.equal(result.ok, false);
});

test("ordered events accept contiguous sequence and reject a gap", () => {
  const first = {
    schema: "opencoven.run-event/v1",
    runId: "run_01",
    sequence: 1,
    type: "run.created",
    at: "2026-08-15T20:00:00.000Z",
    data: {},
  } as const;
  const second = { ...first, sequence: 2, type: "run.status" as const };
  assert.equal(parseRunEventV1(first).ok, true);
  assert.equal(validateRunEventSequence([first, second]).ok, true);
  assert.equal(validateRunEventSequence([first, { ...second, sequence: 3 }]).ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Add the test to `conformance`, then run it directly. Expected: missing-module failure.

- [ ] **Step 3: Create run and event schemas**

Encode §§8.4-8.6 and:

- allow `context` to be absent;
- make `allowMemoryPromotion` a literal `false`;
- require pinned model selection to include `model`;
- reject a `model` field for `resolve-at-run-start`;
- constrain all `ResearchBounds` counts to positive safe integers and `maxSpendUsd` to a non-negative finite number;
- constrain `nextEventSequence` and event `sequence` to integers at least `1`;
- allow `artifactManifest` through a `$ref` to `run-manifest.schema.json`;
- require `waitingForPhase` exactly when status is `waiting_for_executor`;
- allow `waitingReason: "checkpoint"` only with `awaiting_checkpoint`;
- require `failure` only for `failed`;
- leave event `data` open with `additionalProperties: true`.

- [ ] **Step 4: Implement run and event parsing**

Export the types from §§8.4-8.6. Add
`parseResearchContextBindingV1` beside `ResearchContextBindingV1` in
`common.ts` so `research-run.ts` and `run-manifest.ts` do not import each
other in both directions:

```ts
export function parseResearchContextBindingV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ResearchContextBindingV1>;

export function parseResearchExecutionProfileV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ResearchExecutionProfileV1>;

export function parseResearchPrivacyPolicyV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ResearchPrivacyPolicyV1>;

export function parseResearchRunV1(
  value: unknown,
): ProtocolParseResult<ResearchRunV1>;

export function parseRunEventV1(
  value: unknown,
): ProtocolParseResult<RunEventV1>;

export function validateRunEventSequence(
  events: readonly RunEventV1[],
): ProtocolParseResult<readonly RunEventV1[]>;
```

`validateRunEventSequence` must require one `runId`, start at sequence `1`, and increase by exactly one. It must return `semantic_conflict` at the first mismatch.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
node --experimental-strip-types --test src/lib/research-protocol/research-run.test.ts
pnpm typecheck
```

Expected: PASS.

```bash
git add schemas/research/v1/research-run.schema.json \
  schemas/research/v1/run-event.schema.json \
  schemas/research/v1/fixtures/valid/research-run.json \
  schemas/research/v1/fixtures/valid/run-event.json \
  schemas/research/v1/fixtures/invalid/research-run-waiting-phase.json \
  schemas/research/v1/fixtures/invalid/run-event-sequence.json \
  src/lib/research-protocol/common.ts \
  src/lib/research-protocol/research-run.ts \
  src/lib/research-protocol/research-run.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(research): define run and event protocol"
```

### Task 5: Model Task, result, and signature payload

**Files:**
- Create: `schemas/research/v1/model-task.schema.json`
- Create: `schemas/research/v1/model-task-result.schema.json`
- Create: `schemas/research/v1/fixtures/valid/model-task.json`
- Create: `schemas/research/v1/fixtures/valid/model-task-result.json`
- Create: `schemas/research/v1/fixtures/invalid/model-task-policy.json`
- Create: `schemas/research/v1/fixtures/invalid/model-task-result-usage.json`
- Create: `src/lib/research-protocol/model-task.ts`
- Create: `src/lib/research-protocol/model-task.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing task/result tests**

Create tests that assert:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  modelTaskResultSignaturePayload,
  parseModelTaskResultV1,
  parseModelTaskV1,
} from "./model-task.ts";

test("projects exactly the signed result fields", () => {
  const result = {
    schema: "opencoven.model-task-result/v1",
    taskId: "modeltask_01",
    runId: "run_01",
    attempt: 1,
    inputDigest: "89f8f6710042193f16a5cd49f3ae469f299f00a9efbee7f0bfa037dcae0efb97",
    output: { decision: "continue" },
    outputDigest: "91e75aca0a4f002ecb264c4d13e1e52ce4a584b709821b58f6c20db38127d8f6",
    executorDeviceId: "device_01",
    modelReceipt: {
      familiarId: "sage",
      runtime: "copilot",
      effectiveModel: "gpt-5.6-sol",
      modelSource: "session",
      providerBilling: "user-connected",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        costUsd: null,
        reportedByRuntime: true,
      },
    },
    completedAt: "2026-08-15T20:10:00.000Z",
    signature: "base64-signature",
  } as const;
  assert.equal(parseModelTaskResultV1(result).ok, true);
  assert.deepEqual(modelTaskResultSignaturePayload(result), {
    taskId: "modeltask_01",
    runId: "run_01",
    attempt: 1,
    inputDigest: result.inputDigest,
    outputDigest: result.outputDigest,
    executorDeviceId: "device_01",
    completedAt: "2026-08-15T20:10:00.000Z",
  });
});

test("read permission is mandatory", () => {
  assert.equal(parseModelTaskV1({
    schema: "opencoven.model-task/v1",
    id: "modeltask_01",
    runId: "run_01",
    phase: "scope",
    attempt: 1,
    inputDigest: "89f8f6710042193f16a5cd49f3ae469f299f00a9efbee7f0bfa037dcae0efb97",
    input: {
      contextPack: {
        id: "ctx_01",
        digest: "f1a36e4a3e458fbb62c3e868988c0b3ed735efca17b994216e1a78f050891d5f",
        availability: "device-local",
      },
      publicEvidenceRefs: [],
    },
    modelBinding: {
      familiarId: "sage",
      selection: "resolve-at-run-start",
    },
    policy: {
      permissionMode: "write",
      allowedOutputs: ["scope"],
      allowRemoteQueries: false,
      maxOutputTokens: 1000,
    },
    outputSchema: "opencoven.scope-output/v1",
    leaseExpiresAt: "2026-08-15T20:15:00.000Z",
  }).ok, false);
});
```

- [ ] **Step 2: Create schemas and fixtures**

Encode §8.7 exactly and enforce:

- `attempt` is an integer at least `1`;
- `inputDigest` and `outputDigest` are lowercase SHA-256;
- `permissionMode` is literal `"read"`;
- `allowedOutputs` is a non-empty unique string array;
- `maxOutputTokens` is a positive safe integer;
- public evidence refs are unique opaque strings;
- signature is a non-empty string;
- output is an open object;
- `leaseExpiresAt` and `completedAt` are UTC timestamps;
- model receipt usage follows Task 3 semantics.

- [ ] **Step 3: Implement parsers and signature projection**

Export:

```ts
export type ModelTaskResultSignaturePayloadV1 = Pick<
  ModelTaskResultV1,
  | "taskId"
  | "runId"
  | "attempt"
  | "inputDigest"
  | "outputDigest"
  | "executorDeviceId"
  | "completedAt"
>;

export function parseModelTaskV1(
  value: unknown,
): ProtocolParseResult<ModelTaskV1>;

export function parseModelTaskResultV1(
  value: unknown,
): ProtocolParseResult<ModelTaskResultV1>;

export function modelTaskResultSignaturePayload(
  value: ModelTaskResultV1,
): ModelTaskResultSignaturePayloadV1 {
  return {
    taskId: value.taskId,
    runId: value.runId,
    attempt: value.attempt,
    inputDigest: value.inputDigest,
    outputDigest: value.outputDigest,
    executorDeviceId: value.executorDeviceId,
    completedAt: value.completedAt,
  };
}
```

The parser validates structure and digest syntax only. It does not verify the Ed25519 signature or recalculate `outputDigest`; those operations require executor keys and the declared output schema and belong to Unit 4.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
node --experimental-strip-types --test src/lib/research-protocol/model-task.test.ts
pnpm typecheck
```

Expected: PASS.

```bash
git add schemas/research/v1/model-task.schema.json \
  schemas/research/v1/model-task-result.schema.json \
  schemas/research/v1/fixtures/valid/model-task.json \
  schemas/research/v1/fixtures/valid/model-task-result.json \
  schemas/research/v1/fixtures/invalid/model-task-policy.json \
  schemas/research/v1/fixtures/invalid/model-task-result-usage.json \
  src/lib/research-protocol/model-task.ts \
  src/lib/research-protocol/model-task.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(research): define model task protocol"
```

### Task 6: Run Manifest parsing and revision invariants

**Files:**
- Create: `schemas/research/v1/run-manifest.schema.json`
- Create: `schemas/research/v1/fixtures/valid/run-manifest-assembling.json`
- Create: `schemas/research/v1/fixtures/valid/run-manifest-final-local.json`
- Create: `schemas/research/v1/fixtures/valid/run-manifest-final-cloud.json`
- Create: `schemas/research/v1/fixtures/valid/run-manifest-retention-update.json`
- Create: all five invalid Run Manifest fixtures listed in the file map
- Create: `src/lib/research-protocol/run-manifest.ts`
- Create: `src/lib/research-protocol/run-manifest.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing usage and deletion-state tests**

Create tests for deterministic usage:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import finalManifestJson from "../../../schemas/research/v1/fixtures/valid/run-manifest-final-local.json" with { type: "json" };
import {
  aggregateManifestUsage,
  parseRunManifestV1,
  validateRunManifestRevision,
} from "./run-manifest.ts";

test("classifies zero model executions as unreported", () => {
  assert.deepEqual(aggregateManifestUsage([]), {
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    completeness: "unreported",
  });
});

test("aggregates only reported values and marks gaps partial", () => {
  const executions = [
    {
      taskId: "modeltask_01",
      phase: "scope" as const,
      attempt: 1,
      inputDigest: "89f8f6710042193f16a5cd49f3ae469f299f00a9efbee7f0bfa037dcae0efb97",
      outputDigest: "91e75aca0a4f002ecb264c4d13e1e52ce4a584b709821b58f6c20db38127d8f6",
      receipt: {
        familiarId: "sage",
        runtime: "copilot",
        effectiveModel: "gpt-5.6-sol",
        modelSource: "session" as const,
        providerBilling: "user-connected" as const,
        usage: {
          inputTokens: 100,
          outputTokens: null,
          costUsd: null,
          reportedByRuntime: true,
        },
      },
    },
  ];
  assert.deepEqual(aggregateManifestUsage(executions), {
    inputTokens: 100,
    outputTokens: null,
    costUsd: null,
    completeness: "partial",
  });
});

test("rejects post-finalization artifact mutation", () => {
  const parsed = parseRunManifestV1(finalManifestJson);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const previous = parsed.value;
  const next = {
    ...previous,
    digest: "f2f086f40df9dc520fad5ecb0c9050c569d96bed108054b4c6f5cfbbd184e21d",
    revision: previous.revision + 1,
    previousDigest: previous.digest,
    artifacts: [{ ...previous.artifacts[0], title: "Changed" }],
  };
  assert.equal(validateRunManifestRevision(previous, next).ok, false);
});
```

- [ ] **Step 2: Create the Run Manifest schema**

Encode §8.8 exactly. Include:

- `revision` integer at least `1`;
- revision `1` forbids `previousDigest`; later revisions require it;
- assembling state forbids `finalizedAt`; final state requires it;
- `context` remains optional;
- `device-local`, `cloud-metadata`, and `cloud-content` placement enums;
- all usage numbers nullable and non-negative;
- all arrays default to no implied content and permit zero items;
- required original and effective retention policies;
- exact retention/deletion enums;
- conditional required fields for scheduled, pending, partial-failure, and completed deletion receipts.

JSON Schema conditionals must also enforce the status pairing table:

```text
active              <-> not_scheduled
deletion_scheduled  <-> scheduled
deletion_pending    <-> pending | partial_failure
deleted             <-> completed
```

- [ ] **Step 3: Implement manifest parsing and aggregate usage**

Export the §8.8 types and:

```ts
export function aggregateManifestUsage(
  executions: readonly RunManifestModelExecutionV1[],
): RunManifestUsageV1;

export function parseRunManifestV1(
  value: unknown,
): ProtocolParseResult<RunManifestV1>;
```

`parseRunManifestV1` enforces:

- manifest digest equals `digestProtocolObject(value)`;
- aggregate usage equals `aggregateManifestUsage(modelExecutions)`;
- unique source ids, artifact ids, and `taskId + attempt` execution pairs;
- context/source correspondence from §8.8;
- a cloud-content artifact cannot have `contentSync: "not-requested"`;
- generic or user-approved titles are represented by requiring titles to reject `/`, `\`, URI schemes, control characters, and known secret prefixes (`sk-`, `ghp_`, `github_pat_`);
- original and effective retention do not exceed bound Context Pack consent when the caller supplies that consent;
- `contentExpiresAt` is null for active pre-clock state and for active project retention;
- deletion status pairing and required receipt fields.

Because the manifest does not embed Context Pack consent, expose:

```ts
export function validateManifestRetentionConsent(
  manifest: RunManifestV1,
  contextConsent: RetentionPolicyV1 | undefined,
): ProtocolParseResult<RunManifestV1>;
```

When `manifest.context` is present, `contextConsent` is required. When no context is present, consent validation succeeds using the run's original policy as its ceiling.

- [ ] **Step 4: Implement revision-chain validation**

`validateRunManifestRevision` must reject unless all conditions hold:

1. `next.revision === previous.revision + 1`.
2. `next.previousDigest === previous.digest`.
3. `id`, `runId`, and `createdAt` are unchanged.
4. Both manifest digests recalculate correctly.
5. An assembling revision may remain assembling or become final.
6. A final revision remains final and preserves `finalizedAt`.
7. After finalization, canonical values for `context`, `sources`, `artifacts`, `modelExecutions`, `usage`, and `retention.policy` are unchanged.
8. After finalization, only `retention.effectivePolicy`, retention status/timestamps, deletion fields, `revision`, `previousDigest`, and `digest` may differ.
9. Effective retention lengthening requires the caller to pass `freshConsent: true`.

Use this signature for rule 9:

```ts
export type ManifestRevisionOptions = {
  freshConsent?: boolean;
  contextConsent?: RetentionPolicyV1;
};

export function validateRunManifestRevision(
  previous: RunManifestV1,
  next: RunManifestV1,
  options?: ManifestRevisionOptions,
): ProtocolParseResult<RunManifestV1>;
```

- [ ] **Step 5: Add fixtures for every manifest conformance case**

The fixtures must cover:

- revision-1 assembling;
- revision-1 final early-terminal run with no model executions;
- final local-only artifact;
- final consented cloud-content artifact;
- valid retention-update revision;
- bad `previousDigest`;
- final artifact mutation;
- invalid retention/deletion pairing;
- private filename in artifact title;
- completed deletion without `eventSequence`.

Every valid fixture's `digest` must be generated by a temporary one-line Node invocation of `digestProtocolObject`, then pasted into the fixture. Do not weaken digest validation to accommodate hand-written fixture values.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
node --experimental-strip-types --test src/lib/research-protocol/run-manifest.test.ts
pnpm typecheck
```

Expected: PASS.

```bash
git add schemas/research/v1/run-manifest.schema.json \
  schemas/research/v1/fixtures/valid/run-manifest-*.json \
  schemas/research/v1/fixtures/invalid/run-manifest-*.json \
  src/lib/research-protocol/run-manifest.ts \
  src/lib/research-protocol/run-manifest.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(research): define immutable run manifests"
```

### Task 7: Public protocol dispatcher and unknown-major behavior

**Files:**
- Create: `src/lib/research-protocol/index.ts`
- Create: `schemas/research/v1/fixtures/invalid/unknown-major.json`
- Modify: `src/lib/research-protocol/research-run.ts`
- Modify: `src/lib/research-protocol/research-run.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing dispatcher tests**

Add:

```ts
import {
  parseResearchProtocolObject,
  RESEARCH_PROTOCOL_SCHEMAS,
} from "./index.ts";

test("dispatches every v1 schema and rejects unknown majors", () => {
  assert.equal(RESEARCH_PROTOCOL_SCHEMAS.length, 8);
  assert.equal(parseResearchProtocolObject({
    schema: "opencoven.run-event/v1",
    runId: "run_01",
    sequence: 1,
    type: "run.created",
    at: "2026-08-15T20:00:00.000Z",
    data: {},
  }).ok, true);

  const unknown = parseResearchProtocolObject({
    schema: "opencoven.run-event/v2",
  });
  assert.equal(unknown.ok, false);
  if (unknown.ok) return;
  assert.equal(unknown.error.code, "unknown_major");
});
```

- [ ] **Step 2: Implement the public exports and dispatcher**

Create:

```ts
import { fail, isRecord, type ProtocolParseResult } from "./common.ts";
import { parseContextPackV1, type ContextPackV1 } from "./context-pack.ts";
import {
  parseTopicDiscoveryJobV1,
  parseTopicProposalV1,
  type TopicDiscoveryJobV1,
  type TopicProposalV1,
} from "./topic-discovery.ts";
import {
  parseResearchRunV1,
  parseRunEventV1,
  type ResearchRunV1,
  type RunEventV1,
} from "./research-run.ts";
import {
  parseModelTaskResultV1,
  parseModelTaskV1,
  type ModelTaskResultV1,
  type ModelTaskV1,
} from "./model-task.ts";
import { parseRunManifestV1, type RunManifestV1 } from "./run-manifest.ts";

export * from "./common.ts";
export * from "./context-pack.ts";
export * from "./digest.ts";
export * from "./model-task.ts";
export * from "./research-run.ts";
export * from "./run-manifest.ts";
export * from "./topic-discovery.ts";

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

export function parseResearchProtocolObject(
  value: unknown,
): ProtocolParseResult<ResearchProtocolObjectV1> {
  if (!isRecord(value) || typeof value.schema !== "string") {
    return fail("missing_field", "$.schema", "schema is required");
  }
  switch (value.schema) {
    case "opencoven.context-pack/v1": return parseContextPackV1(value);
    case "opencoven.topic-discovery-job/v1": return parseTopicDiscoveryJobV1(value);
    case "opencoven.topic-proposal/v1": return parseTopicProposalV1(value);
    case "opencoven.research-run/v1": return parseResearchRunV1(value);
    case "opencoven.run-event/v1": return parseRunEventV1(value);
    case "opencoven.model-task/v1": return parseModelTaskV1(value);
    case "opencoven.model-task-result/v1": return parseModelTaskResultV1(value);
    case "opencoven.run-manifest/v1": return parseRunManifestV1(value);
    default: return fail("unknown_major", "$.schema", `Unsupported schema ${value.schema}`);
  }
}
```

- [ ] **Step 3: Run tests and commit**

Run:

```bash
node --experimental-strip-types --test src/lib/research-protocol/*.test.ts
pnpm typecheck
```

Expected: PASS.

```bash
git add src/lib/research-protocol/index.ts \
  src/lib/research-protocol/research-run.test.ts \
  schemas/research/v1/fixtures/invalid/unknown-major.json
git commit -m "feat(research): expose protocol dispatcher"
```

### Task 8: Cross-environment schema/parser conformance

**Files:**
- Create: `scripts/research-protocol-conformance.test.ts`
- Modify: `scripts/run-tests.mjs:1728-1733`

- [ ] **Step 1: Write the conformance runner**

Create a test that:

1. Reads `schemas/research/v1/fixtures/valid/*.json` and `invalid/*.json`.
2. Maps each fixture's `schema` to the matching schema file and parser.
3. Calls `Check(schemaContext, schema, fixture)` from `typebox/value`.
4. Calls `parseResearchProtocolObject(fixture)`.
5. Requires both validators to accept every valid fixture.
6. Requires at least one validator to reject each invalid fixture.
7. Requires semantic-only invalid fixtures to include `"expectedSchemaValid": true` at the fixture root; remove that marker before parser validation.
8. Round-trips valid parsed objects through `JSON.stringify`/`JSON.parse` and verifies unknown additive fields remain.
9. Recomputes digests for every digest-bearing valid fixture.

Use:

```ts
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { IsSchema, type TSchema } from "typebox";
import { Check } from "typebox/value";
import {
  digestProtocolObject,
  isRecord,
  parseResearchProtocolObject,
} from "../src/lib/research-protocol/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaRoot = path.join(root, "schemas/research/v1");

const schemaFiles = new Map([
  ["opencoven.context-pack/v1", "context-pack.schema.json"],
  ["opencoven.topic-discovery-job/v1", "topic-discovery-job.schema.json"],
  ["opencoven.topic-proposal/v1", "topic-proposal.schema.json"],
  ["opencoven.research-run/v1", "research-run.schema.json"],
  ["opencoven.run-event/v1", "run-event.schema.json"],
  ["opencoven.model-task/v1", "model-task.schema.json"],
  ["opencoven.model-task-result/v1", "model-task-result.schema.json"],
  ["opencoven.run-manifest/v1", "run-manifest.schema.json"],
]);

function jsonObject(pathname: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(pathname, "utf8"));
  assert.ok(isRecord(value), pathname);
  return value;
}

function jsonSchema(pathname: string): TSchema {
  const value: unknown = JSON.parse(readFileSync(pathname, "utf8"));
  assert.ok(IsSchema(value), pathname);
  return value;
}

function fixtureFiles(kind: "valid" | "invalid"): string[] {
  return readdirSync(path.join(schemaRoot, "fixtures", kind))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(schemaRoot, "fixtures", kind, name));
}

const schemaContext = Object.fromEntries(
  [...schemaFiles.entries()].map(([id, filename]) => [
    id,
    jsonSchema(path.join(schemaRoot, filename)),
  ]),
);

test("all valid fixtures satisfy schema and parser", () => {
  for (const fixturePath of fixtureFiles("valid")) {
    const fixture = jsonObject(fixturePath);
    const schemaFile = schemaFiles.get(String(fixture.schema));
    assert.ok(schemaFile, fixturePath);
    const schema = jsonSchema(path.join(schemaRoot, schemaFile));
    assert.equal(Check(schemaContext, schema, fixture), true, fixturePath);
    const parsed = parseResearchProtocolObject(fixture);
    assert.equal(parsed.ok, true, fixturePath);
    if (!parsed.ok) continue;
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.value)), parsed.value);
    if (typeof fixture.digest === "string") {
      assert.equal(digestProtocolObject(fixture), fixture.digest, fixturePath);
    }
  }
});

test("all invalid fixtures are rejected at the declared layer", () => {
  for (const fixturePath of fixtureFiles("invalid")) {
    const raw = jsonObject(fixturePath);
    const expectedSchemaValid = raw.expectedSchemaValid === true;
    const { expectedSchemaValid: _marker, ...fixture } = raw;
    const schemaFile = schemaFiles.get(String(fixture.schema));
    if (!schemaFile) {
      assert.equal(parseResearchProtocolObject(fixture).ok, false, fixturePath);
      continue;
    }
    const schema = jsonSchema(path.join(schemaRoot, schemaFile));
    assert.equal(
      Check(schemaContext, schema, fixture),
      expectedSchemaValid,
      fixturePath,
    );
    assert.equal(parseResearchProtocolObject(fixture).ok, false, fixturePath);
  }
});
```

- [ ] **Step 2: Wire the conformance runner**

Append:

```js
"scripts/research-protocol-conformance.test.ts",
```

to the `conformance` suite.

- [ ] **Step 3: Run all Unit 0 validation**

Run:

```bash
pnpm test:conformance
pnpm check:tests-wired
pnpm typecheck
pnpm lint:source
```

Expected:

- every conformance test passes on the current OS;
- every new test is reported as wired;
- typecheck exits 0;
- lint exits with zero warnings.

- [ ] **Step 4: Check protocol-layer isolation**

Run:

```bash
rg -n 'next/|react|server/|provider|openai|anthropic|cloudflare|@/' \
  src/lib/research-protocol schemas/research/v1
```

Expected: no matches except the literal protocol field value `providerBilling` and privacy comments explaining why provider names are absent.

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only Unit 0 paths and pre-existing unrelated worktree changes are present.

- [ ] **Step 5: Commit the conformance suite**

```bash
git add scripts/research-protocol-conformance.test.ts scripts/run-tests.mjs
git commit -m "test(research): add protocol conformance suite"
```

### Task 9: Unit 0 completion review

**Files:**
- Verify: `schemas/research/v1/**`
- Verify: `src/lib/research-protocol/**`
- Verify: `scripts/research-protocol-conformance.test.ts`
- Verify: `scripts/run-tests.mjs`

- [ ] **Step 1: Confirm all eight schemas exist**

Run:

```bash
find schemas/research/v1 -maxdepth 1 -name '*.schema.json' -print | sort
```

Expected: exactly eight schema files matching §7.2.

- [ ] **Step 2: Confirm fixture coverage**

Run:

```bash
find schemas/research/v1/fixtures -name '*.json' -print | sort
```

Expected: all valid and invalid fixtures listed in this plan, including assembling/final/revision manifest cases.

- [ ] **Step 3: Confirm no protocol placeholders or implementation leakage**

Run:

```bash
rg -n '\b(TBD|TODO|FIXME|REPLACE-ME)\b' \
  schemas/research/v1 src/lib/research-protocol \
  scripts/research-protocol-conformance.test.ts
```

Expected: no matches.

- [ ] **Step 4: Run the final gate**

Run:

```bash
pnpm test:conformance && \
pnpm check:tests-wired && \
pnpm typecheck && \
pnpm lint:source
```

Expected: all commands exit 0.

- [ ] **Step 5: Record the implementation boundary**

The Unit 0 pull request description must state:

```text
This change defines Research Protocol v1 schemas, parsers, canonical digests,
fixtures, and conformance tests only. It does not enable Context Pack storage,
topic discovery, mission v2 writes, hosted runs, device execution, or cloud
deployment. Those remain gated by Units 1-5 of the approved specification.
```

- [ ] **Step 6: Commit any final test-only corrections**

If the final gate required corrections, stage only Unit 0 files and commit:

```bash
git add schemas/research/v1 src/lib/research-protocol \
  scripts/research-protocol-conformance.test.ts scripts/run-tests.mjs
git commit -m "test(research): close Unit 0 conformance gaps"
```

If the working tree is clean for Unit 0 paths, do not create an empty commit.
