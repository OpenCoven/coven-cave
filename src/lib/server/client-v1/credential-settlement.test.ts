import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  PAIRING_CLAIM_STALE_MS,
  PAIRING_EXCHANGE_RETRY_AFTER_MS,
  claimApprovedPairingWithIdempotency,
  createPairingRequest,
  decidePairingRequest,
  isPairingRequestExpired,
  readPairingRequest,
  resetPairingRequestsForTest,
} from "./pairing-store.ts";
import { defaultPairingExchangeDeps, exchangePairingRequest } from "./pairing-exchange.ts";
import {
  acknowledgePairingCredentialDelivery,
  clientCredentialSettlementJournalPath,
  clientCredentialStorePath,
  issueCredential,
  issueCredentialForPairingSettlement,
  listCredentials,
  PAIRING_CREDENTIAL_RECOVERY_TTL_MS,
  PAIRING_CREDENTIAL_SETTLEMENT_MAX_ENTRIES,
  recordCredentialUse,
  recoverPairingCredentialSettlement,
  revokeCredential,
  settlePairingCredentialSettlement,
  verifyCredential,
} from "./credential-store.ts";
import { setAtomicWriteTestHooksForTest } from "../atomic-write.ts";
import { hashNormalizedRequest } from "./idempotency-store.ts";

const execFileAsync = promisify(execFile);
const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-credential-settlement-"));
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "client-v1-credentials.json");

const installationId = "b13b7c7b-70bf-43fa-9ee2-767807fc580e";

function approvedPairing() {
  return {
    appName: "OpenCoven Chat",
    installationId,
    scopes: ["chat:read" as const],
    status: "approved" as const,
  };
}

function requestHash(pairingId: string): string {
  return hashNormalizedRequest({ method: "POST", pairingId });
}

async function journal(): Promise<{
  version: 2;
  transactions: unknown[];
  replays: unknown[];
}> {
  return JSON.parse(await readFile(clientCredentialSettlementJournalPath(), "utf8"));
}

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetPairingRequestsForTest();
  await Promise.all([
    rm(clientCredentialStorePath(), { force: true }),
    rm(clientCredentialSettlementJournalPath(), { force: true }),
  ]);
});

afterEach(() => {
  resetPairingRequestsForTest();
  setAtomicWriteTestHooksForTest(null);
});

type CrashedExchange = {
  pairingId: string;
  pairingSecret: string;
  idempotencyKey: string;
  requestHash: string;
};

async function crashExchange(point: string): Promise<CrashedExchange> {
  const loaderUrl = pathToFileURL(path.resolve("scripts/test-alias-register.mjs")).href;
  const pairingStoreUrl = pathToFileURL(path.resolve("src/lib/server/client-v1/pairing-store.ts")).href;
  const exchangeUrl = pathToFileURL(path.resolve("src/lib/server/client-v1/pairing-exchange.ts")).href;
  const idempotencyUrl = pathToFileURL(path.resolve("src/lib/server/client-v1/idempotency-store.ts")).href;
  const worker = `
    const { createPairingRequest, decidePairingRequest } = await import(${JSON.stringify(pairingStoreUrl)});
    const { exchangePairingRequest } = await import(${JSON.stringify(exchangeUrl)});
    const { hashNormalizedRequest } = await import(${JSON.stringify(idempotencyUrl)});
    const pairing = JSON.parse(process.env.CAVE_TEST_PAIRING);
    const { request, secret } = createPairingRequest(pairing);
    decidePairingRequest(request.id, "approved");
    const idempotencyKey = process.env.CAVE_TEST_IDEMPOTENCY_KEY;
    const requestHash = hashNormalizedRequest({ method: "POST", pairingId: request.id });
    process.stdout.write(JSON.stringify({ pairingId: request.id, pairingSecret: secret, idempotencyKey, requestHash }) + "\\n");
    await exchangePairingRequest(request.id, secret, idempotencyKey, requestHash, Date.now());
    process.exitCode = 91;
  `;
  try {
    await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import", loaderUrl,
        "--input-type=module",
        "--eval", worker,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH: clientCredentialStorePath(),
          COVEN_CAVE_TEST_CREDENTIAL_SETTLEMENT_CRASH_POINT: point,
          CAVE_TEST_PAIRING: JSON.stringify(approvedPairing()),
          CAVE_TEST_IDEMPOTENCY_KEY: crypto.randomUUID(),
        },
        windowsHide: true,
      },
    );
    throw new Error(`crash point ${point} did not terminate the child`);
  } catch (error) {
    const crashed = error as { signal?: string; stdout?: string | Buffer };
    assert.equal(crashed.signal, "SIGKILL", `${point} must terminate with SIGKILL`);
    const line = String(crashed.stdout ?? "").trim().split("\n")[0];
    return JSON.parse(line) as CrashedExchange;
  }
}

