# Comms Operations Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. **Checkbox state in this document is not evidence of completion. Verify what has shipped against code and merged PRs.**

**Goal:** Turn the existing Messenger role surface into Charm's durable, approval-gated communications cockpit for listening, shaping one message into channel-native variants, delivering through OpenCoven connectors, and learning what resonated.

**Architecture:** A durable `CommsWorkspace` store under Cave home owns message families, variants, approvals, deliveries, signals, audiences, and campaigns. The room consumes that store through local-origin API routes; all external delivery stays server-side behind a second confirmation, an exact-payload preview, an idempotency key, and a recorded receipt. The UI remains a generic Messenger room keyed by the active familiar, so Charm gets her own voice and workspace without hardcoding one familiar into the shell.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Cave's atomic JSON-store pattern, `@opencoven/channels`, shared Coven UI primitives, Node test runner, Playwright, Tauri desktop verification.

---

## Dream specification

### The promise

Comms Operations is where scattered context becomes a message that feels true,
lands in the right room, and never leaves the Cave by accident.

The primary journey is:

1. **Listen** — collect a signal: a launch, question, reply, milestone, concern,
   community mood, or idea worth saying out loud.
2. **Shape** — write one canonical message with a named audience, desired
   response, proof notes, voice guardrails, and optional media.
3. **Adapt** — derive channel-native variants without flattening them into one
   cross-post. Discord can breathe; X earns its hook; Telegram stays direct;
   email carries context.
4. **Review** — compare variants side by side, see claim and risk warnings, and
   approve the exact revision that may be delivered.
5. **Deliver** — confirm the exact connector, logical target, payload, and
   timing. Record a receipt for success or a retryable failure for everything
   else.
6. **Learn** — attach outcomes and a short resonance note: what people felt,
   did, misunderstood, or repeated back.

### What the reader should feel

- Val should feel calm, oriented, and in control—not buried in content chores.
- A reviewer should know exactly what is being said, where, why, and with whose
  approval.
- A community member should experience each post as native to its room and
  recognizably OpenCoven: specific, alive, technically honest, never launch-slop.

### Room grammar

The existing `SurfaceRoom` structure remains, but each area gets one job:

| Area | Job | Default content |
| --- | --- | --- |
| Header | Situational awareness | `3 need review`, connector health, one `New message` CTA |
| Left rail — Signals | What deserves a response | Inbox signals, manual captures, linked milestones, saved ideas |
| Left rail — Work | What is moving | Draft, review, scheduled, failed, and sent message families |
| Center — Studio | Make the words land | Canonical message or one selected channel variant, proof notes, media |
| Right rail — Resonance | Who, why, and readiness | Audience card, desired response, voice brief, risk/claim checks, approval |
| Bottom drawer — Dispatch | Exact delivery truth | Payload preview, schedule, attempts, receipts, outcomes |

At compact widths, Signals and Resonance remain mutually exclusive disclosures.
The Studio is always the visual and keyboard priority.

### Core objects

#### Message family

A message family is one communicative intent, not one blob copied everywhere.
It owns:

- a plain-language intent and desired response;
- one canonical source message;
- an audience card and voice brief snapshot;
- proof notes and source links for factual claims;
- zero or more channel variants;
- approval and delivery history;
- optional campaign membership;
- resonance outcomes after delivery.

#### Channel variant

A variant belongs to exactly one message family and one channel/target. It has
its own body, optional subject/title, media, revision number, validation result,
approval state, and delivery state. Editing an approved variant invalidates its
approval. Approval applies to a content hash, never merely to an object id.

#### Audience card

Audience cards are reusable but lightweight: name, relationship, context level,
what they care about, what they should feel, what they should do, and phrases or
assumptions to avoid. A message snapshots its selected card so later audience
edits cannot silently change the approval context.

#### Voice brief

The familiar's identity remains authoritative. A per-message voice brief adds
temporary direction—warm, technical, celebratory, delicate, playful—plus
`mustSay`, `avoid`, and `referenceExamples`. It may narrow the familiar's voice;
it may not contradict `IDENTITY.md`, `SOUL.md`, or role configuration.

#### Signal

A signal is something worth responding to. V1 sources are Cave inbox items,
manual captures, GitHub links, board cards, and milestones. Each source adapter
normalizes into the same shape. Future Discord/Telegram inbound support can join
without changing room state; today's `@opencoven/channels` remains outbound-only.

