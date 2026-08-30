/**
 * The reviewed inventory of operations this build of Client v1 actually serves.
 *
 * WHY THIS FILE EXISTS. `CLIENT_V1_CAPABILITIES` used to be a roadmap wearing
 * the name of an inventory: it advertised `streaming` and `revisions`, and
 * neither had a route — no handler emitted a stream, and no handler emitted or
 * consumed a revision token. A client helper spelled `client.supports("…")`
 * would therefore have returned a *false operational claim*, which is what
 * blocked freezing the SDK 0.1.0 compatibility contract (#4869, upstream
 * OpenCoven/sdk#31).
 *
 * The fix is not to hand-prune the list — a hand-kept list is exactly what
 * drifted — but to make the declaration derivable from route ownership and then
 * assert that derivation against the routes on disk. This module is the
 * reviewed half of that pair: one record per invokable operation, naming the
 * method and path that serve it, its ingress class, credential and authority
 * binding, the scope it requires, and the broad capability families it
 * contributes to.
 *
 * WHAT IS AND IS NOT AUTHORITATIVE HERE. This file is a *review record*, not a
 * derivation from the filesystem. It cannot prove a route exists; it states
 * which routes the reviewers signed off on. Two independent checks close the
 * loop, and neither may be dropped in favour of the other:
 *
 *   - `src/app/api/api-contracts.test.ts` walks `src/app/api/client/v1` and
 *     asserts a bijection between the `route.ts` method exports on disk and the
 *     records below. A route that lands without a record fails; a record whose
 *     route or method is gone fails.
 *   - `contract.ts` restates the derived id list and family summary as reviewed
 *     literals (`CLIENT_V1_OPERATIONS`, `CLIENT_V1_CAPABILITIES`), and
 *     `operations.test.ts` asserts the derivation matches them. That is the
 *     compatibility ratchet: removing or renaming a live declaration cannot
 *     happen as a side effect of deleting a route, because the literal has to be
 *     edited too, in review.
 *
 * Deriving both sides from this one file would make the pair assert nothing, so
 * the duplication is deliberate. See the plan at
 * `docs/superpowers/plans/2026-08-22-client-v1-operational-capabilities.md` §10.
 *
 * PURITY. Frozen data with no side effects and no route imports, so
 * `contract.ts` — which `proxy-helpers.ts` pulls in precisely because it costs
 * the proxy no runtime dependency — can read it without dragging a handler
 * graph along. All local imports are `import type`, which is erased, so these
 * contract modules do not form a runtime cycle.
 */

import type {
  ClientV1OperationBinding,
  ClientV1OperationCredential,
} from "./authority-contract.ts";
import type {
  ClientV1Capability,
  ClientV1Operation,
  ClientV1Scope,
} from "./contract.ts";

/**
 * Who may reach an operation.
 *
 * These are three genuinely different credentials, not three strengths of one:
 *
 *   - `public` — the bootstrap surface listed in `CLIENT_V1_PUBLIC_ROUTES`.
 *     It is not reached with a bearer or admin sidecar token, though pairing
 *     poll/exchange carry their pairing secret. Still loopback-only; "public"
 *     names the absence of bearer/admin ingress, never an open network route.
 *   - `authenticated` — a paired client's bearer, carrying the declared scope.
 *     This is the only class an external application can ever hold.
 *   - `admin` — the Cave's own per-launch sidecar token (`requireClientV1Admin`),
 *     over direct loopback. A paired bearer NEVER satisfies it, no matter which
 *     scopes it was granted, so an SDK must not read a `.admin.` operation as
 *     something it can invoke.
 */
export type ClientV1OperationIngress = "public" | "admin" | "authenticated";

