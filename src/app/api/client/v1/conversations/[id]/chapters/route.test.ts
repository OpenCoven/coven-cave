import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import type { ConversationFile } from "@/lib/cave-conversations.ts";
import type { ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { CLIENT_V1_LIMITS } from "@/lib/server/client-v1/contract.ts";
import { createClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { createClientV1HpkeTestClient } from "@/lib/server/client-v1/testing/hpke-client.ts";
import { withClientV1HpkeRouteTestAuthority } from "@/lib/server/client-v1/testing/route-authority.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";
import { createClientV1ConversationChaptersGetHandler } from "./route.ts";

const STAMP = "test-chapter-loopback";
const record: ConversationFile = {
  sessionId: "chapter one 雪", familiarId: "cody", harness: "claude",
  updatedAt: "2026-09-09T00:00:00Z",
  turns: [{ id: "t1", role: "user", text: "body must not appear", createdAt: "2026-09-09T00:00:00Z" }],
};
const context = { params: Promise.resolve({ id: record.sessionId }) };
const url = `http://127.0.0.1:3020/api/client/v1/conversations/${encodeURIComponent(record.sessionId)}/chapters`;

test("chapter route requires scope and peer, charges credential and refuses aliases and invalid query", async () => {
  const root = resolve(process.cwd(), `.scratch-chapter-route-${randomUUID()}`);
  await mkdir(root);
  try {
    const runtime = createClientV1Runtime({ credentialRoot: root, loopbackSecret: STAMP });
    const allowed = await runtime.credentialStore.issue({ appName: "test", installationId: "one", scopes: ["chat:read"] });
    const denied = await runtime.credentialStore.issue({ appName: "test", installationId: "two", scopes: ["chat:write"] });
    let reads = 0;
    const handler = createClientV1ConversationChaptersGetHandler(runtime, {
      loadConversation: async () => { reads += 1; return record; },
    } as unknown as ClientV1ReadSources);
    const headers = { [LOCAL_PEER_HEADER]: STAMP, authorization: `Bearer ${allowed.bearer}` };
    assert.equal((await handler(new Request(url), context)).status, 401);
    assert.equal((await handler(new Request(url, { headers: { ...headers, authorization: `Bearer ${denied.bearer}` } }), context)).status, 403);
    for (const query of ["offset=2", "limit=0", "limit=1.5", `limit=${CLIENT_V1_LIMITS.maxPageSize + 1}`]) {
      assert.equal((await handler(new Request(`${url}?${query}`, { headers }), context)).status, 400);
    }
    assert.equal(reads, 0);
    const response = await handler(new Request(url, { headers }), context);
    assert.equal(response.status, 200);
    assert.equal(reads, 1);
    const body = await response.json();
    assert.equal(body.data.chapters[0].firstTurnId, "t1");
    assert.equal(body.data.chapters[0].lastTurnId, "t1");
    assert.equal(body.data.contextStatus, "context-unverified");
    assert.equal(body.cursor, undefined);
    assert.ok(!JSON.stringify(body).includes("body must not appear"));
    assert.equal((await handler(new Request(url, { headers }), { params: Promise.resolve({ id: "CHAPTER ONE 雪" }) })).status, 404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chapter operation cannot downgrade HPKE and is served through bound authority", async () => {
  const root = resolve(process.cwd(), `.scratch-chapter-hpke-${randomUUID()}`);
  await mkdir(root);
  try {
    await withClientV1HpkeRouteTestAuthority({ instanceId: "chapters-test", now: 55_000, seed: 91 }, async (authority) => {
      const runtime = createClientV1Runtime({ authority: authority.runtime, credentialRoot: root, loopbackSecret: STAMP, now: () => 55_000 });
      const issued = await runtime.credentialStore.issue({ appName: "test", installationId: "one", scopes: ["chat:read"] });
      let reads = 0;
      const pagedRecord: ConversationFile = {
        ...record,
        turns: Array.from({ length: CLIENT_V1_LIMITS.maxPageSize + 1 }, (_, index) => ({
          id: `t${index + 1}`, role: "user", text: "body must not appear",
          createdAt: new Date(Date.UTC(2026, 8, 9) + index * 86_400_000).toISOString(),
        })),
      };
      const handler = createClientV1ConversationChaptersGetHandler(runtime, {
        loadConversation: async () => { reads += 1; return pagedRecord; },
      } as unknown as ClientV1ReadSources);
      assert.equal((await handler(new Request(url, { headers: { [LOCAL_PEER_HEADER]: STAMP, authorization: `Bearer ${issued.bearer}` } }), context)).status, 426);
      assert.equal(reads, 0);
      const prepared = await createClientV1HpkeTestClient({
        authority: authority.authority, instanceId: "chapters-test", runtimeNonce: authority.runtimeNonce,
        operation: "chapters.list", url: `${url}?limit=${CLIENT_V1_LIMITS.maxPageSize}`, method: "GET", issuedAt: 55_000,
        requestNonce: new Uint8Array(32).fill(17), authorization: { kind: "bearer", value: issued.bearer },
      });
      const headers = new Headers(prepared.request.headers);
      headers.set(LOCAL_PEER_HEADER, STAMP);
      const response = await handler(new Request(prepared.request, { headers }), context);
      assert.equal(response.status, 200);
      const opened = await prepared.open(response);
      const body = JSON.parse(new TextDecoder().decode(opened.body));
      assert.equal(body.data.chapters[0].firstTurnId, "t1");
      assert.equal(body.data.chapters.length, CLIENT_V1_LIMITS.maxPageSize);
      assert.equal(body.data.status, "complete");
      assert.match(body.data.sourceRevision, /^[0-9a-f]{64}$/);
      assert.equal(body.cursor.hasMore, true);
      assert.ok(body.cursor.next.length <= CLIENT_V1_LIMITS.cursorCharacters);
      assert.ok(!JSON.stringify(body).includes("body must not appear"));
      assert.equal(reads, 1);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