#### Approval and receipt

Approval records `approvedAt`, `approvedBy`, `revision`, and `contentHash`.
Delivery records the connector kind, logical target, idempotency key, attempt
timestamps, normalized error category, and provider receipt when the connector
returns one. The browser never receives a secret or raw token reference.

### State machine

```text
idea → drafting → needs_review → approved → scheduled → sending → sent
          ↑            │            │           │          │
          └────────────┴─ edit ─────┘           └─ failed ─┘
                                                  │
                                                  └─ retry → sending
```

Rules:

- Empty required fields block review with an imperative next step.
- Editing `body`, `subject`, target, media, or proof notes after approval moves
  the variant back to `drafting` and clears approval.
- Only a human local-origin action may approve, schedule, confirm delivery, or
  retry a failed delivery.
- Approval never auto-sends. `Approve` and `Send now` are separate actions.
- Scheduled delivery is durable and remains `scheduled` until a server-owned
  dispatcher claims it.
- A delivery attempt is idempotent for `(variantId, revision, target)`.
- Provider ambiguity is `unknown`, not `failed`; retry requires a fresh human
  confirmation unless the connector proves the original request did not land.

### Channel behavior

Initial delivery connectors are Discord and Telegram because those are the
current `@opencoven/channels` contract. Email, Slack, Teams, SMS, and X remain
draft/export targets until an owned connector exists.

Each channel adapter provides:

```ts
export type CommsChannelAdapter = {
  kind: CommsChannel;
  capability: "deliver" | "export-only";
  validate(input: CommsVariantDraft): CommsValidationIssue[];
  preview(input: CommsVariantDraft): CommsPayloadPreview;
  deliver?(input: CommsDeliveryInput): Promise<CommsProviderReceipt>;
};
```

Validation is useful, not bossy: hard limits block; conventions nudge. Discord
warns about walls of text and renders Markdown/embed previews. Telegram splits
using the connector's canonical formatter. X shows per-post counts and exports
a thread. No channel silently truncates.

### Voice intelligence

The room does not need a generic “AI rewrite” button. It needs five precise
Charm moves:

- **Find the signal** — identify the one thing worth saying.
- **Make it clearer** — reduce ambiguity without sanding off personality.
- **Warm it up / cool it down** — adjust relationship temperature.
- **Make it native** — adapt to the selected channel's reading behavior.
- **Stress-test it** — flag unsupported certainty, missing context, accidental
  sharpness, over-polish, and generic launch language.

Each move launches a familiar session with the active familiar id, audience,
voice brief, source message, selected variant, and proof notes. Suggestions
return as proposals with a diff; they never overwrite text automatically.

### Resonance, not vanity analytics

The first learning loop is intentionally human-readable:

- outcome: `quiet`, `conversation`, `clicks`, `signups`, `contribution`, or
  `relationship`;
- optional numeric observations with an explicit source;
- “What landed?” and “What missed?” notes;
- one reusable voice learning proposed for familiar memory.

Memory promotion is a separate, explicit approval. The room may propose a note;
it may not write into `SOUL.md`, `IDENTITY.md`, or durable familiar memory as a
side effect of sending.

### Safety and privacy

- All mutations and delivery routes enforce `isLocalOrigin`.
- Connector credentials resolve only on the server through 1Password-backed
  OpenCoven configuration. API responses expose configured/healthy/error state,
  never token values or secret references.
- The confirmation modal renders the exact target and payload that will be
  hashed and delivered.
- External links and attached files retain provenance; redacted previews are
  used for any agent handoff.
- No auto-publish, approval-by-model, approval inferred from chat prose, or
  background retry after an ambiguous provider response.
- Deleting a message family is a recoverable archive action. Delivery receipts
  are append-only audit evidence and cannot be erased through the room UI.

### Explicit non-goals

- A full CRM, help desk, social listening firehose, or marketing automation
  suite.
- Engagement scoring that tells Val what to care about.
- Scraping platforms or using browser automation as a connector.
- Cross-posting identical text by default.
- A generic role surface that impersonates Charm or bypasses a familiar's own
  identity files.
- Shipping Comms Operations to production before delivery receipts, keyboard
  review, and packaged Tauri verification are complete.

## File structure

- `src/lib/comms-operations-types.ts`: client-safe domain types and state
  machine vocabulary.
