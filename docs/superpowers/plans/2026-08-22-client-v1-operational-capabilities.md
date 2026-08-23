# Client v1 Operational Capability Semantics Plan

**Status:** Proposed implementation plan  
**Date:** 2026-08-22  
**Cave base audited:** `dbc63f49ab60b7f065ff0d101bd50e37d6f8ff98`  
**Tracking:** [OpenCoven/coven-cave#4869](https://github.com/OpenCoven/coven-cave/issues/4869)  
**Upstream consumer program:** [OpenCoven/sdk#31](https://github.com/OpenCoven/sdk/issues/31)

## 1. Goal

Make every Client v1 capability declaration operationally truthful: a client should be able to determine what the current Cave can actually perform without treating roadmap commitments as live protocol support or probing arbitrary paths.

This work is a blocker for the SDK 0.1 contract, compatibility health, and canonical-read APIs.

## 2. Current mismatch

The current Client v1 envelope advertises:

- pairing;
- credentials;
- familiars;
- projects;
- conversations;
- conversation-messages;
- streaming;
- cursors;
- revisions.

The current authority serves compatibility health, pairing, administrator credential management, and five canonical reads. It does **not** serve a streaming route, and no route emits or consumes the envelope’s revision field.

A consumer-facing helper such as:

```ts
client.supports("streaming")
```

would therefore return a false operational claim if it treated the current list literally.

## 3. Design requirements

The selected model must:

1. distinguish live operations from planned work;
2. remain deterministic and generated into the contract fixture;
3. permit additive compatible evolution;
4. let a client decide route availability without arbitrary route probing;
5. cross-check declarations against route ownership in CI;
6. preserve explicit administrator, public bootstrap, and authenticated-client distinctions;
7. avoid making a broad label mean different authority classes accidentally;
8. support exact producer/vendor/packed-consumer parity in the SDK program.

## 4. Candidate models

## Option A — live capabilities only

```ts
const CLIENT_V1_CAPABILITIES = [
  "pairing",
  "credentials",
  "familiars",
  "projects",
  "conversations",
  "conversation-messages",
  "cursors",
] as const;
```

### Advantages

- smallest compatible change;
- easy for existing clients to understand;
- `supports()` becomes truthful after removing unavailable entries;
- no new envelope field.

### Risks

- broad names can still obscure exact methods and authority classes;
- `credentials` may be interpreted as paired-client self-management even though current credential administration is local Cave UI authority;
- route families with multiple operations may eventually need finer granularity.

## Option B — live and planned fields

```ts
type ClientV1Compatibility = {
  capabilities: readonly ClientV1Capability[];
  plannedCapabilities?: readonly ClientV1PlannedCapability[];
};
```

### Advantages

- retains roadmap signaling explicitly;
- existing `capabilities` becomes operationally truthful;
- planned work cannot be mistaken for current support.

### Risks

- roadmap intent enters a compatibility envelope even though clients do not need it;
- planned labels create compatibility/governance overhead without providing an invokable contract;
- plans may change more frequently than protocol releases.

## Option C — explicit operation inventory

```ts
const CLIENT_V1_OPERATIONS = [
  "health.read",
  "pairing.create",
  "pairing.poll",
  "pairing.exchange",
  "credentials.admin.list",
  "credentials.admin.revoke",
  "pairing.admin.list",
  "pairing.admin.decide",
  "familiars.list",
  "projects.list",
  "conversations.list",
  "conversations.read",
  "messages.list",
] as const;
```

The envelope may retain broad capability families for display while adding exact operations for programmatic feature checks.

### Advantages

- directly maps to invokable behavior;
- distinguishes bootstrap, administrator, and paired-client authority;
- scales cleanly to send/stream/attachment/action operations;
- supports generated route ownership tests.

### Risks

- larger contract change;
- requires naming and compatibility policy now;
- one route may own multiple methods or operation variants, requiring explicit metadata rather than path inference alone.

## Recommended direction

Use **Option C with a compatibility bridge**:

```ts
type ClientV1Contract = {
  capabilities: readonly ClientV1CapabilityFamily[];
  operations: readonly ClientV1Operation[];
};
```

- `operations` is the authoritative programmatic support inventory.
- `capabilities` is a derived or explicitly mapped family summary containing only live operation families.
- No planned capability appears in either live list.
- Roadmap commitments remain in documentation and issues rather than the compatibility envelope.

This is more work than removing two strings, but it prevents the same ambiguity from reappearing when writes, streams, attachments, and privileged actions arrive.

The maintainer may select Option A for the smallest 0.1 correction. If so, the tests and documentation must still define each broad label’s exact current meaning and authority class.

## 5. Proposed contract metadata

A route/operation registry should be the source used to validate the exported inventory:

```ts
type ClientV1OperationDefinition = {
  id: ClientV1Operation;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  ingress: "public" | "admin" | "authenticated";
  scope: ClientV1Scope | null;
};
```

Example:

```ts
{
  id: "conversations.list",
  method: "GET",
  path: "/api/client/v1/conversations",
  ingress: "authenticated",
  scope: "chat:read",
}
```

The public-route list remains the authority for unauthenticated bootstrap ingress. Administrator routes remain explicit and do not accidentally join the public or paired-client list.

## 6. File map

### Modify

- `src/lib/server/client-v1/contract.ts`
  - define the selected capability/operation model;
  - add strict parsers and compatibility types;
  - preserve deterministic ordering.
- `src/lib/server/client-v1/contract.test.ts`
  - pin exact semantics and additive parsing behavior.
- `scripts/export-client-v1-contract.mjs`
  - export the selected live inventory.
- `scripts/export-client-v1-contract.test.mjs`
  - require deterministic complete fixture output.
- `src/lib/server/client-v1/contract-fixture.json`
  - generated only.
- `src/lib/server/client-v1/contract-fixture.sha256`
  - generated only.
- `src/app/api/api-contracts.test.ts`
  - cross-check live operation ownership and route source obligations.
- `src/lib/server/client-v1/auth.test.ts`
  - preserve ingress classification and ensure operation metadata does not widen access.
- `docs/api/client-v1.md`
  - define capability/operation semantics and migration behavior.
- `scripts/client-v1-doc-contract.test.mjs`
  - require every live operation and family to appear in the reference.
- `scripts/client-v1-conformance.mjs`
  - record and verify the live compatibility inventory over a real socket.
- `scripts/client-v1-conformance.test.mjs`
  - negative-test declaration mismatches.

### Create if Option C is selected

- `src/lib/server/client-v1/operations.ts`
  - pure frozen operation registry with zero side effects and no route imports.
- `src/lib/server/client-v1/operations.test.ts`
  - uniqueness, ownership, method/path/scope, and family derivation tests.

## 7. Task 1 — characterize the current inventory

- [ ] Enumerate every `route.ts` under `src/app/api/client/v1`.
- [ ] Classify each method/path as public, administrator, or authenticated.
- [ ] Record the required scope or administrator authority.
- [ ] Confirm which contract capability family each live operation belongs to.
- [ ] Record current declarations with no live owner (`streaming`, `revisions`).
- [ ] Identify broad labels whose meaning is ambiguous (`credentials`, `conversations`).

### Evidence

Commit a generated or test-owned inventory table rather than relying on prose alone.

## 8. Task 2 — write failing contract tests

Before implementation, add tests that fail against the current declaration.

Required cases:

- [ ] every advertised operation has exactly one live method/path owner;
- [ ] every externally reachable Client v1 route is represented exactly once unless explicitly classified as internal-only;
- [ ] no planned/unimplemented operation appears in the live inventory;
- [ ] operation IDs are unique and deterministically ordered;
- [ ] capability families are derived from or cross-checked against live operations;
- [ ] public/admin/authenticated classification matches proxy and route authorization rules;
- [ ] authenticated operations name a required scope;
- [ ] public health and pairing operations name no bearer scope;
- [ ] administrator operations do not appear as paired-client capabilities accidentally;
- [ ] safe unknown additive fields remain compatible;
- [ ] malformed, duplicate, or unknown required operation records fail closed.

Run the focused tests and retain the expected pre-implementation failure in the PR evidence.

## 9. Task 3 — implement the selected contract model

- [ ] Add the pure operation/family definitions.
- [ ] Update compatibility/envelope types.
- [ ] Update strict parsers.
- [ ] Preserve a deterministic canonical order.
- [ ] Remove `streaming` and `revisions` from the live declaration unless a reviewed live owner lands first.
- [ ] Keep roadmap information outside the operational compatibility inventory.
- [ ] Ensure no new imports introduce runtime cycles or client-bundle leakage.

### Compatibility rule

Adding a new live operation in a compatible Client v1 minor release is additive. Removing or renaming an existing live operation is a compatibility decision and requires a minimum-client/versioning review.

## 10. Task 4 — bind declarations to route ownership

Extend `api-contracts.test.ts` or a dedicated operation inventory test so a route cannot drift from the declaration.

Required assertions:

- [ ] operation path resolves to an existing route file;
- [ ] method is exported by that route;
- [ ] authenticated operation route calls `requireScope` with the declared scope;
- [ ] authenticated success path is metered where required by current policy;
- [ ] administrator operation route calls `requireClientV1Admin`;
- [ ] public operation path is in the reviewed public-route contract;
- [ ] ingress metadata agrees with `clientV1IngressKind` and admin-family classification;
- [ ] a route addition without operation metadata fails;
- [ ] operation metadata without a route fails.

Do not make the test derive its expectation entirely from the same registry it validates. Retain a review ratchet for the exact live operation set.

## 11. Task 5 — regenerate fixtures and documentation

- [ ] Run the contract exporter.
- [ ] Verify `--check` passes.
- [ ] Update `docs/api/client-v1.md` with exact semantics and authority classes.
- [ ] Add a migration note for SDK/Chat consumers.
- [ ] Update the documentation contract test.
- [ ] Copy only generated fixture bytes into the SDK in SDK #33 after this PR merges.

The SDK must record this Cave commit as producer provenance rather than copying from an unmerged branch.

## 12. Task 6 — real-socket compatibility proof

Extend the Client v1 conformance run to assert:

- [ ] health returns the exact expected live operation/family inventory;
- [ ] every advertised operation can reach its owning route under the correct authority, or is exercised through an approved non-mutating availability probe;
- [ ] removed aspirational entries are absent;
- [ ] the compatibility inventory is identical to the generated fixture;
- [ ] proxy behavior does not widen because of the metadata change;
- [ ] the evidence record names the Cave commit and fixture digest.

For destructive administrator operations, the conformance runner may use isolated fixture state and no-op-safe records. It must not mutate the operator’s real Cave.

## 13. Validation matrix

Run at minimum:

```bash
pnpm typecheck
pnpm lint
pnpm check:tests-wired
node scripts/export-client-v1-contract.mjs --check
```

Focused suites:

```text
src/lib/server/client-v1/contract.test.ts
src/lib/server/client-v1/operations.test.ts       # if created
scripts/export-client-v1-contract.test.mjs
src/app/api/api-contracts.test.ts
src/lib/server/client-v1/auth.test.ts
scripts/client-v1-doc-contract.test.mjs
scripts/client-v1-conformance.test.mjs
```

Then run the relevant full API/frontend validation required by path ownership and the real-socket conformance journey.

## 14. Mutation requirements

At least these mutations must be caught:

1. re-add `streaming` with no route;
2. remove a live operation from the declaration;
3. point an operation at a nonexistent route;
4. change a route method without changing metadata;
5. mark an authenticated operation public;
6. remove its required scope;
7. classify an admin route as paired-client authority;
8. add a route without operation metadata;
9. make family derivation omit a live operation;
10. let fixture/docs remain stale after the contract change.

No mutation may survive solely because the test derives both actual and expected values from one changed source.

## 15. PR sequence

Recommended implementation as one contract-focused PR after this plan is approved:

```text
feat(client-v1): make capability discovery operationally truthful
```

The implementation PR should remain limited to:

- contract/operation metadata;
- generated fixture;
- route ownership tests;
- reference documentation;
- compatibility/conformance evidence.

It should not implement streaming, revisions, writes, attachments, or SDK code.

## 16. Completion definition

Cave #4869 closes only when:

- a maintainer approves the selected model;
- every live declaration has a reviewed owner;
- unavailable planned work is absent or explicitly separated;
- route/declaration drift fails CI in both directions;
- fixture and documentation are regenerated and pinned;
- the real-socket compatibility inventory passes;
- the implementation PR merges;
- SDK #33 can vendor the exact merged fixture and commit without reinterpretation.
