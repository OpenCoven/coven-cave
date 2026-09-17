import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_V1_CAPABILITIES,
  CLIENT_V1_OPERATIONS,
  CLIENT_V1_PUBLIC_ROUTES,
  CLIENT_V1_SCOPES,
} from "./contract.ts";
import {
  CLIENT_V1_OPERATION_DEFINITIONS,
  clientV1CapabilityFamilies,
  clientV1Operation,
  clientV1OperationIds,
  clientV1OperationRecords,
  clientV1ReviewedCapabilityFamilyOrder,
} from "./operations.ts";

// The registry's own invariants. Route ownership — does a `route.ts` on disk
// actually serve each record's method and path — is asserted separately in
// src/app/api/api-contracts.test.ts, which is the suite that already walks the
// App Router tree. Both halves are required: this file cannot see the
// filesystem, and that one cannot see the type-level contract.

const OPERATION_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u;

test("declares exactly the reviewed operation inventory, in order", () => {
  // The ratchet. CLIENT_V1_OPERATIONS is a hand-maintained literal in
  // contract.ts and this is the derivation from the registry; asserting them
  // equal is what makes adding a record without declaring it — or deleting a
  // record and silently shrinking the declaration — a failure rather than a
  // quiet contract change. Deriving both from the registry would assert
  // nothing at all.
  assert.deepEqual(clientV1OperationIds(), [...CLIENT_V1_OPERATIONS]);
  assert.deepEqual(clientV1OperationIds(), [
    "health.read",
    "pairing.create",
    "pairing.poll",
    "pairing.exchange",
    "pairing.admin.list",
    "pairing.admin.decide",
    "credentials.admin.list",
    "credentials.admin.revoke",
    "status.admin.read",
    "familiars.list",
    "familiars.contract.read",
    "familiars.analytics.read",
    "projects.list",
    "conversations.list",
    "conversations.read",
    "messages.list",
  ]);
});

test("gives every operation a unique, well-formed id", () => {
  const ids = clientV1OperationIds();
  assert.equal(new Set(ids).size, ids.length, "operation ids must be unique");
  for (const id of ids) {
    assert.match(id, OPERATION_ID, `${id} is not a dotted lowercase operation id`);
  }
});

test("freezes the registry so a caller cannot widen it at runtime", () => {
  assert.equal(Object.isFrozen(CLIENT_V1_OPERATION_DEFINITIONS), true);
  for (const definition of CLIENT_V1_OPERATION_DEFINITIONS) {
    assert.equal(Object.isFrozen(definition), true, definition.id);
    assert.equal(Object.isFrozen(definition.families), true, definition.id);
  }
  assert.throws(
    () => {
      (CLIENT_V1_OPERATION_DEFINITIONS as unknown as unknown[]).push({});
    },
    /TypeError|Cannot add property|object is not extensible/i,
  );
});

test("derives the live capability families from operation membership", () => {
  // THE LOAD-BEARING ASSERTION for #4869. `streaming` and `revisions` were
  // advertised for months with no route that could serve either, so
  // `client.supports("streaming")` would have returned a false operational
  // claim. A family survives here only because some operation claims it, and
  // every operation is bound to a route on disk by api-contracts.test.ts — so a
  // capability added without an owner cannot reach this list, and the
  // comparison against the reviewed literal fails.
  assert.deepEqual(clientV1CapabilityFamilies(), [...CLIENT_V1_CAPABILITIES]);
  for (const unowned of ["streaming", "revisions"]) {
    assert.equal(
      (CLIENT_V1_CAPABILITIES as readonly string[]).includes(unowned),
      false,
      `${unowned} has no owning route and must not be advertised as live`,
    );
    assert.equal(
      clientV1CapabilityFamilies().includes(unowned as never),
      false,
      `${unowned} must not be derivable from any operation's families`,
    );
  }
});