test("a crash before issuance leaves no replacement and keeps the prior credential usable", async () => {
  const previous = await issueCredential(approvedPairing(), Date.now());
  const crashed = await crashExchange("before-credential-issuance");

  const retry = await exchangePairingRequest(
    crashed.pairingId,
    crashed.pairingSecret,
    crashed.idempotencyKey,
    crashed.requestHash,
    Date.now(),
  );
  assert.deepEqual(retry, { kind: "expired" });
  assert.ok(await verifyCredential(previous.token), "the old credential must not be revoked before a recoverable replacement exists");
  assert.equal((await listCredentials()).length, 1);
  await assert.rejects(readFile(clientCredentialSettlementJournalPath(), "utf8"), { code: "ENOENT" });
});

for (const point of [
  "after-credential-write",
  "after-pairing-finalize",
]) {
  test(`a subprocess crash ${point} lets exactly one recovery claimant expose the token`, async () => {
    const previous = await issueCredential(approvedPairing(), Date.now());
    const crashed = await crashExchange(point);
    const rawBeforeRecovery = await readFile(clientCredentialSettlementJournalPath(), "utf8");
    assert.match(rawBeforeRecovery, /"ciphertext"/);
    const beforeRecovery = await journal();
    assert.equal(beforeRecovery.transactions.length, 1);
    assert.equal(beforeRecovery.replays.length, 0);

    const [first, duplicate] = await Promise.all([
      exchangePairingRequest(
        crashed.pairingId,
        crashed.pairingSecret,
        crashed.idempotencyKey,
        crashed.requestHash,
        Date.now(),
      ),
      exchangePairingRequest(
        crashed.pairingId,
        crashed.pairingSecret,
        crashed.idempotencyKey,
        crashed.requestHash,
        Date.now(),
      ),
    ]);
    const successful = [first, duplicate].filter((result) => result.kind === "ok");
    assert.equal(successful.length, 1, "the disclosure fence permits only one token-bearing recovery");
    const recovered = successful[0];
    if (!recovered || recovered.kind !== "ok") return;
    const other = first.kind === "ok" ? duplicate : first;
    assert.ok(
      other.kind === "processing" || other.kind === "already_exchanged",
      "the second claimant either waits or observes terminal metadata",
    );
    assert.ok(await verifyCredential(recovered.token), "the recovered token must be the active credential");
    assert.equal(await verifyCredential(previous.token), null, "the recovered replacement supersedes its predecessor");

    const rawAfterRecovery = await readFile(clientCredentialSettlementJournalPath(), "utf8");
    assert.equal(rawBeforeRecovery.includes(recovered.token), false, "the pending journal must encrypt the bearer token");
    assert.equal(rawAfterRecovery.includes(recovered.token), false, "the terminal receipt must never persist the bearer");
    const settled = await journal();
    assert.deepEqual(settled.transactions, [], "durably settled transactions are cleaned from the journal");
    assert.equal(settled.replays.length, 1, "a bounded terminal receipt remains for exact-request metadata");

    const exactReplay = await exchangePairingRequest(
      crashed.pairingId,
      crashed.pairingSecret,
      crashed.idempotencyKey,
      crashed.requestHash,
      Date.now(),
    );
    assert.equal(exactReplay.kind, "already_exchanged");
    assert.equal("token" in exactReplay, false);
  });
}

