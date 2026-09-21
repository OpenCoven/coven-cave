import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { callDaemonTargetBytes } from "../coven-daemon.ts";
import type { DaemonByteRequest, DaemonResponse } from "../coven-daemon.ts";
import { createAutomationReadClient } from "./coven-automations-sdk.ts";

const action = "coven.automations.events.subscribe.v1";
const stream = { kind: "occurrence" as const, id: "synthetic-occurrence" };
const capabilities = { capabilities: [{
  id: "coven.automations", label: "Automations", adapter: "coven-daemon",
  status: "available", policy: "allow", actions: [action],
  variantNegotiation: {
    version: 1, contractProfile: "coven.automations.v1", description: "Synthetic",
    supported: { triggers: [], conditions: [], actions: [], triggerPolicies: [], deliveryPolicies: [], retentionPolicies: [] },
    experimental: [], refused: [], negotiationRules: [],
  },
}] };
const event = {
  schemaVersion: "coven.automations.v1", eventId: "evtocc00a7c3e9d24b6f8051", stream, sequence: 0,
  recordedAt: "2026-09-21T00:00:00.000Z", observedAt: "2026-09-21T00:00:00.000Z",
  producer: { component: "coven-daemon", instanceId: "synthetic" },
  kind: "occurrence.transitioned", summary: "Planned",
  payload: { entity: "occurrence", from: "none", to: "planned", reason: "slot_fenced" },
  privacy: { classification: "operational", retention: { classification: "standard" } },
};
const page = { stream, after: null, events: [event], nextAfter: 0, checkpoint: "ecp00000000000000000000000000000001", checkpointExpiresAt: "2026-10-01T00:00:00.000Z" };
const envelope = { ok: true, accepted: true, action, status: "completed", result: page };

function setup(result: unknown = envelope, status = 200) {
  const requests: DaemonByteRequest[] = [];
  const transport = async (request: DaemonByteRequest): Promise<DaemonResponse<Uint8Array>> => {
    requests.push(request);
    const value = request.method === "GET" ? capabilities : result;
    return { ok: status === 200, status: request.method === "GET" ? 200 : status,
      data: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)) };
  };
  return { client: createAutomationReadClient(transport), requests };
}

test("canonical sequence zero is decoded from result through bounded bytes", async () => {
  const { client, requests } = setup();
  assert.deepEqual(await client.events({ stream }), page);
  assert.equal(requests[0].path, "/api/v1/capabilities");
  assert.equal(requests[0].maxResponseBytes, 16_384);
  assert.equal(requests[1].path, "/api/v1/actions");
  assert.deepEqual(requests[1].body, { action, stream });
  assert.equal(requests[1].maxResponseBytes, 1_048_576);
  assert.ok(requests.every(request => request.retryTransportFailure === false));
  assert.ok(requests.every(request => request.hardTimeoutMs! > 0 && request.hardTimeoutMs! <= 6_000));
});

test("duplicate JSON keys reach the SDK unchanged and are refused", async () => {
  const { client } = setup(JSON.stringify(envelope).replace('"ok":true', '"ok":true,"ok":true'));
  await assert.rejects(client.events({ stream }), { code: "invalid_response" });
});

test("producer cursor expiry survives HTTP error status without retry or reset", async () => {
  const { client, requests } = setup({
    ok: false, accepted: false, action, status: "rejected", reason: "expired",
    error: { code: "CURSOR_EXPIRED", httpStatus: 410, message: "expired", retryable: false,
      details: { expiredAt: "2026-09-21T00:00:00.000Z" } },
  }, 410);
  await assert.rejects(client.events({ stream, checkpoint: "checkpoint" }), { code: "CURSOR_EXPIRED", statusCode: 410 });
  assert.equal(requests.length, 2);
});

test("contradictory duplicates and mismatched streams fail closed", async () => {
  for (const result of [
    { ...page, events: [event, { ...event, summary: "Contradictory" }] },
    { ...page, stream: { ...stream, id: "other" } },
  ]) {
    await assert.rejects(setup({ ...envelope, result }).client.events({ stream }), { code: "invalid_response" });
  }
});

test("cancellation before dispatch does not reach transport", async () => {
  const { client, requests } = setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.events({ stream }, { signal: controller.signal }));
  assert.equal(requests.length, 0);
});

test("unavailable transport has a sanitized error and never becomes an empty list", async () => {
  const client = createAutomationReadClient(async () => ({ ok: false, status: 0, data: null, error: "/private/secret" }));
  await assert.rejects(client.events({ stream }), error => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(JSON.stringify(error), /private|secret/);
    return true;
  });
});

test("an in-flight cancelled read receives the signal and is not replayed", async () => {
  const controller = new AbortController();
  let reads = 0;
  let receivedAbort = false;
  const client = createAutomationReadClient(async request => {
    if (request.method === "GET") return { ok: true, status: 200, data: Buffer.from(JSON.stringify(capabilities)) };
    reads++;
    return new Promise(resolve => {
      request.signal!.addEventListener("abort", () => {
        receivedAbort = true;
        resolve({ ok: false, status: 0, data: null });
      }, { once: true });
      controller.abort();
    });
  });
  await assert.rejects(client.events({ stream }, { signal: controller.signal }));
  assert.equal(receivedAbort, true);
  assert.equal(reads, 1);
});

test("subscription reads on demand and closing it stops further transport work", async () => {
  const { client, requests } = setup();
  const subscription = client.subscribe({ stream });
  assert.equal(requests.length, 0);
  assert.deepEqual((await subscription.next()).value, page);
  assert.equal(requests.length, 2);
  await subscription.return!();
  assert.equal((await subscription.next()).done, true);
  assert.equal(requests.length, 2);
});

test("real Cave HTTP byte transport preserves canonical replies and malformed JSON", async () => {
  let duplicateKeys = false;
  const server = createServer(async (req, res) => {
    if (req.url === "/api/v1/capabilities") {
      res.end(JSON.stringify(capabilities));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { action, stream });
    const bytes = JSON.stringify(envelope);
    res.end(duplicateKeys ? bytes.replace('"ok":true', '"ok":true,"ok":true') : bytes);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const target = { mode: "hub" as const, label: "Server hub" as const, url: `http://127.0.0.1:${address.port}` };
  const client = createAutomationReadClient(request => callDaemonTargetBytes(target, request));
  try {
    assert.deepEqual(await client.events({ stream }), page);
    duplicateKeys = true;
    await assert.rejects(client.events({ stream }), { code: "invalid_response" });
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  }
});