test("claims no capability family that is not in the reviewed order", () => {
  // The derivation filters the reviewed order by what is claimed, so a family
  // typo'd into a record's `families` would simply vanish rather than fail.
  // This is the assertion that turns that silence into an error.
  const reviewed = new Set(clientV1ReviewedCapabilityFamilyOrder());
  for (const definition of CLIENT_V1_OPERATION_DEFINITIONS) {
    assert.ok(definition.families.length > 0, `${definition.id} names no capability family`);
    for (const family of definition.families) {
      assert.ok(
        reviewed.has(family),
        `${definition.id} claims unreviewed capability family ${JSON.stringify(family)}`,
      );
    }
    assert.equal(
      new Set(definition.families).size,
      definition.families.length,
      `${definition.id} repeats a capability family`,
    );
  }
  // And the converse: a family in the reviewed order that nothing claims is a
  // roadmap entry that has crept back into the compatibility surface.
  const claimed = new Set(
    CLIENT_V1_OPERATION_DEFINITIONS.flatMap((definition) => [...definition.families]),
  );
  const unclaimed = clientV1ReviewedCapabilityFamilyOrder().filter(
    (family) => !claimed.has(family),
  );
  assert.deepEqual(unclaimed, [], `reviewed families with no live operation: ${unclaimed.join(", ")}`);
});

test("keeps cursors a cross-cutting family rather than a route of its own", () => {
  // `cursors` is the reason family membership is explicit metadata rather than
  // inferred from the path: there is no /cursors route and there never will be.
  // It is claimed by exactly the paged reads, and NOT by conversations.read,
  // which refuses `limit` and `cursor` outright.
  const paged = CLIENT_V1_OPERATION_DEFINITIONS.filter((definition) =>
    definition.families.includes("cursors"),
  ).map((definition) => definition.id);
  assert.deepEqual(paged, [
    "familiars.list",
    "projects.list",
    "conversations.list",
    "messages.list",
  ]);
  assert.equal(clientV1Operation("conversations.read")?.families.includes("cursors"), false);
  // The two familiar detail reads are single records narrowed by query, not
  // paged: `familiars.analytics.read` takes `window` and `recent` and still
  // answers one record, so neither claims paging either.
  assert.equal(clientV1Operation("familiars.contract.read")?.families.includes("cursors"), false);
  assert.equal(clientV1Operation("familiars.analytics.read")?.families.includes("cursors"), false);
});

test("binds every operation's authority class to its id and its scope", () => {
  for (const definition of CLIENT_V1_OPERATION_DEFINITIONS) {
    // The `.admin.` infix is the wire-visible authority marker: an SDK reading
    // the id alone must be able to tell that a paired bearer can never invoke
    // it. Asserted in both directions so neither the name nor the class can
    // drift alone.
    assert.equal(
      definition.id.includes(".admin."),
      definition.ingress === "admin",
      `${definition.id}: the .admin. infix and ingress "${definition.ingress}" disagree`,
    );
    if (definition.ingress === "authenticated") {
      assert.ok(
        definition.scope !== null && (CLIENT_V1_SCOPES as readonly string[]).includes(definition.scope),
        `${definition.id} is bearer-authenticated and must name a contract scope`,
      );
    } else {
      // Null is a claim, not an omission: public and admin operations are not
      // reached with a scoped bearer, so naming a scope there would imply a
      // bearer could satisfy them.
      assert.equal(
        definition.scope,
        null,
        `${definition.id} is ${definition.ingress} and must not name a bearer scope`,
      );
    }
    assert.ok(
      definition.path.startsWith("/api/client/v1/"),
      `${definition.id} leaves the client v1 surface: ${definition.path}`,
    );
    assert.equal(
      definition.path.startsWith("/api/client/v1/admin/"),
      definition.ingress === "admin",
      `${definition.id}: the admin path family and ingress "${definition.ingress}" disagree`,
    );
  }
});

test("pins every operation's credential and authority binding", () => {
  assert.deepEqual(
    Object.fromEntries(
      CLIENT_V1_OPERATION_DEFINITIONS.map((operation) => [
        operation.id,
        {
          credential: operation.credential,
          binding: operation.binding,
        },
      ]),
    ),
    {
      "health.read": { credential: "none", binding: "none" },
      "pairing.create": { credential: "none", binding: "none" },
      "pairing.poll": {
        credential: "pairing-secret",
        binding: "hpke-bound-v1",
      },
      "pairing.exchange": {
        credential: "pairing-secret",
        binding: "hpke-bound-v1",
      },
      "pairing.admin.list": { credential: "admin", binding: "none" },
      "pairing.admin.decide": { credential: "admin", binding: "none" },
      "credentials.admin.list": { credential: "admin", binding: "none" },
      "credentials.admin.revoke": { credential: "admin", binding: "none" },
      "status.admin.read": { credential: "admin", binding: "none" },
      "familiars.list": { credential: "bearer", binding: "hpke-bound-v1" },
      "familiars.contract.read": {
        credential: "bearer",
        binding: "hpke-bound-v1",
      },
      "familiars.analytics.read": {
        credential: "bearer",
        binding: "hpke-bound-v1",
      },
      "projects.list": { credential: "bearer", binding: "hpke-bound-v1" },
      "conversations.list": {
        credential: "bearer",
        binding: "hpke-bound-v1",
      },
      "conversations.read": {
        credential: "bearer",
        binding: "hpke-bound-v1",
      },
      "messages.list": { credential: "bearer", binding: "hpke-bound-v1" },
    },
  );
});

