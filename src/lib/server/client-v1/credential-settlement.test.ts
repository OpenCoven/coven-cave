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
  createPairingRequest,
  decidePairingRequest,
  readPairingRequest,
  resetPairingRequestsForTest,
} from "./pairing-store.ts";
import { defaultPairingExchangeDeps, exchangePairingRequest } from "./pairing-exchange.ts";
import {
  clientCredentialSettlementJournalPath,
  clientCredentialStorePath,
  issueCredential,
  issueCredentialForPairingSettlement,
  listCredentials,
  recoverPairingCredentialSettlement,
  verifyCredential,
} from "./credential-store.ts";
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
  version: 1;
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

for (const point of ["after-credential-write", "after-pairing-finalize"]) {
  test(`a subprocess crash ${point} recovers one exact retry without leaking its token to disk`, async () => {
    const previous = await issueCredential(approvedPairing(), Date.now());
    const crashed = await crashExchange(point);
    const rawBeforeRecovery = await readFile(clientCredentialSettlementJournalPath(), "utf8");
    assert.match(rawBeforeRecovery, /"ciphertext"/);
    assert.equal((await journal()).transactions.length, 1);

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
    const recovered = first.kind === "ok" ? first : duplicate;
    assert.equal(recovered.kind, "ok", "one exact retry must recover the issued bearer token");
    if (recovered.kind !== "ok") return;
    const other = first.kind === "ok" ? duplicate : first;
    assert.ok(
      other.kind === "processing" || other.kind === "already_exchanged",
      "a concurrent retry may wait for recovery or observe its terminal receipt, but must never get a second token",
    );
    assert.ok(await verifyCredential(recovered.token), "the recovered token must be the active credential");
    assert.equal(await verifyCredential(previous.token), null, "the recovered replacement supersedes its predecessor");

    const rawAfterRecovery = await readFile(clientCredentialSettlementJournalPath(), "utf8");
    assert.equal(rawBeforeRecovery.includes(recovered.token), false, "the pending journal must encrypt the bearer token");
    assert.equal(rawAfterRecovery.includes(recovered.token), false, "the terminal replay receipt must encrypt the bearer token");
    const settled = await journal();
    assert.deepEqual(settled.transactions, [], "durably settled transactions are cleaned from the journal");
    assert.equal(settled.replays.length, 1, "a bounded encrypted replay receipt remains for terminal idempotency");
  });
}

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
