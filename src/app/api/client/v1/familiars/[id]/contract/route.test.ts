import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
} from "@/lib/server/client-v1/authority-contract.ts";
import type { ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { createClientV1HpkeTestClient } from "@/lib/server/client-v1/testing/hpke-client.ts";
import { withClientV1HpkeRouteTestAuthority } from "@/lib/server/client-v1/testing/route-authority.ts";
import type { LoadedContractFiles } from "@/lib/server/familiar-contract-files.ts";
import type { VisibleFamiliarRosterEntry } from "@/lib/server/familiar-roster.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createClientV1FamiliarContractGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-familiar-contract-");
const STAMP = "loopback-secret";
const INSTANCE_ID = "client-v1-familiar-contract-route-test";
const BOUND_NOW = 55_000;

const IDENTITY = `# IDENTITY.md - Scribe

- **Name:** Scribe
- **Creature:** Archivist familiar in the Coven
- **Pronouns:** they/them
- **Person:** Val Alexander

## Purpose

I help my person keep an honest record.
`;

const WARD = `[meta]
version = "0.1.0"
familiar = "scribe"
person = "val"

[protected]
files = ["SOUL.md", "IDENTITY.md", "MEMORY.md", "ward.toml"]
invariants = ["familiar.name == 'Scribe'", "familiar.person == 'val'"]

[editable]
paths = ["TOOLS.md", "notes/"]

[approval_tiers]

[approval_tiers.auto]
blocks = ["read files", "write to notes/"]
gate = "regression_suite"

[approval_tiers.human_review]
blocks = ["publish a finding"]
gate = "human_approval"
`;

const SOUL = `# SOUL.md - Who I Am

## I am Scribe

My purpose is **keeping the ledger**.

## Core Work

I help my person record what happened.

## What I Am Not

- Not a code assistant.

## My Boundaries

- Don't invent entries. Ever.
`;

function loaded(overrides: Partial<LoadedContractFiles["files"]> = {}): LoadedContractFiles {
  return {
    workspace: "/home/me/.coven/familiars/scribe",
    files: {
      soul: SOUL,
      identity: IDENTITY,
      ward: WARD,
      memory: "# MEMORY.md\n\n- Something durable worth remembering.\n",
      ...overrides,
    },
  };
}

function roster(...ids: string[]): VisibleFamiliarRosterEntry[] {
  return ids.map((id) => ({ id, display_name: id.toUpperCase(), role: "Familiar" }));
}

function sources(overrides: Partial<ClientV1ReadSources> = {}): ClientV1ReadSources {
  const unsupported = async (): Promise<never> => {
    throw new Error("unsupported read source for this route");
  };
  return {
    listFamiliars: async () => ({
      ok: true,
      config: {} as never,
      target: {} as never,
      roster: roster("mote", "scribe"),
    }),
    listProjects: unsupported,
    listConversations: unsupported,
    loadConversation: unsupported,
    loadFamiliarContract: async () => loaded(),
    readFamiliarAnalytics: unsupported,
    ...overrides,
  };
}

function request(id: string, headers: Record<string, string> = {}, query = ""): Request {
  return new Request(
    `http://127.0.0.1:3020/api/client/v1/familiars/${encodeURIComponent(id)}/contract${query}`,
    { headers: { [LOCAL_PEER_HEADER]: STAMP, ...headers } },
  );
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function withRuntime<T>(
  scopes: ("chat:read" | "chat:write")[],
  body: (runtime: ClientV1Runtime, bearer: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({ credentialRoot: root, loopbackSecret: STAMP });
    const issued = await runtime.credentialStore.issue({
      appName: "OpenCoven Chat",
      installationId: "chat-install-1",
      scopes,
    });
    return await body(runtime, issued.bearer);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("a paired credential reads the familiar's ward, identity, presence, and report", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarContractGetHandler(runtime, sources());
    const response = await handler(
      request("scribe", { authorization: `Bearer ${bearer}` }),
      context("scribe"),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      capabilities: string[];
      data: {
        contract: Record<string, unknown> & {
          report: { pass: boolean; violations: { file: string }[] };
        };
      };
    };
    assert.ok(body.capabilities.includes("familiar-contract"));
    const { contract } = body.data;
    assert.deepEqual(contract, {
      id: "scribe",
      present: { soul: true, identity: true, ward: true, memory: true },
      identity: {
        name: "Scribe",
        creature: "Archivist familiar in the Coven",
        person: "Val Alexander",
      },
      ward: {
        version: "0.1.0",
        familiar: "scribe",
        person: "val",
        protectedFiles: ["SOUL.md", "IDENTITY.md", "MEMORY.md", "ward.toml"],
        invariants: ["familiar.name == 'Scribe'", "familiar.person == 'val'"],
        editablePaths: ["TOOLS.md", "notes/"],
        approvalTiers: {
          auto: ["read files", "write to notes/"],
          humanReview: ["publish a finding"],
        },
      },
      report: contract.report,
    });
    assert.deepEqual(contract.report.violations, [], "the fixture familiar is fully compliant");
    assert.equal(contract.report.pass, true);
    // The private Studio route serves the workspace path; this one does not.
    // A chat:read grant is a grant to read the familiar, not the disk.
    assert.equal(JSON.stringify(body).includes("/home/me"), false);
  });
});