test("a subprocess crash after the disclosure fence never rediscloses a potentially lost token", async () => {
  const previous = await issueCredential(approvedPairing(), Date.now());
  const crashed = await crashExchange("after-credential-settlement-before-return");
  const beforeRecovery = await journal();
  assert.deepEqual(beforeRecovery.transactions, []);
  assert.equal(beforeRecovery.replays.length, 1);

  const terminal = await exchangePairingRequest(
    crashed.pairingId,
    crashed.pairingSecret,
    crashed.idempotencyKey,
    crashed.requestHash,
    Date.now(),
  );
  assert.equal(terminal.kind, "already_exchanged");
  assert.equal("token" in terminal, false);

  const differentIdentity = await exchangePairingRequest(
    crashed.pairingId,
    crashed.pairingSecret,
    crypto.randomUUID(),
    crashed.requestHash,
    Date.now(),
  );
  assert.deepEqual(differentIdentity, { kind: "expired" });

  // HTTP has no trustworthy response-delivery acknowledgement. The unknown
  // credential is therefore revoked when its short delivery window closes,
  // rather than remaining silently active forever.
  const afterDeadline = Date.now() + PAIRING_CREDENTIAL_RECOVERY_TTL_MS + 1;
  assert.deepEqual(
    await exchangePairingRequest(
      crashed.pairingId,
      crashed.pairingSecret,
      crashed.idempotencyKey,
      crashed.requestHash,
      afterDeadline,
    ),
    { kind: "expired" },
  );
  const replacement = (await listCredentials()).find((credential) => credential.id !== previous.credential.id);
  assert.ok(replacement);
  assert.notEqual(replacement?.revokedAt, null, "an unacknowledged credential is bounded and revoked");
});

test("a stale unresolved transaction rolls back its replacement and restores the prior credential", async () => {
  const previous = await issueCredential(approvedPairing(), 1_000);
  const context = {
    pairingId: "b13b7c7b-70bf-43fa-9ee2-767807fc580f",
    pairingSecret: "settlement-secret",
    idempotencyKey: "b13b7c7b-70bf-43fa-9ee2-767807fc580a",
    requestHash: "d".repeat(64),
  };
  const issued = await issueCredentialForPairingSettlement(approvedPairing(), context, 2_000);
  assert.ok(await verifyCredential(issued.token, 2_001));
  assert.equal(await verifyCredential(previous.token, 2_001), null);
  await assert.rejects(
    issueCredential(approvedPairing(), 2_002),
    /awaiting settlement/,
    "a normal re-pair must not make the predecessor revocation irreversible while recovery is pending",
  );

  assert.deepEqual(
    await recoverPairingCredentialSettlement(context, 2_000 + PAIRING_CLAIM_STALE_MS + 1),
    { kind: "none" },
  );
  assert.equal(await verifyCredential(issued.token), null, "stale unfinished issuance must not remain active");
  assert.ok(await verifyCredential(previous.token), "rollback restores the predecessor credential");
  assert.deepEqual((await journal()).transactions, []);
});