export type ClientV1OperationDefinition = {
  id: ClientV1Operation;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** The contract spelling, with `:id` where Next writes `[id]`. */
  path: string;
  ingress: ClientV1OperationIngress;
  /**
   * The scope `requireScope` demands, or null.
   *
   * Null is a claim, not a gap: public and admin operations are not reached
   * with a scoped bearer. An `authenticated` operation must name one.
   */
  scope: ClientV1Scope | null;
  /** The credential carried by this operation, independent of ingress class. */
  credential: ClientV1OperationCredential;
  /** Whether the credential is atomically carried by the HPKE authority. */
  binding: ClientV1OperationBinding;
  /**
   * The broad capability families this operation contributes to.
   *
   * Explicit membership rather than path inference, because the interesting
   * family has no route of its own: `cursors` is cross-cutting — the four paged
   * reads emit an envelope cursor and `conversations.read` does not — so no
   * amount of looking at paths would derive it. Inferring family from the first
   * path segment would also silently rename a family the day a route moves.
   */
  families: readonly ClientV1Capability[];
};

const freezeDefinition = (
  definition: ClientV1OperationDefinition,
): ClientV1OperationDefinition =>
  Object.freeze({ ...definition, families: Object.freeze([...definition.families]) });

/**
 * Every operation this build serves, in the reviewed canonical order:
 * bootstrap, then administrator, then the canonical reads.
 *
 * The order is part of the contract because the fixture is byte-pinned — a
 * reshuffle would rewrite the generated artifact and its digest for no
 * behavioural reason, and reviewers would learn to skim that diff.
 */
export const CLIENT_V1_OPERATION_DEFINITIONS: readonly ClientV1OperationDefinition[] =
  Object.freeze([
    freezeDefinition({
      id: "health.read",
      method: "GET",
      path: "/api/client/v1/health",
      ingress: "public",
      scope: null,
      credential: "none",
      binding: "none",
      families: ["health"],
    }),
    freezeDefinition({
      id: "pairing.create",
      method: "POST",
      path: "/api/client/v1/pairing/requests",
      ingress: "public",
      scope: null,
      credential: "none",
      binding: "none",
      families: ["pairing"],
    }),
    freezeDefinition({
      id: "pairing.poll",
      method: "GET",
      path: "/api/client/v1/pairing/requests/:id",
      ingress: "public",
      scope: null,
      credential: "pairing-secret",
      binding: "hpke-bound-v1",
      families: ["pairing"],
    }),
    freezeDefinition({
      id: "pairing.exchange",
      method: "POST",
      path: "/api/client/v1/pairing/requests/:id/exchange",
      ingress: "public",
      scope: null,
      credential: "pairing-secret",
      binding: "hpke-bound-v1",
      families: ["pairing"],
    }),
    freezeDefinition({
      id: "pairing.admin.list",
      method: "GET",
      path: "/api/client/v1/admin/pairing-requests",
      ingress: "admin",
      scope: null,
      credential: "admin",
      binding: "none",
      families: ["pairing"],
    }),
    freezeDefinition({
      id: "pairing.admin.decide",
      method: "POST",
      path: "/api/client/v1/admin/pairing-requests/:id/decision",
      ingress: "admin",
      scope: null,
      credential: "admin",
      binding: "none",
      families: ["pairing"],
    }),
    freezeDefinition({
      id: "credentials.admin.list",
      method: "GET",
      path: "/api/client/v1/admin/credentials",
      ingress: "admin",
      scope: null,
      credential: "admin",
      binding: "none",
      families: ["credentials"],
    }),
    freezeDefinition({
      id: "credentials.admin.revoke",
      method: "DELETE",
      path: "/api/client/v1/admin/credentials/:id",
      ingress: "admin",
      scope: null,
      credential: "admin",
      binding: "none",
      families: ["credentials"],
    }),
    freezeDefinition({
      id: "status.admin.read",
      method: "GET",
      path: "/api/client/v1/admin/status",
      ingress: "admin",
      scope: null,
      credential: "admin",
      binding: "none",
      // The operational-state family: like health.read, this answers what
      // state the surface is in, never user data. It is administrator-only —
      // the discovery record and the ownership waiver are host configuration —
      // so a paired bearer can never read it.
      families: ["health"],
    }),
    freezeDefinition({
      id: "familiars.list",
      method: "GET",
      path: "/api/client/v1/familiars",
      ingress: "authenticated",
      scope: "chat:read",
      credential: "bearer",
      binding: "hpke-bound-v1",
      families: ["familiars", "cursors"],
    }),
    freezeDefinition({
      id: "projects.list",
      method: "GET",
      path: "/api/client/v1/projects",
      ingress: "authenticated",
      scope: "chat:read",
      credential: "bearer",
      binding: "hpke-bound-v1",
      families: ["projects", "cursors"],
    }),
    freezeDefinition({
      id: "conversations.list",
      method: "GET",
      path: "/api/client/v1/conversations",
      ingress: "authenticated",
      scope: "chat:read",
      credential: "bearer",
      binding: "hpke-bound-v1",
      families: ["conversations", "cursors"],
    }),
    freezeDefinition({
      id: "conversations.read",
      method: "GET",
      path: "/api/client/v1/conversations/:id",
      ingress: "authenticated",
      scope: "chat:read",
      credential: "bearer",
      binding: "hpke-bound-v1",
      // No `cursors`: this route serves one transcript header and refuses
      // `limit` and `cursor` outright. Listing it here would make the family
      // summary claim paging on a route that answers invalid_request for it.
      families: ["conversations"],
    }),
    freezeDefinition({
      id: "messages.list",
      method: "GET",
      path: "/api/client/v1/conversations/:id/messages",
      ingress: "authenticated",
      scope: "chat:read",
      credential: "bearer",
      binding: "hpke-bound-v1",
      families: ["conversation-messages", "cursors"],
    }),
  ]);