test("a familiar without ward.toml answers with no ward and a failing report, not an error", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarContractGetHandler(
      runtime,
      sources({ loadFamiliarContract: async () => loaded({ ward: null }) }),
    );
    const response = await handler(
      request("scribe", { authorization: `Bearer ${bearer}` }),
      context("scribe"),
    );
    assert.equal(response.status, 200);
    const { contract } = (await response.json() as {
      data: { contract: { present: { ward: boolean }; ward?: unknown; report: { pass: boolean; violations: { file: string }[] } } };
    }).data;
    assert.equal("ward" in contract, false);
    assert.equal(contract.present.ward, false);
    assert.equal(contract.report.pass, false);
    assert.ok(contract.report.violations.some((violation) => violation.file === "ward.toml"));
  });
});

test("an id the roster does not carry is not_found, whatever shape it has", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    let loads = 0;
    const handler = createClientV1FamiliarContractGetHandler(
      runtime,
      sources({
        loadFamiliarContract: async () => {
          loads += 1;
          return loaded();
        },
      }),
    );
    const authorization = `Bearer ${bearer}`;
    for (const id of [
      // On no roster, though a workspace directory might well exist for it:
      // existence is roster membership, so a paired bearer cannot use this
      // route to map which slugs have directories.
      "warden",
      // Shapes the slug guard refuses before any source is consulted.
      "../../../etc/passwd",
      "..",
      "",
      "scribe/contract",
      "scribe.",
      // Prefix and suffix near-misses: matched whole, never by startsWith.
      "scrib",
      "scribe2",
    ]) {
      const response = await handler(request(id, { authorization }), context(id));
      assert.equal(response.status, 404, id);
      const body = await response.json() as { error: { code: string; retryable: boolean } };
      assert.equal(body.error.code, "not_found", id);
      assert.equal(body.error.retryable, false, id);
    }
    assert.equal(loads, 0, "no contract file is read for an id the roster does not carry");
  });
});

test("a roster that cannot be read is service_unavailable, not not_found", async () => {
  // The daemon being down is an ordinary, reportable state of this Cave. It
  // must not be reported as the familiar not existing — a client would drop
  // the familiar from its sidebar — nor as `unauthorized`, which would tell a
  // correctly paired client to discard a working credential.
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarContractGetHandler(
      runtime,
      sources({
        listFamiliars: async () => ({
          ok: false,
          config: {} as never,
          target: {} as never,
          status: 401,
          error: "daemon refused the cave token",
        }),
      }),
    );
    const response = await handler(
      request("scribe", { authorization: `Bearer ${bearer}` }),
      context("scribe"),
    );
    assert.equal(response.status, 503);
    const body = await response.json() as { error: { code: string; retryable: boolean; message: string } };
    assert.equal(body.error.code, "service_unavailable");
    assert.equal(body.error.retryable, true);
    assert.equal(body.error.message.includes("cave token"), false);
  });
});

test("a contract read that throws answers an envelope without the path it named", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarContractGetHandler(
      runtime,
      sources({
        loadFamiliarContract: async () => {
          throw new Error("EACCES: permission denied, open '/home/me/.coven/familiars/scribe/ward.toml'");
        },
      }),
    );
    const response = await handler(
      request("scribe", { authorization: `Bearer ${bearer}` }),
      context("scribe"),
    );
    assert.equal(response.status, 500);
    const body = await response.json() as {
      apiVersion: string;
      error: { code: string; message: string; retryable: boolean; details?: unknown };
    };
    assert.equal(body.error.code, "internal_error");
    assert.equal(body.error.retryable, false);
    assert.equal(body.apiVersion, "1.0");
    assert.equal(body.error.details, undefined);
    assert.equal(body.error.message.includes("/home/me"), false);
  });
});

test("the contract route serves no query parameters at all", async () => {
  await withRuntime(["chat:read"], async (runtime, bearer) => {
    const handler = createClientV1FamiliarContractGetHandler(runtime, sources());
    const authorization = `Bearer ${bearer}`;
    for (const query of ["?limit=5", "?cursor=abc", "?window=7d"]) {
      const response = await handler(request("scribe", { authorization }, query), context("scribe"));
      assert.equal(response.status, 400, query);
      assert.equal(
        (await response.json() as { error: { code: string } }).error.code,
        "invalid_request",
        query,
      );
    }
  });
});