test("an administrator revocation concurrent with settlement rollback never reactivates the predecessor", async () => {
  const previous = await issueCredential(approvedPairing(), 1_000);
  const context = {
    pairingId: "b13b7c7b-70bf-43fa-9ee2-767807fc580e",
    pairingSecret: "settlement-secret",
    idempotencyKey: "b13b7c7b-70bf-43fa-9ee2-767807fc580b",
    requestHash: "e".repeat(64),
  };
  const issued = await issueCredentialForPairingSettlement(approvedPairing(), context, 2_000);
  const expiredAt = 2_000 + PAIRING_CREDENTIAL_RECOVERY_TTL_MS + 1;

  // Calls share the durable credential transaction lock. Starting the
  // administrator operation first makes it the later revocation event before
  // recovery's rollback takes its own turn, exercising the ownership fence
  // rather than relying on a timestamp difference.
  const [revoked, recovered] = await Promise.all([
    revokeCredential(previous.credential.id, expiredAt),
    recoverPairingCredentialSettlement(context, expiredAt),
  ]);

  assert.equal(revoked, true);
  assert.deepEqual(recovered, { kind: "none" });
  assert.equal(await verifyCredential(issued.token), null, "the unresolved replacement is removed");
  assert.equal(
    await verifyCredential(previous.token),
    null,
    "the administrator's later revocation must outlive the settlement rollback",
  );
  assert.deepEqual((await journal()).transactions, []);
});

test("restart recovery preserves an administrator revocation over an unfinished replacement", async () => {
  const previous = await issueCredential(approvedPairing(), 1_000);
  const context = {
    pairingId: "b13b7c7b-70bf-43fa-9ee2-767807fc580e",
    pairingSecret: "settlement-secret",
    idempotencyKey: "b13b7c7b-70bf-43fa-9ee2-767807fc580c",
    requestHash: "f".repeat(64),
  };
  const issued = await issueCredentialForPairingSettlement(approvedPairing(), context, 2_000);
  const expiredAt = 2_000 + PAIRING_CREDENTIAL_RECOVERY_TTL_MS + 1;
  assert.equal(await revokeCredential(previous.credential.id, expiredAt), true);

  const credentialStoreUrl = pathToFileURL(
    path.resolve("src/lib/server/client-v1/credential-store.ts"),
  ).href;
  const restartedStore = await import(
    `${credentialStoreUrl}?restart-revocation-fence=${Date.now()}-${Math.random()}`,
  ) as typeof import("./credential-store.ts");
  const recovered = await restartedStore.recoverPairingCredentialSettlement(context, expiredAt);

  assert.deepEqual(recovered, { kind: "none" });
  assert.equal(await restartedStore.verifyCredential(issued.token), null);
  assert.equal(
    await restartedStore.verifyCredential(previous.token),
    null,
    "the durable administrator generation must survive module/process recovery",
  );
  assert.deepEqual((await journal()).transactions, []);
});

test("an exact retry recovers a credential when process-local pairing finalization throws", async () => {
  const { request, secret } = createPairingRequest(approvedPairing());
  decidePairingRequest(request.id, "approved");
  const key = crypto.randomUUID();
  const hash = requestHash(request.id);
  const failed = await exchangePairingRequest(request.id, secret, key, hash, Date.now(), {
    ...defaultPairingExchangeDeps,
    finalize: () => {
      throw new Error("simulated pairing settlement storage failure");
    },
  });
  assert.deepEqual(failed, { kind: "conflict" });
  assert.equal((await journal()).transactions.length, 1);

  const retry = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal(retry.kind, "ok");
  if (retry.kind !== "ok") return;
  assert.ok(await verifyCredential(retry.token));
  const terminalReplay = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal(terminalReplay.kind, "already_exchanged");
  assert.equal("token" in terminalReplay, false);
});