/**
 * The canonical family order.
 *
 * Derivation needs a total order, and "order of first appearance in the
 * registry" would make an unrelated reshuffle of the operation list rewrite the
 * capability array and the fixture digest with it. Stated once, here.
 */
const CLIENT_V1_CAPABILITY_FAMILY_ORDER: readonly ClientV1Capability[] = Object.freeze([
  "health",
  "pairing",
  "credentials",
  "familiars",
  "projects",
  "conversations",
  "conversation-messages",
  "cursors",
]);

/** Operation ids in the reviewed canonical order. */
export function clientV1OperationIds(): ClientV1Operation[] {
  return CLIENT_V1_OPERATION_DEFINITIONS.map((definition) => definition.id);
}

/**
 * The live capability families, derived from operation membership.
 *
 * This is the function that makes the declaration truthful: a family survives
 * only because some operation claims it, and every operation is bound to a
 * route on disk by `api-contracts.test.ts`. A family nothing claims cannot
 * appear here at all, which is why `streaming` and `revisions` are gone rather
 * than merely deleted from a list someone had to remember to prune.
 */
export function clientV1CapabilityFamilies(): ClientV1Capability[] {
  const claimed = new Set<string>();
  for (const definition of CLIENT_V1_OPERATION_DEFINITIONS) {
    for (const family of definition.families) claimed.add(family);
  }
  return CLIENT_V1_CAPABILITY_FAMILY_ORDER.filter((family) => claimed.has(family));
}

/** Every family named by the canonical order, live or not. Test seam. */
export function clientV1ReviewedCapabilityFamilyOrder(): ClientV1Capability[] {
  return [...CLIENT_V1_CAPABILITY_FAMILY_ORDER];
}

/** One operation by id, or undefined. */
export function clientV1Operation(
  id: string,
): ClientV1OperationDefinition | undefined {
  return CLIENT_V1_OPERATION_DEFINITIONS.find((definition) => definition.id === id);
}

/**
 * The definitions as plain JSON records, for the generated contract fixture.
 *
 * Sorted `families` are NOT re-sorted here: membership order is reviewed with
 * the record, and re-sorting would hide a reviewer's intent behind an
 * alphabetiser.
 */
export function clientV1OperationRecords(): {
  id: string;
  method: string;
  path: string;
  ingress: string;
  scope: string | null;
  credential: ClientV1OperationCredential;
  binding: ClientV1OperationBinding;
  families: string[];
}[] {
  return CLIENT_V1_OPERATION_DEFINITIONS.map((definition) => ({
    id: definition.id,
    method: definition.method,
    path: definition.path,
    ingress: definition.ingress,
    scope: definition.scope,
    credential: definition.credential,
    binding: definition.binding,
    families: [...definition.families],
  }));
}
