import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
} from "@/lib/server/client-v1/authority-contract.ts";
import {
  CLIENT_V1_CREDENTIAL_STORE_FILE,
  type CredentialStore,
} from "@/lib/server/client-v1/credential-store.ts";
import {
  CLIENT_V1_PAIRING_CREATE_LIMIT,
  CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT,
} from "@/lib/server/client-v1/rate-limit.ts";
import { createClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import {
  createClientV1HpkeTestClient,
  type ClientV1HpkeTestClient,
} from "@/lib/server/client-v1/testing/hpke-client.ts";
import { withClientV1HpkeRouteTestAuthority } from "@/lib/server/client-v1/testing/route-authority.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createPairingExchangePostHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-exchange-");
const secretHeader = "X-Coven-Pairing-Secret";
const INSTANCE_ID = "client-v1-exchange-route-test";
const BOUND_NOW = 30_000;
const pairingInput = {
  appName: "OpenCoven Chat",
  installationId: "chat-install-1",
  scopes: ["chat:read" as const, "chat:write" as const],
};

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(id: string, secret: string): Request {
  return new Request(
    `http://127.0.0.1:3020/api/client/v1/pairing/requests/${id}/exchange`,
    {
      method: "POST",
      headers: {
        [LOCAL_PEER_HEADER]: "loopback-secret",
        [secretHeader]: secret,
      },
    },
  );
}

async function openBoundJson(
  prepared: ClientV1HpkeTestClient,
  response: Response,
): Promise<{ status: number; body: Record<string, unknown> }> {
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
  );
  const inner = await prepared.open(response);
  return {
    status: inner.status,
    body: JSON.parse(new TextDecoder().decode(inner.body)) as
      Record<string, unknown>,
  };
}

/**
 * An exchange whose loopback stamp and secret placement are chosen per call.
 *
 * `request` above always supplies both, because every test written before this
 * one describes a client on the machine holding the right secret. That made
 * every one of this file's references to the loopback stamp happy-path setup:
 * none of them could observe the stamp check being removed.
 */
function probe(
  id: string,
  options: {
    /**
     * Omit the key for the valid stamp; pass it as `undefined` to send no
     * stamp header at all.
     *
     * Read with `"stamp" in options` rather than a destructuring default: a
     * default fires on an explicitly passed `undefined` too, which would have
     * quietly restored the valid stamp on the very row meant to send none. The
     * first draft of this helper did exactly that and reported 200.
     */
    stamp?: string | undefined;
    headerSecret?: string;
    querySecret?: string;
  },
): Request {
  const stamp = "stamp" in options ? options.stamp : "loopback-secret";
  const url = new URL(
    `http://127.0.0.1:3020/api/client/v1/pairing/requests/${id}/exchange`,
  );
  if (options.querySecret) url.searchParams.set("secret", options.querySecret);
  const headers = new Headers();
  if (stamp !== undefined) headers.set(LOCAL_PEER_HEADER, stamp);
  if (options.headerSecret) headers.set(secretHeader, options.headerSecret);
  return new Request(url, { method: "POST", headers });
}

/**
 * The exchange refuses any caller the listener did not stamp as direct
 * loopback — the same defence its sibling poll route grew in cave-f1xki
 * (#4854), which this route never got.
 *
 * It matters more here than there: the poll route discloses a status, while
 * THIS route mints the bearer. Removing the whole `isTrustedLoopback` branch
 * left every existing test in this file, the poll route's suite,
 * `authenticated-route-refusal.test.ts`, `api-contracts.test.ts`,
 * `admin/security.e2e.test.ts` and `middleware.test.ts` green.
 *
 * The correct secret is supplied throughout, so nothing but the missing or
 * forged stamp can account for the refusal.
 */