test("a post-rename credential fault reconciles before consuming the pairing or returning its exact replay", async () => {
  const { request, secret } = createPairingRequest(approvedPairing());
  decidePairingRequest(request.id, "approved");
  const key = crypto.randomUUID();
  const hash = requestHash(request.id);
  let injectAfterCredentialRename = true;
  const renameFault = Object.assign(new Error("credential rename outcome is unknown"), { code: "EIO" });
  setAtomicWriteTestHooksForTest({
    afterRename: (target) => {
      if (target === clientCredentialStorePath() && injectAfterCredentialRename) {
        injectAfterCredentialRename = false;
        throw renameFault;
      }
    },
  });

  const recovered = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal(recovered.kind, "ok", "the failed issuer must reconcile its committed credential");
  if (recovered.kind !== "ok") return;
  assert.ok(await verifyCredential(recovered.token));
  assert.equal(readPairingRequest(request.id, secret), null, "recovery must consume the original approval");
  assert.equal(isPairingRequestExpired(request.id, secret), true, "consumed pairing remains terminal");

  const exactRetry = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal(exactRetry.kind, "already_exchanged");
  assert.equal("token" in exactRetry, false);

  const differentKey = await exchangePairingRequest(
    request.id,
    secret,
    crypto.randomUUID(),
    hash,
    Date.now(),
  );
  assert.deepEqual(differentKey, { kind: "expired" }, "another key cannot exchange the consumed approval");
  assert.equal((await listCredentials()).length, 1, "reconciliation must not issue a second credential");
});

test("a terminal replay fences an older recovery claimant before it can return its token", async () => {
  const { request, secret } = createPairingRequest(approvedPairing(), 1_000);
  decidePairingRequest(request.id, "approved", 1_001);
  const key = crypto.randomUUID();
  const hash = requestHash(request.id);
  const claim = claimApprovedPairingWithIdempotency(request.id, secret, key, hash, 1_002);
  assert.equal(claim.kind, "claimed");
  if (claim.kind !== "claimed") return;

  const context = {
    pairingId: request.id,
    pairingSecret: secret,
    idempotencyKey: key,
    requestHash: hash,
    claimId: claim.claimId,
  };
  await issueCredentialForPairingSettlement(approvedPairing(), context, 1_003);
  const older = await recoverPairingCredentialSettlement(context, 1_004);
  assert.equal(older.kind, "issued");
  if (older.kind !== "issued") return;
  const newer = await recoverPairingCredentialSettlement(
    context,
    1_004 + PAIRING_EXCHANGE_RETRY_AFTER_MS,
  );
  assert.equal(newer.kind, "issued");
  if (newer.kind !== "issued") return;
  assert.notEqual(newer.recoveryClaimId, older.recoveryClaimId);
  assert.equal(
    await settlePairingCredentialSettlement(
      context,
      newer.recoveryClaimId,
      newer.claimId,
      1_005 + PAIRING_EXCHANGE_RETRY_AFTER_MS,
    ),
    true,
  );

  const stale = await exchangePairingRequest(request.id, secret, key, hash, 1_006, {
    ...defaultPairingExchangeDeps,
    recover: async () => older,
  });
  assert.deepEqual(
    stale,
    { kind: "recovery_pending" },
    "the old claimant must fail the terminal fence before exposing a token",
  );
  assert.equal("token" in stale, false);

  const winningReplay = await exchangePairingRequest(request.id, secret, key, hash, 1_007);
  assert.equal(winningReplay.kind, "already_exchanged");
  assert.equal("token" in winningReplay, false);
});

test("a terminal exact retry is metadata-only after administrator revocation", async () => {
  const { request, secret } = createPairingRequest(approvedPairing());
  decidePairingRequest(request.id, "approved");
  const key = crypto.randomUUID();
  const hash = requestHash(request.id);
  const issued = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal(issued.kind, "ok");
  if (issued.kind !== "ok") return;

  await revokeCredential(issued.credential.id, Date.now());
  const replay = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal(replay.kind, "already_exchanged", "a revoked terminal retry stays metadata-only");
  assert.equal("token" in replay, false);
  assert.equal(await verifyCredential(issued.token), null);
  assert.deepEqual((await journal()).replays, [], "revocation invalidates the encrypted terminal replay");

  const afterRevocation = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal("token" in afterRevocation, false, "a revoked replay never exposes its old bearer token");
});