test("binds HPKE only to pairing-secret and bearer operations", () => {
  for (const definition of CLIENT_V1_OPERATION_DEFINITIONS) {
    if (definition.binding === "hpke-bound-v1") {
      assert.ok(
        definition.credential === "pairing-secret" || definition.credential === "bearer",
        `${definition.id}: HPKE binding cannot carry ${definition.credential}`,
      );
    }
    if (definition.ingress === "admin") {
      assert.equal(
        definition.credential,
        "admin",
        `${definition.id}: admin ingress must use the admin credential`,
      );
      assert.equal(
        definition.binding,
        "none",
        `${definition.id}: admin authority is outside hpke-bound-v1`,
      );
    }
  }

  assert.deepEqual(
    CLIENT_V1_OPERATION_DEFINITIONS.filter((definition) =>
      definition.id === "health.read" || definition.id === "pairing.create"
    ).map((definition) => ({
      id: definition.id,
      credential: definition.credential,
      binding: definition.binding,
    })),
    [
      { id: "health.read", credential: "none", binding: "none" },
      { id: "pairing.create", credential: "none", binding: "none" },
    ],
  );
});

test("matches the reviewed public bootstrap routes exactly", () => {
  // CLIENT_V1_PUBLIC_ROUTES is what the discovery fixture tells clients they
  // may call before pairing, and proxy-helpers derives its credential-free
  // ingress set from it. A public operation the contract does not publish would
  // be a route the proxy answers 403 for; a published route with no public
  // operation would be an inventory that omits the only entry point a client
  // has.
  const publicOperations = CLIENT_V1_OPERATION_DEFINITIONS.filter(
    (definition) => definition.ingress === "public",
  ).map((definition) => ({ method: definition.method, path: definition.path }));
  assert.deepEqual(publicOperations, [...CLIENT_V1_PUBLIC_ROUTES]);
});

test("serves one operation per method and path", () => {
  const seen = new Set<string>();
  for (const definition of CLIENT_V1_OPERATION_DEFINITIONS) {
    const key = `${definition.method} ${definition.path}`;
    assert.equal(seen.has(key), false, `${key} is claimed by more than one operation`);
    seen.add(key);
  }
});

test("renders public JSON-safe records for the generated fixture", () => {
  const records = clientV1OperationRecords();
  assert.equal(records.length, CLIENT_V1_OPERATION_DEFINITIONS.length);
  assert.deepEqual(records[0], {
    id: "health.read",
    method: "GET",
    path: "/api/client/v1/health",
    ingress: "public",
    scope: null,
    credential: "none",
    binding: "none",
    families: ["health"],
  });
  assert.deepEqual(records.at(-1), {
    id: "messages.list",
    method: "GET",
    path: "/api/client/v1/conversations/:id/messages",
    ingress: "authenticated",
    scope: "chat:read",
    credential: "bearer",
    binding: "hpke-bound-v1",
    families: ["conversation-messages", "cursors"],
  });
  // A copy, not the frozen registry: the fixture builder mutates nothing, but a
  // caller that did would otherwise poison every later render.
  records[0].families.push("poisoned");
  assert.deepEqual(clientV1OperationRecords()[0].families, ["health"]);
});

test("publishes credential and binding on every manifest record", () => {
  assert.deepEqual(
    clientV1OperationRecords().map(({ id, credential, binding }) => ({
      id,
      credential,
      binding,
    })),
    CLIENT_V1_OPERATION_DEFINITIONS.map(({ id, credential, binding }) => ({
      id,
      credential,
      binding,
    })),
  );
});

test("resolves an operation by id and refuses an unknown one", () => {
  assert.equal(clientV1Operation("conversations.list")?.path, "/api/client/v1/conversations");
  assert.equal(clientV1Operation("streaming.subscribe"), undefined);
});