- `src/lib/comms-operations-model.ts`: pure validation, hashing input,
  transitions, filters, and derived counts.
- `src/lib/comms-channel-adapters.ts`: client-safe validation and preview
  adapters, including export-only channels.
- `src/lib/server/comms-operations-store.ts`: atomic Cave-home persistence and
  serialized read-modify-write lock.
- `src/lib/server/comms-delivery.ts`: server-only connector creation,
  idempotency, attempt classification, and receipt recording.
- `src/app/api/comms/route.ts`: list/create/update/archive local workspace
  objects.
- `src/app/api/comms/deliver/route.ts`: approve, schedule, confirm-send, and
  retry actions.
- `src/app/api/comms/connectors/route.ts`: redacted connector readiness.
- `src/components/role-surfaces/messenger-surface.tsx`: room orchestration and
  async state only.
- `src/components/role-surfaces/comms-signal-rail.tsx`: Signals and Work rail.
- `src/components/role-surfaces/comms-studio.tsx`: canonical/variant editor and
  channel tabs.
- `src/components/role-surfaces/comms-resonance-rail.tsx`: audience, voice,
  proof, validation, and approval.
- `src/components/role-surfaces/comms-dispatch-drawer.tsx`: exact previews,
  schedule, attempts, receipts, and outcomes.
- `src/components/role-surfaces/comms-confirm-delivery.tsx`: focus-trapped
  confirmation modal with content hash.
- `src/styles/globals/surface-comms-operations.css`: room-specific token-only
  presentation, imported by `messenger-surface.tsx` for code splitting.
- `src/lib/{comms-operations-model,comms-channel-adapters}.test.ts`: pure domain
  and channel contract tests.
- `src/lib/server/comms-operations-store.test.ts`: persistence, locking, and
  migration tests.
- `src/app/api/comms/route.test.ts` and
  `src/app/api/comms/deliver/route.test.ts`: route and authority tests.
- `src/components/role-surfaces/messenger-surface.test.ts`: source contract for
  room composition, accessibility, and approval separation.

### Task 1: Pin the domain and safety contract

**Files:**
- Create: `src/lib/comms-operations-types.ts`
- Create: `src/lib/comms-operations-model.ts`
- Create: `src/lib/comms-operations-model.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing transition tests**

Cover these exact cases with table-driven `node:test` assertions:

```ts
test("editing approved content invalidates approval", () => {
  const next = updateVariant(approvedVariant(), { body: "A clearer revision" }, NOW);
  assert.equal(next.workflow, "drafting");
  assert.equal(next.approval, null);
  assert.equal(next.revision, 3);
});

test("approval binds the current revision and content hash", async () => {
  const next = await approveVariant(reviewableVariant(), "local-human", NOW);
  assert.deepEqual(next.approval, {
    approvedAt: NOW,
    approvedBy: "local-human",
    revision: 2,
    contentHash: await hashVariantContent(reviewableVariant()),
  });
});