test("a terminal exact retry is metadata-only after a replacement", async () => {
  const { request, secret } = createPairingRequest(approvedPairing());
  decidePairingRequest(request.id, "approved");
  const key = crypto.randomUUID();
  const hash = requestHash(request.id);
  const issued = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal(issued.kind, "ok");
  if (issued.kind !== "ok") return;

  const replacementCredential = await issueCredential(approvedPairing(), Date.now());
  const replay = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal(replay.kind, "already_exchanged", "replacement leaves only terminal metadata");
  assert.equal("token" in replay, false);
  assert.equal(await verifyCredential(issued.token), null, "the replaced token must no longer be active");
  assert.ok(
    await verifyCredential(replacementCredential.token),
    "the replacement credential remains the sole active bearer",
  );
  assert.deepEqual((await journal()).replays, [], "replacement invalidates the old terminal replay");

  const afterReplacement = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal("token" in afterReplacement, false, "a replaced replay never exposes its old bearer token");
});

test("terminal replay expires without restoring a predecessor or serving a different request identity", async () => {
  const previous = await issueCredential(approvedPairing(), 1_000);
  const { request, secret } = createPairingRequest(approvedPairing(), 1_001);
  decidePairingRequest(request.id, "approved", 1_002);
  const key = crypto.randomUUID();
  const hash = requestHash(request.id);
  const claim = claimApprovedPairingWithIdempotency(request.id, secret, key, hash, 1_003);
  assert.equal(claim.kind, "claimed");
  if (claim.kind !== "claimed") return;
  const context = {
    pairingId: request.id,
    pairingSecret: secret,
    idempotencyKey: key,
    requestHash: hash,
    claimId: claim.claimId,
  };
  const issued = await issueCredentialForPairingSettlement(approvedPairing(), context, 1_004);
  assert.equal(await settlePairingCredentialSettlement(context, null, claim.claimId, 1_005), true);

  const differentIdentity = await recoverPairingCredentialSettlement({
    ...context,
    idempotencyKey: crypto.randomUUID(),
  }, 1_006);
  assert.deepEqual(differentIdentity, { kind: "none" }, "a different idempotency key never replays a token");

  const afterExpiry = 1_004 + PAIRING_CREDENTIAL_RECOVERY_TTL_MS + 1;
  assert.deepEqual(await recoverPairingCredentialSettlement(context, afterExpiry), { kind: "none" });
  assert.equal(await verifyCredential(issued.token, afterExpiry), null, "an unacknowledged delivery expires");
  assert.equal(await verifyCredential(previous.token), null, "terminal replay expiry must not restore the predecessor");
});

test("the first authenticated bearer use acknowledges delivery without enabling token replay", async () => {
  const context = {
    pairingId: crypto.randomUUID(),
    pairingSecret: "acknowledgement-secret",
    idempotencyKey: crypto.randomUUID(),
    requestHash: "a".repeat(64),
    claimId: crypto.randomUUID(),
  };
  const issued = await issueCredentialForPairingSettlement(approvedPairing(), context, 1_000);
  assert.equal(await settlePairingCredentialSettlement(context, null, context.claimId, 1_001), true);
  assert.equal(await acknowledgePairingCredentialDelivery(issued.credential.id, 1_002), true);

  const acknowledged = await journal();
  assert.equal(acknowledged.replays.length, 1);
  assert.equal((acknowledged.replays[0] as { sealedToken: unknown }).sealedToken, null);
  const terminal = await recoverPairingCredentialSettlement(context, 1_003);
  assert.equal(terminal.kind, "terminal");
  assert.equal("token" in terminal, false);

  const afterDeadline = 1_000 + PAIRING_CREDENTIAL_RECOVERY_TTL_MS + 1;
  assert.deepEqual(await recoverPairingCredentialSettlement(context, afterDeadline), { kind: "none" });
  assert.ok(
    await verifyCredential(issued.token, afterDeadline),
    "acknowledged delivery remains active after terminal metadata expires",
  );
});