test("the route refuses every request that does not carry a scoped bearer", async () => {
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1FamiliarContractGetHandler(runtime, sources());
    assert.equal((await handler(request("scribe"), context("scribe"))).status, 401);
    assert.equal(
      (await handler(
        request("scribe", { authorization: "Bearer not-a-real-bearer" }),
        context("scribe"),
      )).status,
      401,
    );
    assert.equal(
      (await handler(
        request("scribe", { authorization: `Bearer ${writeOnlyBearer}` }),
        context("scribe"),
      )).status,
      403,
    );
    const unstamped = new Request(
      "http://127.0.0.1:3020/api/client/v1/familiars/scribe/contract",
      { headers: { authorization: `Bearer ${writeOnlyBearer}` } },
    );
    assert.equal((await handler(unstamped, context("scribe"))).status, 401);
  });
});

test("an unauthenticated probe cannot learn whether a familiar exists", async () => {
  let rosterReads = 0;
  let loads = 0;
  await withRuntime(["chat:write"], async (runtime, writeOnlyBearer) => {
    const handler = createClientV1FamiliarContractGetHandler(
      runtime,
      sources({
        listFamiliars: async () => {
          rosterReads += 1;
          return { ok: true, config: {} as never, target: {} as never, roster: roster("scribe") };
        },
        loadFamiliarContract: async () => {
          loads += 1;
          return loaded();
        },
      }),
    );
    const real = await handler(request("scribe"), context("scribe"));
    const invented = await handler(request("warden"), context("warden"));
    assert.equal(real.status, invented.status);
    assert.deepEqual(await real.json(), await invented.json());
    await handler(request("scribe", { authorization: `Bearer ${writeOnlyBearer}` }), context("scribe"));
    assert.deepEqual({ rosterReads, loads }, { rosterReads: 0, loads: 0 });
  });
});

test("bound contract reads carry the encoded route and refuse a plaintext downgrade", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    await withClientV1HpkeRouteTestAuthority(
      { instanceId: INSTANCE_ID, now: BOUND_NOW, seed: 83 },
      async (authority) => {
        const familiarId = "scribe";
        const encodedPath = `/api/client/v1/familiars/${encodeURIComponent(familiarId)}/contract`;
        const runtime = createClientV1Runtime({
          authority: authority.runtime,
          credentialRoot: root,
          loopbackSecret: STAMP,
          now: () => BOUND_NOW,
        });
        const issued = await runtime.credentialStore.issue({
          appName: "OpenCoven Chat",
          installationId: "chat-install-bound-contract",
          scopes: ["chat:read"],
        });
        let loads = 0;
        const handler = createClientV1FamiliarContractGetHandler(
          runtime,
          sources({
            loadFamiliarContract: async () => {
              loads += 1;
              return loaded();
            },
          }),
        );

        const downgrade = await handler(
          request(familiarId, { authorization: `Bearer ${issued.bearer}` }),
          context(familiarId),
        );
        assert.equal(downgrade.status, 426);
        assert.equal(loads, 0);

        const prepared = await createClientV1HpkeTestClient({
          authority: authority.authority,
          instanceId: INSTANCE_ID,
          runtimeNonce: authority.runtimeNonce,
          operation: "familiars.contract.read",
          url: `http://127.0.0.1:3020${encodedPath}`,
          method: "GET",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(17),
          authorization: { kind: "bearer", value: issued.bearer },
        });
        const headers = new Headers(prepared.request.headers);
        headers.set(LOCAL_PEER_HEADER, STAMP);
        const valid = await handler(new Request(prepared.request, { headers }), context(familiarId));
        assert.equal(valid.status, 200);
        assert.equal(valid.headers.get("content-type"), CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE);
        const opened = await prepared.open(valid);
        assert.equal(opened.status, 200);
        const body = JSON.parse(new TextDecoder().decode(opened.body)) as {
          data: { contract: { id: string; ward: { approvalTiers: { humanReview: string[] } } } };
        };
        assert.equal(body.data.contract.id, familiarId);
        assert.deepEqual(body.data.contract.ward.approvalTiers.humanReview, ["publish a finding"]);
        assert.equal(loads, 1);

        const wrongQuery = await handler(
          new Request(`http://127.0.0.1:3020${encodedPath}?limit=1`, { headers }),
          context(familiarId),
        );
        assert.equal(wrongQuery.status, 400);
        assert.equal(loads, 1);
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