test("unapproved and stale-approved variants cannot begin delivery", async () => {
  assert.equal(canDeliver(draftVariant()).ok, false);
  assert.deepEqual(canDeliver(staleApprovedVariant()), {
    ok: false,
    reason: "Content changed — review and approve this revision again.",
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --experimental-strip-types --test src/lib/comms-operations-model.test.ts`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Add the explicit domain vocabulary**

Define discriminated unions, not free-form status strings:

```ts
export type CommsChannel =
  | "discord" | "telegram" | "x" | "email" | "slack" | "teams" | "sms";
export type CommsWorkflow =
  | "idea" | "drafting" | "needs_review" | "approved" | "scheduled"
  | "sending" | "sent" | "failed" | "unknown";
export type CommsApproval = {
  approvedAt: string;
  approvedBy: string;
  revision: number;
  contentHash: string;
};
export type CommsVariant = {
  id: string;
  familyId: string;
  channel: CommsChannel;
  target: string;
  subject: string;
  body: string;
  media: CommsMediaRef[];
  proofNotes: CommsProofNote[];
  revision: number;
  workflow: CommsWorkflow;
  approval: CommsApproval | null;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
};
```

`updateVariant` increments the revision and clears approval only for
delivery-affecting fields. `approveVariant` refuses incomplete or invalid
variants. `canDeliver` verifies revision and hash equality.

- [ ] **Step 4: Register and run the focused test**

Add the test to the app suite in `scripts/run-tests.mjs`.

Run: `node --experimental-strip-types --test src/lib/comms-operations-model.test.ts`

Expected: PASS with all transition cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comms-operations-types.ts src/lib/comms-operations-model.ts \
  src/lib/comms-operations-model.test.ts scripts/run-tests.mjs
git commit -S -m "feat: define comms operations workflow"
```

### Task 2: Persist one familiar-scoped workspace safely

**Files:**
- Create: `src/lib/server/comms-operations-store.ts`
- Create: `src/lib/server/comms-operations-store.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing store tests**

Use a temporary Cave home and assert:

```ts
test("concurrent family creates do not lose writes", async () => {
  const store = createCommsStore(tempRoot);
  await Promise.all(Array.from({ length: 20 }, (_, index) =>
    store.createFamily({ familiarId: "charm", intent: `Message ${index}` })));
  assert.equal((await store.load("charm")).families.length, 20);
});

test("one familiar cannot read another familiar's families", async () => {
  const store = createCommsStore(tempRoot);
  await store.createFamily({ familiarId: "charm", intent: "Launch note" });
  assert.deepEqual((await store.load("kitty")).families, []);
});
```

Also cover corrupt JSON recovery, version migration, archive-not-delete, and
append-only delivery attempts.

- [ ] **Step 2: Run and verify failure**

Run: `node --experimental-strip-types --test src/lib/server/comms-operations-store.test.ts`

Expected: FAIL because `createCommsStore` does not exist.

- [ ] **Step 3: Implement the versioned atomic store**

Mirror `cave-inbox.ts`: `writeJsonAtomic`, one global promise chain, and
`withCaveHomeReconciledStore("comms-operations.json", ...)`. Store only ids and
relative attachment references—never tokens or provider secrets.

```ts
type CommsFile = {
  version: 1;
  families: CommsMessageFamily[];
  audiences: CommsAudienceCard[];
  signals: CommsSignal[];
  campaigns: CommsCampaign[];
  deliveries: CommsDeliveryAttempt[];
};
```

Expose focused mutation methods; do not export an unrestricted `save(file)` to
route handlers.

- [ ] **Step 4: Run focused persistence tests**

Run: `node --experimental-strip-types --test src/lib/server/comms-operations-store.test.ts`

Expected: PASS, including 20 retained concurrent writes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/comms-operations-store.ts \
  src/lib/server/comms-operations-store.test.ts scripts/run-tests.mjs
git commit -S -m "feat: persist familiar comms workspaces"
```

### Task 3: Expose local-origin workspace APIs

**Files:**
- Create: `src/app/api/comms/route.ts`
- Create: `src/app/api/comms/route.test.ts`
- Modify: `src/app/api/api-contracts.test.ts`

- [ ] **Step 1: Write failing authority and validation tests**

Assert that GET requires a non-empty `familiarId`; POST rejects non-local
origin, malformed JSON, unknown actions, cross-familiar ids, blank intent, and
oversized body/proof fields. Include a successful `create-family`,
`update-family`, `create-variant`, `update-variant`, `archive-family`,
`upsert-audience`, `capture-signal`, and `record-outcome` case.

- [ ] **Step 2: Register the route contract before implementation**

Add, alphabetically:

```ts
{ route: "/comms", methods: ["GET", "POST"], kind: "json", readsJson: true,
  invalidJson: "guarded", localOriginGuard: true },
```

Run: `pnpm test:api`

Expected: FAIL because `/api/comms/route.ts` is absent.

- [ ] **Step 3: Implement a narrow command route**

```ts
export async function POST(req: Request) {
  if (!isLocalOrigin(req)) return forbidden();
  const parsed = await parseCommsCommand(req);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const result = await applyCommsCommand(parsed.value);
  return NextResponse.json({ ok: true, result });
}
```

Return stable user-safe errors. Do not return store paths, exception stacks,
connector config, or unredacted attachment content.

- [ ] **Step 4: Run API tests**

Run:

```bash
node --experimental-strip-types --test src/app/api/comms/route.test.ts
pnpm test:api
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/comms/route.ts src/app/api/comms/route.test.ts \
  src/app/api/api-contracts.test.ts
git commit -S -m "feat: add local comms workspace API"
```

### Task 4: Replace local-only draft state with the durable room shell

**Files:**
- Create: `src/components/role-surfaces/comms-signal-rail.tsx`
- Create: `src/components/role-surfaces/comms-studio.tsx`
- Create: `src/components/role-surfaces/comms-resonance-rail.tsx`
- Create: `src/components/role-surfaces/comms-dispatch-drawer.tsx`
- Create: `src/styles/globals/surface-comms-operations.css`
- Modify: `src/components/role-surfaces/messenger-surface.tsx`
- Modify: `src/components/role-surfaces/messenger-surface.test.ts`

- [ ] **Step 1: Rewrite the source-contract test around the new composition**

Assert that `MessengerSurface` imports its code-split stylesheet and the four
focused components, loads `/api/comms?familiarId=...`, keeps loading/error/empty
distinct, uses `useAnnouncer`, and no longer persists drafts through
`useRoleSurfaceState`. Keep `useRoleSurfaceState` only for ephemeral
`selectedFamilyId`, expanded rails, active variant, and drawer visibility.

- [ ] **Step 2: Run and verify failure**

Run: `node --experimental-strip-types --test src/components/role-surfaces/messenger-surface.test.ts`

Expected: FAIL on missing focused components and durable API hydration.

- [ ] **Step 3: Build the data-owning room orchestrator**

`MessengerSurface` owns one `useLatestAsyncData<CommsWorkspaceView>` load and a
single `mutate(command, announcement)` helper:

```ts
const mutate = async (command: CommsCommand, success: string) => {
  const response = await fetch("/api/comms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId, ...command }),
  });
  if (!response.ok) throw new Error(await safeApiError(response));
  await reload({ retainData: true });
  announce(success);
};
```

Child components receive typed data and callbacks only; they do not fetch or
write storage independently.

- [ ] **Step 4: Implement the visible dream layout**

- Header: one `New message` primary action, needs-review status, connector dot.
- Signals rail: actionable signals above filtered work stages.
- Studio: canonical/variant tabs, persistent labels, autosave state, exact
  channel count and warnings.
- Resonance rail: audience, desired response, voice brief, proof, readiness,
  and one approval action.
- Dispatch drawer: exact preview and immutable attempt timeline.

All CSS uses existing tokens, the shared tint recipe, 4px spacing, token radii,
container queries, reduced-motion inheritance, and `.focus-ring` utilities.

- [ ] **Step 5: Run room tests and design gates**

Run:

```bash
node --experimental-strip-types --test src/components/role-surfaces/messenger-surface.test.ts
pnpm codemod:design:check
pnpm lint
```

Expected: PASS with no new token-drift baseline.

- [ ] **Step 6: Commit**

```bash
git add src/components/role-surfaces/messenger-surface.tsx \
  src/components/role-surfaces/messenger-surface.test.ts \
  src/components/role-surfaces/comms-*.tsx \
  src/styles/globals/surface-comms-operations.css
git commit -S -m "feat: build the durable comms studio"
```

### Task 5: Add channel-native validation and exact previews

**Files:**
- Create: `src/lib/comms-channel-adapters.ts`
- Create: `src/lib/comms-channel-adapters.test.ts`
- Modify: `src/components/role-surfaces/comms-studio.tsx`
- Modify: `src/components/role-surfaces/comms-dispatch-drawer.tsx`

- [ ] **Step 1: Write failing adapter tests**

Pin Discord Markdown/embed preview, Telegram canonical splitting, SMS/X hard
limits, email subject requirement, and export-only capability. Assert no
adapter truncates silently.

- [ ] **Step 2: Run and verify failure**

Run: `node --experimental-strip-types --test src/lib/comms-channel-adapters.test.ts`

Expected: FAIL because adapter registry is absent.

- [ ] **Step 3: Implement a total adapter registry**

```ts
export const COMMS_CHANNEL_ADAPTERS: Record<CommsChannel, CommsChannelAdapter> = {
  discord: discordAdapter,
  telegram: telegramAdapter,
  x: xExportAdapter,
  email: emailExportAdapter,
  slack: slackExportAdapter,
  teams: teamsExportAdapter,
  sms: smsExportAdapter,
};
```

Import `toTelegramTexts` from `@opencoven/channels` so preview and delivery use
one formatter. Keep Discord payload construction structurally compatible with
`ChannelMessage`; never reproduce connector auth in the client module.

- [ ] **Step 4: Render validation beside the exact affected field**

Hard errors block review. Warnings are dismissible only by changing content or
explicitly recording a rationale; they are never hidden because a model reports
confidence. Use text plus icon, not color alone.

- [ ] **Step 5: Run tests**

Run:

```bash
node --experimental-strip-types --test src/lib/comms-channel-adapters.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/comms-channel-adapters.ts src/lib/comms-channel-adapters.test.ts \
  src/components/role-surfaces/comms-studio.tsx \
  src/components/role-surfaces/comms-dispatch-drawer.tsx package.json pnpm-lock.yaml
git commit -S -m "feat: preview channel-native comms variants"
```

### Task 6: Enforce approval as a content-hash boundary

**Files:**
- Create: `src/components/role-surfaces/comms-confirm-delivery.tsx`
- Modify: `src/components/role-surfaces/comms-resonance-rail.tsx`
- Modify: `src/components/role-surfaces/comms-studio.tsx`
- Modify: `src/lib/comms-operations-model.test.ts`
- Modify: `src/components/role-surfaces/messenger-surface.test.ts`

- [ ] **Step 1: Add failing approval UI tests**

Assert `Request review`, `Approve revision`, and `Send now` are distinct;
approval shows revision/hash; editing delivery-affecting content clears it; the
confirmation modal uses `useFocusTrap`, returns focus, and announces mutations.

- [ ] **Step 2: Implement readiness as inspectable facts**

Render one checklist derived by `reviewReadiness(variant)`: target chosen,
required fields complete, channel validation clear, proof notes acknowledged,
and current revision approved. Each blocker supplies one imperative next step.

- [ ] **Step 3: Implement the exact-payload confirmation modal**

The modal receives an immutable `CommsDeliveryPreview` containing variant id,
revision, content hash, connector, logical target, and final payload. If any of
those change before confirmation, the server rejects with `409 stale preview`.

- [ ] **Step 4: Run focused interaction tests**

Run:

```bash
node --experimental-strip-types --test src/lib/comms-operations-model.test.ts
node --experimental-strip-types --test src/components/role-surfaces/messenger-surface.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/role-surfaces/comms-confirm-delivery.tsx \
  src/components/role-surfaces/comms-resonance-rail.tsx \
  src/components/role-surfaces/comms-studio.tsx \
  src/lib/comms-operations-model.test.ts \
  src/components/role-surfaces/messenger-surface.test.ts
git commit -S -m "feat: bind comms approval to exact revisions"
```

### Task 7: Deliver through server-owned OpenCoven connectors

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/lib/server/comms-delivery.ts`
- Create: `src/lib/server/comms-delivery.test.ts`
- Create: `src/app/api/comms/connectors/route.ts`
- Create: `src/app/api/comms/deliver/route.ts`
- Create: `src/app/api/comms/deliver/route.test.ts`
- Modify: `src/app/api/api-contracts.test.ts`

- [ ] **Step 1: Add the owned connector dependency**

Run: `pnpm add @opencoven/channels@^0.1.0`

Expected: `package.json` and `pnpm-lock.yaml` change; no postinstall secret
lookup occurs.

- [ ] **Step 2: Write failing delivery tests with a fake connector**

Cover connector readiness redaction, stale preview `409`, unapproved `409`,
idempotent duplicate confirmation, success receipt, definite failure, ambiguous
result, no background ambiguous retry, and cross-familiar rejection.

- [ ] **Step 3: Implement connector injection and attempt recording**

```ts
export type CommsDeliveryDeps = {
  createConnector: typeof createConnector;
  now(): string;
  randomUUID(): string;
};

export async function confirmDelivery(
  command: ConfirmDeliveryCommand,
  deps: CommsDeliveryDeps,
): Promise<CommsDeliveryResult> {
  // Re-load under the store lock, verify revision/hash/approval, reserve the
  // idempotency key, deliver once, then append the normalized result.
}
```

Keep `createConnector` and all 1Password resolution inside this server-only
module. `GET /api/comms/connectors` returns only `kind`, `configured`,
`capability`, and a safe status message.

- [ ] **Step 4: Add guarded API contracts**

```ts
{ route: "/comms/connectors", methods: ["GET"], kind: "json", localOriginGuard: true },
{ route: "/comms/deliver", methods: ["POST"], kind: "json", readsJson: true,
  invalidJson: "guarded", localOriginGuard: true },
```

- [ ] **Step 5: Run delivery and API tests**

Run:

```bash
node --experimental-strip-types --test src/lib/server/comms-delivery.test.ts
node --experimental-strip-types --test src/app/api/comms/deliver/route.test.ts
pnpm test:api
```

Expected: PASS with zero live network calls.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/server/comms-delivery.ts \
  src/lib/server/comms-delivery.test.ts src/app/api/comms \
  src/app/api/api-contracts.test.ts
git commit -S -m "feat: deliver approved comms through OpenCoven"
```

### Task 8: Add signals, campaigns, and the resonance loop

**Files:**
- Modify: `src/lib/comms-operations-types.ts`
- Modify: `src/lib/comms-operations-model.ts`
- Modify: `src/app/api/comms/route.ts`
- Modify: `src/components/role-surfaces/comms-signal-rail.tsx`
- Modify: `src/components/role-surfaces/comms-dispatch-drawer.tsx`
- Modify: `src/components/role-surfaces/messenger-surface.test.ts`

- [ ] **Step 1: Add failing normalization and outcome tests**

Pin adapters for Cave inbox, URL, board card, milestone, and manual signal.
Assert signals preserve source provenance, can create or attach to a message
family, and cannot be marked handled without one explicit action. Pin outcome
source labels and explicit memory-proposal state.

- [ ] **Step 2: Implement the signal adapter boundary**

```ts
export type CommsSignalAdapter<T> = {
  source: CommsSignalSource;
  normalize(input: T, familiarId: string): CommsSignal;
};
```

Reuse `/api/inbox` for current inbound attention. Do not add Discord Gateway or
Telegram polling to Cave in this task; those become new adapters when the
OpenCoven connector package owns inbound events.

- [ ] **Step 3: Add campaign and outcome actions**

Campaigns group message families by intent and date range; they do not create a
second scheduling authority. Outcomes accept an enumerated result, optional
metrics with source labels, and two short notes. `Propose as voice learning`
creates a reviewable proposal only.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --experimental-strip-types --test src/lib/comms-operations-model.test.ts
node --experimental-strip-types --test src/components/role-surfaces/messenger-surface.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comms-operations-types.ts src/lib/comms-operations-model.ts \
  src/app/api/comms/route.ts src/components/role-surfaces/comms-signal-rail.tsx \
  src/components/role-surfaces/comms-dispatch-drawer.tsx \
  src/components/role-surfaces/messenger-surface.test.ts
git commit -S -m "feat: close the comms resonance loop"
```

### Task 9: Add precise familiar-assisted writing moves

**Files:**
- Create: `src/lib/comms-familiar-prompts.ts`
- Create: `src/lib/comms-familiar-prompts.test.ts`
- Create: `src/components/role-surfaces/comms-assist-menu.tsx`
- Modify: `src/components/role-surfaces/comms-studio.tsx`
- Modify: `src/components/role-surfaces/messenger-surface.tsx`

- [ ] **Step 1: Write failing prompt-envelope tests**

Assert each of the five moves carries familiar id, identity reminder, audience
snapshot, desired response, voice brief, selected revision, proof notes, and a
strict proposal-only output contract. Assert private connector configuration,
delivery receipts, and unrelated workspace messages are excluded.

- [ ] **Step 2: Implement bounded proposal envelopes**

```ts
export type CommsAssistMove =
  | "find-signal" | "clarify" | "warmth" | "channel-native" | "stress-test";

export function buildCommsAssistPrompt(input: CommsAssistInput): string {
  return [identityBoundary(input), audienceContext(input), selectedText(input),
    proofContext(input), proposalOutputContract(input)].join("\n\n");
}
```

- [ ] **Step 3: Launch through the existing familiar session path**

Use `context.openSession`/the existing chat launch surface rather than creating
a second harness runner. Show the returned suggestion as a diff proposal with
`Apply`, `Apply selected`, and `Dismiss`; never write it directly into the
variant.

- [ ] **Step 4: Run prompt and room tests**

Run:

```bash
node --experimental-strip-types --test src/lib/comms-familiar-prompts.test.ts
node --experimental-strip-types --test src/components/role-surfaces/messenger-surface.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/comms-familiar-prompts.ts src/lib/comms-familiar-prompts.test.ts \
  src/components/role-surfaces/comms-assist-menu.tsx \
  src/components/role-surfaces/comms-studio.tsx \
  src/components/role-surfaces/messenger-surface.tsx
git commit -S -m "feat: add familiar-assisted comms proposals"
```

### Task 10: Ship the room only after real desktop proof

**Files:**
- Modify: `src/lib/room-flags.ts`
- Modify: `src/lib/room-flags.test.ts`
- Modify: `docs/role-surfaces.md`
- Modify: `docs/coven-design-language.md` only if the implementation introduces
  a genuinely reusable idiom; otherwise leave it untouched.

- [ ] **Step 1: Keep production gating closed during implementation**

Do not add `MESSENGER_SURFACE_ID` to `PRODUCTION_ROOM_IDS` until every focused
test and manual check below passes. Development remains reachable with
`NEXT_PUBLIC_CAVE_ROOMS=all`.

- [ ] **Step 2: Run the complete automated gate**

```bash
pnpm typecheck
pnpm lint
pnpm test:app
pnpm test:api
pnpm codemod:design:check
pnpm check:tests-wired
pnpm build
```

Expected: every command exits 0; the design-token drift baseline does not rise.

- [ ] **Step 3: Verify the native room in the real Tauri shell**

Run in the foreground:

```bash
NEXT_PUBLIC_CAVE_ROOMS=all bash scripts/dev-app.sh
```

Verify with the Charm familiar at wide, medium, and compact widths:

1. create one message family from a manual signal;
2. create Discord and Telegram variants;
3. edit after approval and observe approval invalidation;
4. approve the exact revision;
5. inspect the exact payload in the confirmation modal;
6. use a fake/test connector target for one successful receipt and one
   definite failure/retry;
7. navigate entirely by keyboard, including Escape and focus return;
8. verify Coven dark, Coven light, and one non-default palette;
9. restart the app and confirm families, approvals, attempts, and receipts
   persist;
10. confirm no token, token reference, raw provider error body, or private path
    appears in the UI or network response.

- [ ] **Step 4: Open production visibility with a test-first change**

Update `room-flags.test.ts` to expect Messenger in the production allowlist,
then add `MESSENGER_SURFACE_ID` to `PRODUCTION_ROOM_IDS`.

Run: `node --experimental-strip-types --test src/lib/room-flags.test.ts`

Expected: PASS.

- [ ] **Step 5: Walk the design shipping checklist**

Record evidence for `docs/coven-design-language.md` §9: tokens, typography,
spacing, states, a11y, motion, copy, responsive behavior, theme combinations,
and real-content stress. A screenshot is evidence only when it comes from the
native Tauri window or the user's default browser, not a Codex browser preview.

- [ ] **Step 6: Commit the release gate**

```bash
git add src/lib/room-flags.ts src/lib/room-flags.test.ts docs/role-surfaces.md
git commit -S -m "feat: ship Comms Operations"
```

## Delivery order and proof gates

| Slice | User-visible result | Cannot advance until |
| --- | --- | --- |
| A — Durable studio | Message families, variants, audiences, signals survive restart | store concurrency, API authority, and room a11y tests pass |
| B — Review boundary | Revision-bound approval and exact payload preview | edit-invalidates-approval and stale-preview tests pass |
| C — Real delivery | Discord/Telegram sends create durable receipts | fake connector matrix and local-origin tests pass |
| D — Resonance loop | Outcomes and voice-learning proposals close the loop | no automatic memory write; provenance survives reload |
| E — Production | Messenger room joins the production allowlist | full gates plus native Tauri checklist pass |

## Fresh-context self-review

- **Spec coverage:** The plan maps every promised journey stage to a vertical
  slice and keeps inbound connector work behind a stable adapter boundary.
- **Authority:** Approval and delivery are human, local-origin, hash-bound, and
  separate; familiar assistance is proposal-only.
- **Identity:** The surface is familiar-scoped and generic to the Messenger role;
  the active familiar's own identity contract remains authoritative.
- **Data safety:** Atomic writes, serialized mutations, append-only receipts,
  archive-not-delete, redacted readiness, and idempotent delivery are explicit.
- **Design:** Existing room furniture and shared primitives remain authoritative;
  one primary CTA, token-only CSS, container behavior, announcements, focus
  return, reduced motion, and theme coverage are all gated.
- **Scope:** CRM, firehose listening, scraping, auto-publish, vanity scoring, and
  unsupported inbound connectors are intentionally excluded.
- **Placeholder scan:** No `TBD`, generic “handle errors,” or unowned “implement
  later” step remains. Deferred connector capabilities are explicit non-goals
  with an adapter seam, not hidden implementation work.