test("a legacy terminal replay migrates fail-closed instead of re-revealing its bearer", async () => {
  const context = {
    pairingId: crypto.randomUUID(),
    pairingSecret: "legacy-terminal-secret",
    idempotencyKey: crypto.randomUUID(),
    requestHash: "b".repeat(64),
    claimId: crypto.randomUUID(),
  };
  const issued = await issueCredentialForPairingSettlement(approvedPairing(), context, 1_000);
  assert.equal(await settlePairingCredentialSettlement(context, null, context.claimId, 1_001), true);
  const current = await journal();
  const legacyReplay = current.replays.map((entry) => {
    const { exposedAt: _exposedAt, deliveryAcknowledgedAt: _deliveryAcknowledgedAt, ...legacy } =
      entry as Record<string, unknown>;
    return legacy;
  });
  await writeFile(
    clientCredentialSettlementJournalPath(),
    JSON.stringify({ version: 1, transactions: current.transactions, replays: legacyReplay }),
  );

  const terminal = await recoverPairingCredentialSettlement(context, 1_002);
  assert.equal(terminal.kind, "terminal");
  assert.equal("token" in terminal, false);

  const afterDeadline = 1_000 + PAIRING_CREDENTIAL_RECOVERY_TTL_MS + 1;
  assert.deepEqual(await recoverPairingCredentialSettlement(context, afterDeadline), { kind: "none" });
  assert.equal(await verifyCredential(issued.token, afterDeadline), null);
});

test("a terminal replay survives mutable credential use within its recovery window", async () => {
  const { request, secret } = createPairingRequest(approvedPairing(), 1_000);
  decidePairingRequest(request.id, "approved", 1_001);
  const key = crypto.randomUUID();
  const hash = requestHash(request.id);
  const claim = claimApprovedPairingWithIdempotency(request.id, secret, key, hash, 1_002);
  assert.equal(claim.kind, "claimed");
  if (claim.kind !== "claimed") return;
  const context = {
    pairingId: request.id,
    pairingSecret: secret,
    idempotencyKey: key,
    requestHash: hash,
    claimId: claim.claimId,
  };
  const issued = await issueCredentialForPairingSettlement(approvedPairing(), context, 1_003);
  assert.equal(await settlePairingCredentialSettlement(context, null, claim.claimId, 1_004), true);
  await recordCredentialUse(issued.credential.id, 1_003 + 60_001);

  const replay = await recoverPairingCredentialSettlement(context, 1_005);
  assert.equal(replay.kind, "terminal");
  assert.equal("token" in replay, false);
});

test("settlement capacity never evicts a live terminal replay before its expiry", async () => {
  const firstContext = {
    pairingId: crypto.randomUUID(),
    pairingSecret: "first-replay-secret",
    idempotencyKey: crypto.randomUUID(),
    requestHash: "f".repeat(64),
    claimId: crypto.randomUUID(),
  };
  await issueCredentialForPairingSettlement(
    { ...approvedPairing(), installationId: crypto.randomUUID() },
    firstContext,
    1_000,
  );
  assert.equal(
    await settlePairingCredentialSettlement(firstContext, null, firstContext.claimId, 1_001),
    true,
  );

  for (let index = 1; index < PAIRING_CREDENTIAL_SETTLEMENT_MAX_ENTRIES; index += 1) {
    const context = {
      pairingId: crypto.randomUUID(),
      pairingSecret: `replay-secret-${index}`,
      idempotencyKey: crypto.randomUUID(),
      requestHash: `${index.toString(16).padStart(64, "0")}`,
      claimId: crypto.randomUUID(),
    };
    await issueCredentialForPairingSettlement(
      { ...approvedPairing(), installationId: crypto.randomUUID() },
      context,
      1_000 + index,
    );
    assert.equal(
      await settlePairingCredentialSettlement(context, null, context.claimId, 1_001 + index),
      true,
    );
  }

  const overflowContext = {
    pairingId: crypto.randomUUID(),
    pairingSecret: "overflow-replay-secret",
    idempotencyKey: crypto.randomUUID(),
    requestHash: "e".repeat(64),
    claimId: crypto.randomUUID(),
  };
  await issueCredentialForPairingSettlement(
    { ...approvedPairing(), installationId: crypto.randomUUID() },
    overflowContext,
    2_000,
  );
  assert.equal(
    await settlePairingCredentialSettlement(overflowContext, null, overflowContext.claimId, 2_001),
    false,
    "a full replay journal leaves the new transaction recoverable instead of evicting an older replay",
  );
  const firstReplay = await recoverPairingCredentialSettlement(firstContext, 2_002);
  assert.equal(firstReplay.kind, "terminal");
  assert.equal("token" in firstReplay, false);
  const fullJournal = await journal();
  assert.equal(fullJournal.replays.length, PAIRING_CREDENTIAL_SETTLEMENT_MAX_ENTRIES);
  assert.equal(fullJournal.transactions.length, 1);
});