test("exchange refuses a caller without the listener's direct-loopback stamp", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 1_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const handler = createPairingExchangePostHandler(runtime);
    const issued = runtime.pairingStore.create(pairingInput);
    now = 1_100;
    assert.equal(runtime.pairingStore.decide(issued.id, "approved", now), true);

    for (const stamp of [undefined, "", "wrong-loopback-secret"]) {
      const response = await handler(
        probe(issued.id, { stamp, headerSecret: issued.secret }),
        context(issued.id),
      );
      const body = await response.json() as {
        error: { code: string };
        data?: unknown;
      };
      assert.equal(response.status, 401, `stamp ${JSON.stringify(stamp)}`);
      assert.equal(body.error.code, "unauthorized");
      assert.equal(body.data, undefined);
      assert.equal(JSON.stringify(body).includes(issued.secret), false);
      assert.equal(JSON.stringify(body).includes("loopback-secret"), false);
    }

    // No credential was minted by any of the three refusals, and the pairing
    // was not spent: the legitimate stamped holder still exchanges exactly
    // once. A refusal that consumed the approval would be a denial of service
    // reachable by an unstamped caller.
    assert.equal((await runtime.credentialStore.reload()).size, 0);
    const stamped = await handler(
      request(issued.id, issued.secret),
      context(issued.id),
    );
    assert.equal(stamped.status, 200);
    assert.equal((await runtime.credentialStore.reload()).size, 1);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * The pairing secret is read from `X-Coven-Pairing-Secret` and from nowhere
 * else — the plan of record's "pairing secrets travel only in
 * X-Coven-Pairing-Secret", and the poll route's own
 * "accepts pairing secrets only from the reviewed header".
 *
 * A URL-borne secret survives in shell history, referer headers, proxy logs
 * and crash reports, so accepting one as a fallback is a disclosure even when
 * the exchange itself succeeds. Adding that fallback to this route left every
 * suite listed above green.
 */
test("exchange accepts pairing secrets only from the reviewed header", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 1_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const handler = createPairingExchangePostHandler(runtime);
    const issued = runtime.pairingStore.create(pairingInput);
    now = 1_100;
    assert.equal(runtime.pairingStore.decide(issued.id, "approved", now), true);

    for (const candidate of [
      probe(issued.id, {}),
      probe(issued.id, { headerSecret: "wrong-secret" }),
      probe(issued.id, { querySecret: issued.secret }),
    ]) {
      const response = await handler(candidate, context(issued.id));
      const body = await response.json() as {
        error: { code: string };
        data?: unknown;
      };
      assert.equal(response.status, 401);
      assert.equal(body.error.code, "unauthorized");
      assert.equal(body.data, undefined);
      assert.equal(JSON.stringify(body).includes(issued.secret), false);
    }

    // The approval is intact and still redeemable through the header, so the
    // three refusals above rejected the request rather than the pairing.
    assert.equal((await runtime.credentialStore.reload()).size, 0);
    const accepted = await handler(
      request(issued.id, issued.secret),
      context(issued.id),
    );
    assert.equal(accepted.status, 200);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("exchanges an approved request once and persists only the bearer hash", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 1_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const handler = createPairingExchangePostHandler(runtime);
    const issued = runtime.pairingStore.create(pairingInput);
    now = 1_100;
    assert.equal(runtime.pairingStore.decide(issued.id, "approved", now), true);

    const response = await handler(request(issued.id, issued.secret), context(issued.id));
    const payload = await response.json() as {
      data: {
        bearer: string;
        credential: {
          id: string;
          appName: string;
          installationId: string;
          scopes: string[];
          createdAt: number;
          lastUsedAt: number | null;
          revokedAt: number | null;
          revocationReason: string | null;
        };
      };
    };
    assert.equal(response.status, 200);
    assert.match(payload.data.bearer, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(payload.data.credential, {
      id: payload.data.credential.id,
      appName: pairingInput.appName,
      installationId: pairingInput.installationId,
      scopes: pairingInput.scopes,
      createdAt: 1_100,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
    });
    const persisted = await readFile(
      resolve(root, CLIENT_V1_CREDENTIAL_STORE_FILE),
      "utf8",
    );
    assert.equal(persisted.includes(payload.data.bearer), false);

    const replay = await handler(request(issued.id, issued.secret), context(issued.id));
    const replayPayload = await replay.json() as {
      error: { code: string; details?: { reason?: string } };
    };
    assert.equal(replay.status, 409);
    assert.equal(replayPayload.error.code, "conflict");
    assert.equal(replayPayload.error.details?.reason, "pairing_replayed");
    assert.equal(JSON.stringify(replayPayload).includes(issued.secret), false);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("exchange explicitly reports pending, denied, expired, and bad-secret failures", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 5_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const handler = createPairingExchangePostHandler(runtime);

    const pending = runtime.pairingStore.create(pairingInput);
    const pendingResponse = await handler(
      request(pending.id, pending.secret),
      context(pending.id),
    );
    assert.equal(pendingResponse.status, 409);
    assert.equal(
      ((await pendingResponse.json()) as { error: { code: string } }).error.code,
      "pairing_pending",
    );

    const denied = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-denied",
    });
    assert.equal(runtime.pairingStore.decide(denied.id, "denied", now + 1), true);
    const deniedResponse = await handler(
      request(denied.id, denied.secret),
      context(denied.id),
    );
    assert.equal(deniedResponse.status, 403);
    assert.equal(
      ((await deniedResponse.json()) as { error: { code: string } }).error.code,
      "pairing_denied",
    );

    const expiring = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-expired",
    });
    now = expiring.expiresAt;
    const expiredResponse = await handler(
      request(expiring.id, expiring.secret),
      context(expiring.id),
    );
    assert.equal(expiredResponse.status, 410);
    assert.equal(
      ((await expiredResponse.json()) as { error: { code: string } }).error.code,
      "pairing_expired",
    );

    const approved = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-approved",
    });
    now += 1;
    assert.equal(runtime.pairingStore.decide(approved.id, "approved", now), true);
    const badSecret = await handler(
      request(approved.id, "wrong-secret"),
      context(approved.id),
    );
    assert.equal(badSecret.status, 401);
    assert.equal(
      ((await badSecret.json()) as { error: { code: string } }).error.code,
      "unauthorized",
    );

    // Creation and exchange must not share one bucket. The create bucket is
    // keyed on the loopback stamp, which is a single process-wide constant, so
    // a shared bucket would let ten pairing creations anywhere on the machine
    // lock out a client trying to redeem its own approved pairing.
    const spentCreateRuntime = createClientV1Runtime({
      credentialRoot: resolve(root, "spent-create"),
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const spentCreateHandler = createPairingExchangePostHandler(spentCreateRuntime);
    const redeemable = spentCreateRuntime.pairingStore.create(pairingInput);
    assert.equal(
      spentCreateRuntime.pairingStore.decide(redeemable.id, "approved", now),
      true,
    );
    for (let attempt = 0; attempt < CLIENT_V1_PAIRING_CREATE_LIMIT; attempt += 1) {
      assert.equal(
        spentCreateRuntime.rateLimiter.consumePairingCreate("loopback-secret").allowed,
        true,
      );
    }
    assert.equal(
      spentCreateRuntime.rateLimiter.consumePairingCreate("loopback-secret").allowed,
      false,
      "the create bucket really is exhausted",
    );
    const redeemed = await spentCreateHandler(
      request(redeemable.id, redeemable.secret),
      context(redeemable.id),
    );
    assert.equal(redeemed.status, 200);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("polling a pending-then-approved pairing with the correct secret is never rate limited", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const now = 9_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const handler = createPairingExchangePostHandler(runtime);
    const issued = runtime.pairingStore.create(pairingInput);

    // `pairing_pending` is returned retryable, so a client polls until an
    // administrator decides. 150 polls is a 2 s interval across the full
    // 5-minute pairing TTL, and it is well past both the create limit and the
    // exchange failure limit: presenting the correct secret must cost the
    // holder nothing at all.
    const polls = 150;
    assert.ok(polls > CLIENT_V1_PAIRING_CREATE_LIMIT);
    assert.ok(polls > CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT);
    for (let poll = 0; poll < polls; poll += 1) {
      const pending = await handler(request(issued.id, issued.secret), context(issued.id));
      assert.equal(pending.status, 409, `poll ${poll} must stay pending, not rate limited`);
      assert.equal(
        ((await pending.json()) as { error: { code: string } }).error.code,
        "pairing_pending",
      );
    }

    assert.equal(runtime.pairingStore.decide(issued.id, "approved", now), true);
    const exchanged = await handler(request(issued.id, issued.secret), context(issued.id));
    assert.equal(exchanged.status, 200);
    const payload = await exchanged.json() as { data: { bearer: string } };
    assert.match(payload.data.bearer, /^[A-Za-z0-9_-]{43}$/);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("wrong pairing secrets are bounded per pairing request and leave other pairings alone", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const now = 11_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const handler = createPairingExchangePostHandler(runtime);
    const attacked = runtime.pairingStore.create(pairingInput);
    const bystander = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-bystander",
    });
    assert.equal(runtime.pairingStore.decide(attacked.id, "approved", now), true);
    assert.equal(runtime.pairingStore.decide(bystander.id, "approved", now), true);

    // A well-formed guess, not a malformed one: a secret that fails the
    // contract shape is refused before the store ever compares it, so only
    // this kind of attempt is brute force worth bounding.
    const guess = `${attacked.secret.slice(0, -1)}${attacked.secret.endsWith("A") ? "B" : "A"}`;
    assert.notEqual(guess, attacked.secret);

    for (
      let attempt = 0;
      attempt < CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT;
      attempt += 1
    ) {
      const rejected = await handler(
        request(attacked.id, guess),
        context(attacked.id),
      );
      assert.equal(rejected.status, 401, `guess ${attempt} must be refused, not limited`);
    }

    const limited = await handler(
      request(attacked.id, guess),
      context(attacked.id),
    );
    assert.equal(limited.status, 429);
    assert.equal(
      ((await limited.json()) as { error: { code: string } }).error.code,
      "rate_limited",
    );

    // The budget has to gate the secret comparison itself, so while it is
    // spent the correct secret is refused too — a deliberate per-pairing
    // lockout for the rest of the 60 s window, not a consequence of the
    // holder's own polling, which never charges the bucket.
    const holder = await handler(
      request(attacked.id, attacked.secret),
      context(attacked.id),
    );
    assert.equal(holder.status, 429);

    // And the lockout is confined to the pairing under attack.
    const untouched = await handler(
      request(bystander.id, bystander.secret),
      context(bystander.id),
    );
    assert.equal(untouched.status, 200);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed credential issue answers in the client-v1 envelope and leaves the pairing redeemable", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const now = 13_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const persistent = runtime.credentialStore;
    const issueFailure = Object.assign(
      new Error("deterministic injected issue failure"),
      { code: "ENOSPC" },
    );
    let issueAttempts = 0;
    const failingOnce: CredentialStore = {
      issue: async (input) => {
        issueAttempts += 1;
        if (issueAttempts === 1) throw issueFailure;
        return persistent.issue(input);
      },
      verify: (id, bearer) => persistent.verify(id, bearer),
      findByBearer: (bearer) => persistent.findByBearer(bearer),
      revoke: (id, reason) => persistent.revoke(id, reason),
      reload: () => persistent.reload(),
      readPersistedFile: () => persistent.readPersistedFile(),
    };
    runtime.credentialStore = failingOnce;

    const handler = createPairingExchangePostHandler(runtime);
    const issued = runtime.pairingStore.create(pairingInput);
    assert.equal(runtime.pairingStore.decide(issued.id, "approved", now), true);

    const failed = await handler(request(issued.id, issued.secret), context(issued.id));
    assert.equal(failed.status, 500);
    const failedPayload = await failed.json() as {
      error: { code: string; message: string; retryable: boolean };
      data?: unknown;
    };
    assert.equal(failedPayload.error.code, "internal_error");
    assert.equal(failedPayload.error.retryable, true);
    assert.equal(failedPayload.data, undefined);
    // The envelope, not a raw Next 500 — every other route on this surface
    // answers this way and a client parses exactly one shape.
    assert.equal(
      (failedPayload as unknown as { apiVersion?: string }).apiVersion !== undefined,
      true,
    );
    const serialized = JSON.stringify(failedPayload);
    assert.equal(serialized.includes(issued.secret), false);
    assert.equal(serialized.includes("ENOSPC"), false);

    // A spent pairing would need a fresh request and a second administrator
    // approval to recover, so the failure has to leave it exchangeable.
    const retried = await handler(request(issued.id, issued.secret), context(issued.id));
    assert.equal(retried.status, 200);
    const retriedPayload = await retried.json() as { data: { bearer: string } };
    assert.match(retriedPayload.data.bearer, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(issueAttempts, 2);
    assert.equal((await persistent.reload()).size, 1);

    // Still exactly one exchange: the restore does not make the pairing
    // redeemable twice.
    const replay = await handler(request(issued.id, issued.secret), context(issued.id));
    assert.equal(replay.status, 409);
    assert.equal(
      ((await replay.json()) as { error: { details?: { reason?: string } } })
        .error.details?.reason,
      "pairing_replayed",
    );
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("two identical concurrent bound exchanges issue one credential and encrypt one replay refusal", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    await withClientV1HpkeRouteTestAuthority(
      { instanceId: INSTANCE_ID, now: BOUND_NOW, seed: 41 },
      async (authority) => {
        const runtime = createClientV1Runtime({
          authority: authority.runtime,
          credentialRoot: root,
          loopbackSecret: "loopback-secret",
          now: () => BOUND_NOW,
        });
        const pairing = runtime.pairingStore.create(pairingInput);
        assert.equal(
          runtime.pairingStore.decide(pairing.id, "approved", BOUND_NOW),
          true,
        );
        const originalConsume =
          runtime.pairingStore.consumeForExchange.bind(runtime.pairingStore);
        const originalIssue =
          runtime.credentialStore.issue.bind(runtime.credentialStore);
        let consumeCalls = 0;
        let issueCalls = 0;
        runtime.pairingStore.consumeForExchange = (id, secret) => {
          consumeCalls += 1;
          return originalConsume(id, secret);
        };
        runtime.credentialStore.issue = async (input) => {
          issueCalls += 1;
          return originalIssue(input);
        };
        const handler = createPairingExchangePostHandler(runtime);

        const downgrade = await handler(
          request(pairing.id, pairing.secret),
          context(pairing.id),
        );
        assert.equal(downgrade.status, 426);
        assert.equal(consumeCalls, 0);
        assert.equal(issueCalls, 0);
        assert.equal((await runtime.credentialStore.reload()).size, 0);

        const replacement = await withClientV1HpkeRouteTestAuthority(
          { instanceId: INSTANCE_ID, now: BOUND_NOW, seed: 42 },
          async (otherAuthority) =>
            createClientV1HpkeTestClient({
              authority: otherAuthority.authority,
              instanceId: INSTANCE_ID,
              runtimeNonce: otherAuthority.runtimeNonce,
              operation: "pairing.exchange",
              url: `http://127.0.0.1:3020/api/client/v1/pairing/requests/${pairing.id}/exchange`,
              method: "POST",
              issuedAt: BOUND_NOW,
              requestNonce: new Uint8Array(32).fill(4),
              authorization: {
                kind: "pairing-secret",
                value: pairing.secret,
              },
            }),
        );
        const replacementHeaders = new Headers(replacement.request.headers);
        replacementHeaders.set(LOCAL_PEER_HEADER, "loopback-secret");
        const replacementResponse = await handler(
          new Request(replacement.request, { headers: replacementHeaders }),
          context(pairing.id),
        );
        assert.equal(replacementResponse.status, 409);
        assert.equal(consumeCalls, 0);
        assert.equal(issueCalls, 0);

        const bodyBound = await createClientV1HpkeTestClient({
          authority: authority.authority,
          instanceId: INSTANCE_ID,
          runtimeNonce: authority.runtimeNonce,
          operation: "pairing.exchange",
          url: `http://127.0.0.1:3020/api/client/v1/pairing/requests/${pairing.id}/exchange`,
          method: "POST",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(5),
          authorization: { kind: "pairing-secret", value: pairing.secret },
        });
        const bodyHeaders = new Headers(bodyBound.request.headers);
        bodyHeaders.set(LOCAL_PEER_HEADER, "loopback-secret");
        const bodyResponse = await handler(
          new Request(bodyBound.request.url, {
            method: "POST",
            headers: bodyHeaders,
            body: new Uint8Array([1]),
          }),
          context(pairing.id),
        );
        assert.equal(bodyResponse.status, 400);
        assert.equal(consumeCalls, 0);
        assert.equal(issueCalls, 0);

        const prepared = await createClientV1HpkeTestClient({
          authority: authority.authority,
          instanceId: INSTANCE_ID,
          runtimeNonce: authority.runtimeNonce,
          operation: "pairing.exchange",
          url: `http://127.0.0.1:3020/api/client/v1/pairing/requests/${pairing.id}/exchange`,
          method: "POST",
          issuedAt: BOUND_NOW,
          requestNonce: new Uint8Array(32).fill(6),
          authorization: { kind: "pairing-secret", value: pairing.secret },
        });
        const headers = new Headers(prepared.request.headers);
        headers.set(LOCAL_PEER_HEADER, "loopback-secret");
        const boundRequest = new Request(prepared.request, { headers });
        const [leftResponse, rightResponse] = await Promise.all([
          handler(boundRequest.clone(), context(pairing.id)),
          handler(boundRequest.clone(), context(pairing.id)),
        ]);
        const opened = await Promise.all([
          openBoundJson(prepared, leftResponse),
          openBoundJson(prepared, rightResponse),
        ]);
        assert.deepEqual(
          opened.map(({ status }) => status).sort((left, right) => left - right),
          [200, 409],
        );
        const success = opened.find(({ status }) => status === 200)!;
        const replayed = opened.find(({ status }) => status === 409)!;
        assert.match(
          (success.body as { data: { bearer: string } }).data.bearer,
          /^[A-Za-z0-9_-]{43}$/u,
        );
        assert.deepEqual(
          (replayed.body as {
            error: {
              code: string;
              message: string;
              details: { reason: string };
              retryable: boolean;
            };
          }).error,
          {
            code: "conflict",
            message: "The authority request was already used.",
            details: { reason: "authority_replayed" },
            retryable: true,
          },
        );
        assert.equal(consumeCalls, 1);
        assert.equal(issueCalls, 1);
        assert.equal((await runtime.credentialStore.reload()).size, 1);
      },
    );
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});
