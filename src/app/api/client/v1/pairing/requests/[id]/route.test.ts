import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  CLIENT_V1_HPKE_HEADERS,
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
} from "@/lib/server/client-v1/authority-contract.ts";
import { base64UrlEncode } from "@/lib/server/client-v1/hpke-bound-v1.ts";
import { PAIRING_TTL_MS } from "@/lib/server/client-v1/pairing-store.ts";
import { CLIENT_V1_PAIRING_COMPARISON_FAILURE_LIMIT } from "@/lib/server/client-v1/rate-limit.ts";
import { createClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { createClientV1HpkeTestClient } from "@/lib/server/client-v1/testing/hpke-client.ts";
import { withClientV1HpkeRouteTestAuthority } from "@/lib/server/client-v1/testing/route-authority.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createPairingExchangePostHandler } from "./exchange/route.ts";
import { createPairingRequestGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-poll-");
const secretHeader = "X-Coven-Pairing-Secret";
const INSTANCE_ID = "client-v1-poll-route-test";
const BOUND_NOW = 25_000;
const pairingInput = {
  appName: "OpenCoven Chat",
  installationId: "chat-install-1",
  scopes: ["chat:read" as const],
};

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Carries the listener's direct-loopback stamp, because the poll route now
// re-checks it for itself (cave-f1xki). Every request these tests describe is a
// client on the machine, which is the only shape that stamp is minted for; the
// unstamped shapes get their own test below.
function request(id: string, secret?: string, querySecret?: string): Request {
  const url = new URL(`http://127.0.0.1:3020/api/client/v1/pairing/requests/${id}`);
  if (querySecret) url.searchParams.set("secret", querySecret);
  return new Request(url, {
    headers: {
      [LOCAL_PEER_HEADER]: "loopback-secret",
      ...(secret ? { [secretHeader]: secret } : {}),
    },
  });
}

function exchangeRequest(id: string, secret: string): Request {
  return new Request(
    `http://127.0.0.1:3020/api/client/v1/pairing/requests/${id}/exchange`,
    {
      method: "POST",
      headers: { [LOCAL_PEER_HEADER]: "loopback-secret", [secretHeader]: secret },
    },
  );
}

// A well-formed guess, not a malformed one: a secret failing the contract
// shape is refused before the store ever compares it, so only this kind of
// attempt reaches the comparison the budget exists to bound.
function nearMiss(secret: string): string {
  return `${secret.slice(0, -1)}${secret.endsWith("A") ? "B" : "A"}`;
}

test("poll exposes only id, status, and expiry across the complete lifecycle", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 1_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const handler = createPairingRequestGetHandler(runtime);

    for (const decision of [null, "approved", "denied"] as const) {
      const issued = runtime.pairingStore.create({
        ...pairingInput,
        installationId: `chat-install-${decision ?? "pending"}`,
      });
      if (decision) {
        now += 1;
        assert.equal(runtime.pairingStore.decide(issued.id, decision, now), true);
      }
      const response = await handler(request(issued.id, issued.secret), context(issued.id));
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json() as { data: unknown }).data, {
        id: issued.id,
        status: decision ?? "pending",
        expiresAt: issued.expiresAt,
      });
    }

    const expiring = runtime.pairingStore.create(pairingInput);
    now = expiring.createdAt + PAIRING_TTL_MS;
    const expired = await handler(
      request(expiring.id, expiring.secret),
      context(expiring.id),
    );
    assert.equal(expired.status, 200);
    assert.deepEqual((await expired.json() as { data: unknown }).data, {
      id: expiring.id,
      status: "expired",
      expiresAt: expiring.expiresAt,
    });
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("poll refuses a caller without the listener's direct-loopback stamp", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => 1_000,
    });
    const handler = createPairingRequestGetHandler(runtime);
    const issued = runtime.pairingStore.create(pairingInput);

    // The correct secret, so nothing but the missing/forged stamp can account
    // for the refusal. This is the defence in depth cave-f1xki (#4854) is
    // about: the proxy's ingress classification was slipped with a percent
    // escape, and this route — alone among the public routes with a dynamic
    // segment — had no locality check of its own to fall back on.
    for (const stamp of [undefined, "", "wrong-loopback-secret"]) {
      const headers = new Headers({ [secretHeader]: issued.secret });
      if (stamp !== undefined) headers.set(LOCAL_PEER_HEADER, stamp);
      const response = await handler(
        new Request(
          `http://127.0.0.1:3020/api/client/v1/pairing/requests/${issued.id}`,
          { headers },
        ),
        context(issued.id),
      );
      const body = await response.json() as { error: { code: string }; data?: unknown };
      assert.equal(response.status, 401, `stamp ${JSON.stringify(stamp)}`);
      assert.equal(body.error.code, "unauthorized");
      assert.equal(body.data, undefined);
      assert.equal(JSON.stringify(body).includes(issued.secret), false);
      assert.equal(JSON.stringify(body).includes("loopback-secret"), false);
    }

    // And the refusal is not a lockout of the legitimate holder: the stamped
    // request with the same secret still answers.
    const stamped = await handler(request(issued.id, issued.secret), context(issued.id));
    assert.equal(stamped.status, 200);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("poll accepts pairing secrets only from the reviewed header", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => 1_000,
    });
    const handler = createPairingRequestGetHandler(runtime);
    const issued = runtime.pairingStore.create(pairingInput);

    for (const candidate of [
      request(issued.id),
      request(issued.id, "wrong-secret"),
      request(issued.id, undefined, issued.secret),
    ]) {
      const response = await handler(candidate, context(issued.id));
      const body = await response.json() as { error: { code: string } };
      assert.equal(response.status, 401);
      assert.equal(body.error.code, "unauthorized");
      assert.equal(JSON.stringify(body).includes(issued.secret), false);
    }
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("poll meters wrong pairing secrets against the exchange's own budget", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const now = 17_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const poll = createPairingRequestGetHandler(runtime);
    const exchange = createPairingExchangePostHandler(runtime);
    const attacked = runtime.pairingStore.create(pairingInput);
    const bystander = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-bystander",
    });
    assert.equal(runtime.pairingStore.decide(attacked.id, "approved", now), true);
    assert.equal(runtime.pairingStore.decide(bystander.id, "approved", now), true);

    // 401 versus 200 is a complete oracle for the secret, so this route has to
    // be bounded exactly as tightly as the exchange it feeds.
    const guess = nearMiss(attacked.secret);
    assert.notEqual(guess, attacked.secret);
    for (
      let attempt = 0;
      attempt < CLIENT_V1_PAIRING_COMPARISON_FAILURE_LIMIT;
      attempt += 1
    ) {
      const rejected = await poll(request(attacked.id, guess), context(attacked.id));
      assert.equal(rejected.status, 401, `guess ${attempt} must be refused, not limited`);
    }

    const limited = await poll(request(attacked.id, guess), context(attacked.id));
    assert.equal(limited.status, 429);
    assert.equal(
      ((await limited.json()) as { error: { code: string } }).error.code,
      "rate_limited",
    );

    // The whole point of sharing one bucket: guessing through the poll route
    // must not leave a full exchange budget in reserve for the moment the
    // oracle gives up the secret.
    const exchanged = await exchange(
      exchangeRequest(attacked.id, attacked.secret),
      context(attacked.id),
    );
    assert.equal(exchanged.status, 429);

    // And the lockout is confined to the pairing under attack.
    const untouched = await poll(
      request(bystander.id, bystander.secret),
      context(bystander.id),
    );
    assert.equal(untouched.status, 200);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("poll refuses once exchange failures alone have spent the shared budget", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const now = 19_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const poll = createPairingRequestGetHandler(runtime);
    const exchange = createPairingExchangePostHandler(runtime);
    const attacked = runtime.pairingStore.create(pairingInput);
    assert.equal(runtime.pairingStore.decide(attacked.id, "approved", now), true);

    const guess = nearMiss(attacked.secret);
    for (
      let attempt = 0;
      attempt < CLIENT_V1_PAIRING_COMPARISON_FAILURE_LIMIT;
      attempt += 1
    ) {
      const rejected = await exchange(
        exchangeRequest(attacked.id, guess),
        context(attacked.id),
      );
      assert.equal(rejected.status, 401, `guess ${attempt} must be refused, not limited`);
    }

    // The budget gates the comparison itself, so while it is spent the poll
    // refuses the correct secret too — a deliberate per-pairing lockout for the
    // rest of the 60 s window, matching what the exchange already does, rather
    // than a quieter 401 that would keep answering the attacker's question.
    const holder = await poll(
      request(attacked.id, attacked.secret),
      context(attacked.id),
    );
    assert.equal(holder.status, 429);
    const body = await holder.json() as { error: { code: string } };
    assert.equal(body.error.code, "rate_limited");
    assert.equal(holder.headers.get("retry-after"), "60");
    assert.equal(JSON.stringify(body).includes(attacked.secret), false);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("poll checks the loopback stamp before it reads the rate-limit budget", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const now = 19_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const poll = createPairingRequestGetHandler(runtime);
    const exchange = createPairingExchangePostHandler(runtime);
    const attacked = runtime.pairingStore.create(pairingInput);
    assert.equal(runtime.pairingStore.decide(attacked.id, "approved", now), true);

    const guess = nearMiss(attacked.secret);
    for (
      let attempt = 0;
      attempt < CLIENT_V1_PAIRING_COMPARISON_FAILURE_LIMIT;
      attempt += 1
    ) {
      const rejected = await exchange(
        exchangeRequest(attacked.id, guess),
        context(attacked.id),
      );
      assert.equal(rejected.status, 401, `guess ${attempt} must be refused, not limited`);
    }

    // The ORDER of the two checks is the assertion, not either check alone: the
    // test above shows a stamped holder gets 429 in this exact state, so an
    // unstamped caller getting 401 can only mean the stamp was read first. Move
    // the stamp check below the budget peek and this flips to 429 — which would
    // hand a caller who never proved locality a live read on whether some
    // pairing id is currently under attack, and is the shape docs/api/client-v1.md
    // states ("checked before the rate-limit budget is read").
    const unstamped = await poll(
      new Request(
        `http://127.0.0.1:3020/api/client/v1/pairing/requests/${attacked.id}`,
        { headers: { [secretHeader]: attacked.secret } },
      ),
      context(attacked.id),
    );
    assert.equal(unstamped.status, 401);
    const body = await unstamped.json() as { error: { code: string } };
    assert.equal(body.error.code, "unauthorized");
    assert.equal(unstamped.headers.get("retry-after"), null);
    assert.equal(JSON.stringify(body).includes(attacked.secret), false);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("polling with the correct secret is never rate limited", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const now = 21_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const poll = createPairingRequestGetHandler(runtime);
    const issued = runtime.pairingStore.create(pairingInput);

    // A client polls this route until an administrator decides. 150 polls is a
    // 2 s interval across the full 5-minute pairing TTL, well past the failure
    // limit: presenting the correct secret must cost the holder nothing, or the
    // fix would lock out the one caller it exists to protect.
    const polls = 150;
    assert.ok(polls > CLIENT_V1_PAIRING_COMPARISON_FAILURE_LIMIT);
    for (let attempt = 0; attempt < polls; attempt += 1) {
      const pending = await poll(request(issued.id, issued.secret), context(issued.id));
      assert.equal(pending.status, 200, `poll ${attempt} must answer, not rate limit`);
      assert.equal(
        ((await pending.json()) as { data: { status: string } }).data.status,
        "pending",
      );
    }

    // Not merely unthrottled — never charged, so the budget is still whole for
    // an attacker who shows up after the holder has been polling for minutes.
    assert.equal(
      runtime.rateLimiter.peekPairingComparisonFailure(issued.id).remaining,
      CLIENT_V1_PAIRING_COMPARISON_FAILURE_LIMIT,
    );

    // A `not_found` is not charged either: no record carries that id, so there
    // is no secret to guess and charging would mint a bucket per guessed id —
    // exactly the map churn `peek` refuses to cause.
    const unknownId = `${issued.id.slice(0, -1)}${issued.id.endsWith("a") ? "b" : "a"}`;
    assert.notEqual(unknownId, issued.id);
    const notFound = await poll(request(unknownId, issued.secret), context(unknownId));
    assert.equal(notFound.status, 404);
    assert.equal(
      runtime.rateLimiter.peekPairingComparisonFailure(unknownId).remaining,
      CLIENT_V1_PAIRING_COMPARISON_FAILURE_LIMIT,
    );

    // The already-exchanged branch presents a CORRECT secret too, so it has to
    // be as free as the 200 above. A client that polls once more after its
    // exchange succeeds — a retry loop that raced its own success, or one
    // confirming the outcome — still holds the right secret, and charging it
    // here would spend the shared budget on the legitimate holder and lock the
    // pairing's own exchange out for the rest of the window. Asserted directly
    // because every other guard in this file exercises `found` or `not_found`:
    // without this, charging the 409 path breaks no test.
    const exchange = createPairingExchangePostHandler(runtime);
    const spent = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-spent",
    });
    assert.equal(runtime.pairingStore.decide(spent.id, "approved", now), true);
    const exchanged = await exchange(
      exchangeRequest(spent.id, spent.secret),
      context(spent.id),
    );
    assert.equal(exchanged.status, 200);

    const replayed = await poll(request(spent.id, spent.secret), context(spent.id));
    assert.equal(replayed.status, 409);
    assert.equal(
      ((await replayed.json()) as { error: { code: string } }).error.code,
      "conflict",
    );
    assert.equal(
      runtime.rateLimiter.peekPairingComparisonFailure(spent.id).remaining,
      CLIENT_V1_PAIRING_COMPARISON_FAILURE_LIMIT,
    );
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("bound poll encrypts pending and approved status and rejects downgrade or replay before the pairing budget", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    await withClientV1HpkeRouteTestAuthority(
      { instanceId: INSTANCE_ID, now: BOUND_NOW, seed: 31 },
      async (authority) => {
        const runtime = createClientV1Runtime({
          authority: authority.runtime,
          credentialRoot: root,
          loopbackSecret: "loopback-secret",
          now: () => BOUND_NOW,
        });
        const pairing = runtime.pairingStore.create(pairingInput);
        const originalLookup = runtime.pairingStore.lookup.bind(runtime.pairingStore);
        const originalPeek =
          runtime.rateLimiter.peekPairingComparisonFailure.bind(runtime.rateLimiter);
        const originalConsume =
          runtime.rateLimiter.consumePairingComparisonFailure.bind(runtime.rateLimiter);
        let lookupCalls = 0;
        let peekCalls = 0;
        let consumeCalls = 0;
        runtime.pairingStore.lookup = (id, secret) => {
          lookupCalls += 1;
          return originalLookup(id, secret);
        };
        runtime.rateLimiter.peekPairingComparisonFailure = (id) => {
          peekCalls += 1;
          return originalPeek(id);
        };
        runtime.rateLimiter.consumePairingComparisonFailure = (id) => {
          consumeCalls += 1;
          return originalConsume(id);
        };
        const handler = createPairingRequestGetHandler(runtime);

        const downgrade = await handler(
          request(pairing.id, pairing.secret),
          context(pairing.id),
        );
        assert.equal(downgrade.status, 426);
        assert.equal(lookupCalls, 0);
        assert.equal(peekCalls, 0);
        assert.equal(consumeCalls, 0);

        const pending = await createClientV1HpkeTestClient({
          authority: authority.authority,
          instanceId: INSTANCE_ID,
          runtimeNonce: authority.runtimeNonce,
          operation: "pairing.poll",
          url: `http://127.0.0.1:3020/api/client/v1/pairing/requests/${pairing.id}`,
          method: "GET",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(1),
          authorization: { kind: "pairing-secret", value: pairing.secret },
        });
        const pendingHeaders = new Headers(pending.request.headers);
        pendingHeaders.set(LOCAL_PEER_HEADER, "loopback-secret");
        const pendingRequest = new Request(pending.request, {
          headers: pendingHeaders,
        });
        const pendingResponse = await handler(
          pendingRequest.clone(),
          context(pairing.id),
        );
        assert.equal(pendingResponse.status, 200);
        assert.equal(
          pendingResponse.headers.get("content-type"),
          CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
        );
        const pendingInner = await pending.open(pendingResponse);
        assert.equal(pendingInner.status, 200);
        assert.equal(
          (JSON.parse(new TextDecoder().decode(pendingInner.body)) as {
            data: { status: string };
          }).data.status,
          "pending",
        );
        assert.equal(lookupCalls, 1);
        assert.equal(peekCalls, 1);
        assert.equal(consumeCalls, 0);

        const replayResponse = await handler(
          pendingRequest.clone(),
          context(pairing.id),
        );
        const replayInner = await pending.open(replayResponse);
        assert.equal(replayInner.status, 409);
        assert.equal(
          (JSON.parse(new TextDecoder().decode(replayInner.body)) as {
            error: { details: { reason: string } };
          }).error.details.reason,
          "authority_replayed",
        );
        assert.equal(lookupCalls, 1);
        assert.equal(peekCalls, 1);
        assert.equal(consumeCalls, 0);
        assert.equal(
          runtime.rateLimiter.peekPairingComparisonFailure(pairing.id).remaining,
          CLIENT_V1_PAIRING_COMPARISON_FAILURE_LIMIT,
        );

        assert.equal(
          runtime.pairingStore.decide(pairing.id, "approved", BOUND_NOW),
          true,
        );
        const approved = await createClientV1HpkeTestClient({
          authority: authority.authority,
          instanceId: INSTANCE_ID,
          runtimeNonce: authority.runtimeNonce,
          operation: "pairing.poll",
          url: `http://127.0.0.1:3020/api/client/v1/pairing/requests/${pairing.id}`,
          method: "GET",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(2),
          authorization: { kind: "pairing-secret", value: pairing.secret },
        });
        const approvedHeaders = new Headers(approved.request.headers);
        approvedHeaders.set(LOCAL_PEER_HEADER, "loopback-secret");
        const approvedResponse = await handler(
          new Request(approved.request, { headers: approvedHeaders }),
          context(pairing.id),
        );
        const approvedInner = await approved.open(approvedResponse);
        assert.equal(approvedInner.status, 200);
        assert.equal(
          (JSON.parse(new TextDecoder().decode(approvedInner.body)) as {
            data: { status: string };
          }).data.status,
          "approved",
        );

        const wrongKey = await createClientV1HpkeTestClient({
          authority: authority.authority,
          instanceId: INSTANCE_ID,
          runtimeNonce: authority.runtimeNonce,
          operation: "pairing.poll",
          url: `http://127.0.0.1:3020/api/client/v1/pairing/requests/${pairing.id}`,
          method: "GET",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(3),
          authorization: { kind: "pairing-secret", value: pairing.secret },
        });
        const wrongKeyHeaders = new Headers(wrongKey.request.headers);
        wrongKeyHeaders.set(LOCAL_PEER_HEADER, "loopback-secret");
        wrongKeyHeaders.set(
          CLIENT_V1_HPKE_HEADERS.keyId,
          base64UrlEncode(new Uint8Array(32).fill(0xee)),
        );
        const beforeWrongKey = {
          lookupCalls,
          peekCalls,
          consumeCalls,
        };
        const wrongKeyResponse = await handler(
          new Request(wrongKey.request, { headers: wrongKeyHeaders }),
          context(pairing.id),
        );
        assert.equal(wrongKeyResponse.status, 409);
        assert.deepEqual(
          { lookupCalls, peekCalls, consumeCalls },
          beforeWrongKey,
        );
      },
    );
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});