test("a post-rename credential durability fault recovers one delivery then fences terminal retry", async () => {
  const previous = await issueCredential(approvedPairing(), Date.now());
  const { request, secret } = createPairingRequest(approvedPairing());
  decidePairingRequest(request.id, "approved");
  const key = crypto.randomUUID();
  const hash = requestHash(request.id);
  let injected = false;
  setAtomicWriteTestHooksForTest({
    beforeDirectorySync: (_directory, target) => {
      if (target !== clientCredentialStorePath() || injected) return;
      injected = true;
      throw new Error("injected credential directory-sync failure");
    },
  });

  const reconciled = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal(reconciled.kind, "ok", "the uncertain post-rename write must reconcile before release");
  assert.equal(injected, true);
  if (reconciled.kind !== "ok") return;
  assert.equal(readPairingRequest(request.id, secret), null, "reconciliation consumes the approval");

  setAtomicWriteTestHooksForTest(null);
  const exactReplay = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal(exactReplay.kind, "already_exchanged");
  assert.equal("token" in exactReplay, false);
  assert.ok(await verifyCredential(reconciled.token));
  assert.equal(await verifyCredential(previous.token), null, "recovery keeps the persisted replacement authoritative");
});

test("a pre-sync journal durability fault leaves the approved pairing and authority unchanged", async () => {
  const { request, secret } = createPairingRequest(approvedPairing());
  decidePairingRequest(request.id, "approved");
  const key = crypto.randomUUID();
  const hash = requestHash(request.id);
  let injected = false;
  setAtomicWriteTestHooksForTest({
    beforeTempSync: (_tmp, target) => {
      if (target !== clientCredentialSettlementJournalPath() || injected) return;
      injected = true;
      throw new Error("injected settlement journal temp-sync failure");
    },
  });

  const failed = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.deepEqual(failed, { kind: "issue_failed" });
  assert.equal(injected, true);
  assert.equal((await listCredentials()).length, 0);
  assert.equal(readPairingRequest(request.id, secret)?.status, "approved");

  setAtomicWriteTestHooksForTest(null);
  const retry = await exchangePairingRequest(request.id, secret, key, hash, Date.now());
  assert.equal(retry.kind, "ok");
});

test("a corrupt durable journal fails closed before credential issuance and leaves approval retryable", async () => {
  await writeFile(clientCredentialSettlementJournalPath(), "{not-json");
  const { request, secret } = createPairingRequest(approvedPairing());
  decidePairingRequest(request.id, "approved");
  const key = crypto.randomUUID();

  assert.deepEqual(
    await exchangePairingRequest(request.id, secret, key, requestHash(request.id), Date.now()),
    { kind: "issue_failed" },
  );
  assert.equal((await listCredentials()).length, 0);
  assert.equal(readPairingRequest(request.id, secret)?.status, "approved");
});

console.log("credential-settlement.test.ts: ok");
