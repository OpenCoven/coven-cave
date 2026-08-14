import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { XApiError, type XScope } from "../x-api.ts";
import type {
  XConnectionStatus,
  XCredentialServiceDependencies,
  XCredentialService,
  XTokenBundle,
  XTokenRefreshResult,
} from "./x-credentials.ts";

type Equal<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2)
    ? (<Value>() => Value extends Expected ? 1 : 2) extends
      (<Value>() => Value extends Actual ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Condition extends true> = Condition;

export type XTokenBundleIsExact = Assert<Equal<XTokenBundle, {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: XScope[];
  account: { id: string; username: string; name: string };
}>>;
export type XConnectionStatusIsExact = Assert<Equal<XConnectionStatus,
  | { connected: false }
  | {
    connected: true;
    expiresAt: string;
    scopes: XScope[];
    account: { id: string; username: string; name: string };
  }
>>;
export type XCredentialServiceIsExact = Assert<Equal<XCredentialService, {
  getConnectionStatus(): XConnectionStatus;
  replaceBundle(bundle: XTokenBundle): void;
  getAccessToken(
    requiredScopes: XScope[],
    options?: { refreshIfExpiringWithinMs?: number },
  ): Promise<string>;
  forceRefresh(requiredScopes: XScope[]): Promise<string>;
  disconnect(): void;
}>>;
export type XRefreshDependencyIsNarrow = Assert<Equal<
  XCredentialServiceDependencies["refreshBundle"],
  (refreshToken: string) => Promise<unknown>
>>;

const priorVaultFile = process.env.COVEN_CAVE_LOCAL_VAULT_FILE;
const priorVaultKeyFile = process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE;
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "cave-x-credentials-"));
const vaultFile = path.join(temporaryRoot, "x-vault.enc.json");
const vaultKeyFile = path.join(temporaryRoot, "x-vault.key");
process.env.COVEN_CAVE_LOCAL_VAULT_FILE = vaultFile;
process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = vaultKeyFile;

try {
// Production custody is deliberately backed by the direct encrypted-secret
// getter, setter, and deleter contract; the snapshot/CAS seam remains only
// available to injected services that need it.
{
  const source = await readFile(
    new URL("./x-credentials.ts", import.meta.url),
    "utf8",
  );
  const productionWiring = source.slice(
    source.indexOf("export const xCredentialService"),
  );
  assert.match(
    productionWiring,
    /getSecret:\s*\(\)\s*=>\s*getLocalEncryptedSecret\(X_OAUTH_TOKEN_BUNDLE_KEY\)/,
    "the production singleton reads X custody through getLocalEncryptedSecret",
  );
  assert.match(
    productionWiring,
    /setSecret:\s*\(value\)\s*=>\s*setLocalEncryptedSecret\(X_OAUTH_TOKEN_BUNDLE_KEY, value\)/,
    "the production singleton writes X custody through setLocalEncryptedSecret",
  );
  assert.match(
    productionWiring,
    /deleteSecret:\s*\(\)\s*=>\s*deleteLocalEncryptedSecret\(X_OAUTH_TOKEN_BUNDLE_KEY\)/,
    "the production singleton deletes X custody through deleteLocalEncryptedSecret",
  );
  assert.match(
    productionWiring,
    /refreshBundle:\s*\(refreshToken\)\s*=>\s*refreshXToken\(\{ refreshToken \}\)/,
    "the production singleton refreshes through the strict X client",
  );
  assert.doesNotMatch(
    productionWiring,
    /getLocalEncryptedSecretSnapshot/,
    "the production singleton does not require the snapshot getter",
  );
  assert.match(
    source,
    /function refresh\(\s*current: XTokenBundle,\s*startingRevision: string \| null,/,
    "refresh accepts the direct getter's revisionless custody path",
  );
  assert.match(
    source,
    /function currentBundle\(requiredScopes: unknown\): \{\s*bundle: XTokenBundle;\s*revision: string \| null;/,
    "currentBundle preserves a revisionless direct getter result",
  );
}

const {
  X_OAUTH_TOKEN_BUNDLE_KEY,
  createXCredentialService,
  xCredentialService,
} = await import("./x-credentials.ts");
const {
  getLocalEncryptedSecret,
} = await import("../local-encrypted-vault.ts");

const NOW = Date.parse("2026-07-27T12:00:00.000Z");
const COMPLETE_BUNDLE: XTokenBundle = {
  accessToken: "synthetic-test-access-token-initial",
  refreshToken: "synthetic-test-refresh-token-initial",
  expiresAt: "2026-07-27T13:00:00.000Z",
  scopes: ["tweet.read", "users.read", "offline.access"],
  account: {
    id: "synthetic-account-id",
    username: "synthetic_user",
    name: "Synthetic Test User",
  },
};

function cloneBundle(bundle: XTokenBundle = COMPLETE_BUNDLE): XTokenBundle {
  return {
    ...bundle,
    scopes: [...bundle.scopes],
    account: { ...bundle.account },
  };
}

function tokenMatches(actual: unknown, expected: string, message: string): void {
  assert.equal(
    typeof actual === "string" && actual.length > 0 && actual === expected,
    true,
    message,
  );
}

function assertSafeError(
  error: unknown,
  code: string,
  safeMessage: string,
): boolean {
  return error instanceof XApiError
    && error.code === code
    && error.safeMessage === safeMessage
    && error.message === safeMessage;
}

type MemoryStorage = {
  raw: string | null;
  writes: string[];
  deletes: number;
  revision?: number;
};

function memoryService(
  storage: MemoryStorage,
  refreshBundle: (refreshToken: string) => Promise<unknown>,
) {
  const revision = () =>
    `synthetic-memory-revision-${storage.revision ?? 0}`;
  const advanceRevision = () => {
    storage.revision = (storage.revision ?? 0) + 1;
  };
  return createXCredentialService({
    getSecretSnapshot: () =>
      storage.raw === null
        ? null
        : { value: storage.raw, revision: revision() },
    setSecret: (value: string) => {
      storage.writes.push(value);
      storage.raw = value;
      advanceRevision();
    },
    setSecretIfRevision: (expectedRevision: string, value: string) => {
      if (storage.raw === null || expectedRevision !== revision()) return false;
      storage.writes.push(value);
      storage.raw = value;
      advanceRevision();
      return true;
    },
    deleteSecret: () => {
      storage.deletes += 1;
      storage.raw = null;
      advanceRevision();
    },
    refreshBundle,
    now: () => NOW,
  });
}

function storedBundle(storage: MemoryStorage): XTokenBundle {
  assert.ok(storage.raw, "the complete bundle is stored");
  return JSON.parse(storage.raw) as XTokenBundle;
}

// Strict replacement persists exactly one complete JSON bundle and returns a
// token-free connection view.
{
  const storage: MemoryStorage = { raw: null, writes: [], deletes: 0 };
  const service = memoryService(storage, async () => {
    throw new Error("refresh should not run");
  });

  service.replaceBundle(cloneBundle());
  assert.equal(storage.writes.length, 1, "replacement is one atomic storage write");
  const persisted = storedBundle(storage);
  tokenMatches(
    persisted.accessToken,
    COMPLETE_BUNDLE.accessToken,
    "the access token is preserved inside encrypted custody",
  );
  tokenMatches(
    persisted.refreshToken,
    COMPLETE_BUNDLE.refreshToken,
    "the refresh token is preserved inside encrypted custody",
  );
  assert.deepEqual(persisted.scopes, COMPLETE_BUNDLE.scopes);
  assert.deepEqual(persisted.account, COMPLETE_BUNDLE.account);

  const status = service.getConnectionStatus();
  assert.deepEqual(status, {
    connected: true,
    expiresAt: COMPLETE_BUNDLE.expiresAt,
    scopes: COMPLETE_BUNDLE.scopes,
    account: COMPLETE_BUNDLE.account,
  });
  assert.deepEqual(
    Object.keys(status).sort(),
    ["account", "connected", "expiresAt", "scopes"],
    "connection status exposes only non-secret metadata",
  );
  const serializedStatus = JSON.stringify(status);
  assert.equal(
    serializedStatus.includes(COMPLETE_BUNDLE.accessToken)
      || serializedStatus.includes(COMPLETE_BUNDLE.refreshToken),
    false,
    "connection status never exposes either token",
  );

  const invalidBundles: Array<{ name: string; value: unknown }> = [
    {
      name: "invalid expiry",
      value: { ...cloneBundle(), expiresAt: "not-a-date" },
    },
    {
      name: "non-canonical expiry",
      value: { ...cloneBundle(), expiresAt: "2026-07-27T13:00:00Z" },
    },
    {
      name: "unknown scope",
      value: { ...cloneBundle(), scopes: ["tweet.read", "synthetic.unknown"] },
    },
    {
      name: "duplicate scope",
      value: { ...cloneBundle(), scopes: ["tweet.read", "tweet.read"] },
    },
    {
      name: "empty access token",
      value: { ...cloneBundle(), accessToken: "" },
    },
    {
      name: "empty refresh token",
      value: { ...cloneBundle(), refreshToken: " " },
    },
    {
      name: "empty account id",
      value: { ...cloneBundle(), account: { ...COMPLETE_BUNDLE.account, id: "" } },
    },
    {
      name: "empty username",
      value: { ...cloneBundle(), account: { ...COMPLETE_BUNDLE.account, username: "\t" } },
    },
    {
      name: "empty account name",
      value: { ...cloneBundle(), account: { ...COMPLETE_BUNDLE.account, name: "" } },
    },
    {
      name: "extraneous bundle field",
      value: { ...cloneBundle(), syntheticUnexpected: true },
    },
    {
      name: "extraneous account field",
      value: {
        ...cloneBundle(),
        account: { ...COMPLETE_BUNDLE.account, syntheticUnexpected: true },
      },
    },
  ];

  const baseline = storage.raw;
  for (const invalid of invalidBundles) {
    assert.throws(
      () => service.replaceBundle(invalid.value as XTokenBundle),
      (error: unknown) =>
        assertSafeError(error, "invalid-response", "X credential data is invalid"),
      `strict replacement rejects ${invalid.name}`,
    );
    assert.equal(
      storage.raw === baseline,
      true,
      `rejected ${invalid.name} does not overwrite the complete bundle`,
    );
  }
}

// Missing and malformed persisted values fail closed instead of leaking raw
// data or being silently rewritten.
{
  const storage: MemoryStorage = { raw: null, writes: [], deletes: 0 };
  const service = memoryService(storage, async () => {
    throw new Error("refresh should not run");
  });
  const malformedValues = [
    null,
    "",
    "{",
    "null",
    JSON.stringify({}),
    JSON.stringify({ ...cloneBundle(), accessToken: "" }),
    JSON.stringify({ ...cloneBundle(), scopes: ["synthetic.unknown"] }),
    JSON.stringify({ ...cloneBundle(), syntheticUnexpected: true }),
  ];

  for (const raw of malformedValues) {
    storage.raw = raw;
    assert.deepEqual(
      service.getConnectionStatus(),
      { connected: false },
      "missing or malformed custody is disconnected",
    );
    await assert.rejects(
      service.getAccessToken(["tweet.read"]),
      (error: unknown) =>
        assertSafeError(error, "not-connected", "X account is not connected"),
      "missing or malformed custody fails closed before token use",
    );
  }
  assert.equal(storage.writes.length, 0, "malformed custody is never rewritten");
}

// Scope checks happen before refresh and required scope input is runtime-safe.
{
  const storage: MemoryStorage = {
    raw: JSON.stringify(cloneBundle()),
    writes: [],
    deletes: 0,
  };
  let refreshCalls = 0;
  const service = memoryService(storage, async () => {
    refreshCalls += 1;
    return {
      accessToken: "synthetic-test-access-token-unused",
      expiresAt: "2026-07-27T14:00:00.000Z",
    } satisfies XTokenRefreshResult;
  });

  await assert.rejects(
    service.getAccessToken(["tweet.write"]),
    (error: unknown) =>
      assertSafeError(
        error,
        "missing-scope",
        "X account is missing a required permission",
      ),
    "a missing granted scope throws a safe typed error",
  );
  assert.equal(refreshCalls, 0, "missing scope never attempts refresh");

  await assert.rejects(
    service.getAccessToken(["synthetic.unknown" as XScope]),
    (error: unknown) =>
      assertSafeError(error, "invalid-request", "X credential request is invalid"),
    "required scopes are validated against the exact XScope union",
  );
  assert.equal(refreshCalls, 0);
}

// Both token operations require at least one exact runtime scope and reject
// empty capability requests before reading or refreshing credentials.
{
  let storageReads = 0;
  let refreshCalls = 0;
  const service = createXCredentialService({
    getSecretSnapshot: () => {
      storageReads += 1;
      return {
        value: JSON.stringify(cloneBundle()),
        revision: "synthetic-empty-scope-revision",
      };
    },
    setSecret: () => undefined,
    setSecretIfRevision: () => false,
    deleteSecret: () => undefined,
    refreshBundle: async () => {
      refreshCalls += 1;
      return {
        accessToken: "synthetic-test-access-token-empty-scope",
        expiresAt: "2026-07-27T14:00:00.000Z",
      } satisfies XTokenRefreshResult;
    },
    now: () => NOW,
  });
  const classify = async (operation: Promise<string>): Promise<string> => {
    try {
      await operation;
      return "resolved";
    } catch (error) {
      return assertSafeError(
        error,
        "invalid-request",
        "X credential request is invalid",
      )
        ? "invalid-request"
        : "other-error";
    }
  };
  const outcomes = await Promise.all([
    classify(service.getAccessToken([])),
    classify(service.forceRefresh([])),
  ]);
  assert.deepEqual(
    outcomes,
    ["invalid-request", "invalid-request"],
    "getAccessToken and forceRefresh both reject empty required scopes",
  );
  assert.equal(storageReads, 0, "empty scopes are rejected before storage");
  assert.equal(refreshCalls, 0, "empty scopes are rejected before refresh");

  const duplicateOutcome = await service.getAccessToken([
    "tweet.read",
    "tweet.read",
  ]).then(
    (token) => token === COMPLETE_BUNDLE.accessToken ? "resolved" : "wrong-token",
    (error: unknown) => error instanceof XApiError ? error.code : "other-error",
  );
  assert.equal(
    duplicateOutcome,
    "resolved",
    "duplicate exact required scopes are normalized defensively",
  );
  assert.equal(storageReads, 1);
  assert.equal(refreshCalls, 0);
}

// Runtime callers cannot bypass the options contract through untyped JSON or
// JavaScript. Invalid shapes fail before credentials are read or refreshed.
{
  let storageReads = 0;
  let refreshCalls = 0;
  const service = createXCredentialService({
    getSecretSnapshot: () => {
      storageReads += 1;
      return {
        value: JSON.stringify(cloneBundle()),
        revision: "synthetic-options-revision",
      };
    },
    setSecret: () => undefined,
    setSecretIfRevision: () => false,
    deleteSecret: () => undefined,
    refreshBundle: async () => {
      refreshCalls += 1;
      throw new Error("refresh should not run");
    },
    now: () => NOW,
  });
  const invalidOptions: Array<{ name: string; value: unknown }> = [
    { name: "null", value: null },
    { name: "string", value: "synthetic-invalid-options" },
    { name: "number", value: 1 },
    { name: "boolean", value: true },
    { name: "array", value: [] },
    { name: "unknown key", value: { syntheticUnexpected: true } },
    {
      name: "valid key plus unknown key",
      value: {
        refreshIfExpiringWithinMs: 0,
        syntheticUnexpected: true,
      },
    },
    { name: "non-plain object", value: new Date(0) },
  ];

  for (const invalid of invalidOptions) {
    await assert.rejects(
      service.getAccessToken(
        ["tweet.read"],
        invalid.value as { refreshIfExpiringWithinMs?: number },
      ),
      (error: unknown) =>
        assertSafeError(error, "invalid-request", "X credential request is invalid"),
      `runtime options reject ${invalid.name}`,
    );
    assert.equal(storageReads, 0, `${invalid.name} is rejected before storage`);
    assert.equal(refreshCalls, 0, `${invalid.name} is rejected before refresh`);
  }

  const nullPrototypeOptions = Object.create(null) as {
    refreshIfExpiringWithinMs?: number;
  };
  nullPrototypeOptions.refreshIfExpiringWithinMs = 0;
  const token = await service.getAccessToken(
    ["tweet.read"],
    nullPrototypeOptions,
  );
  tokenMatches(
    token,
    COMPLETE_BUNDLE.accessToken,
    "a null-prototype record is accepted as a plain options record",
  );
  assert.equal(storageReads, 1);
  assert.equal(refreshCalls, 0);
}

// A fresh token is read through custody, while near-expiry access uses one
// refresh operation for all concurrent callers.
{
  const freshStorage: MemoryStorage = {
    raw: JSON.stringify(cloneBundle()),
    writes: [],
    deletes: 0,
  };
  let unusedRefreshCalls = 0;
  const freshService = memoryService(freshStorage, async () => {
    unusedRefreshCalls += 1;
    throw new Error("refresh should not run");
  });
  const freshToken = await freshService.getAccessToken(["tweet.read"]);
  tokenMatches(
    freshToken,
    COMPLETE_BUNDLE.accessToken,
    "a fresh access token is returned from encrypted custody",
  );
  assert.equal(unusedRefreshCalls, 0);

  for (const refreshIfExpiringWithinMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      freshService.getAccessToken(
        ["tweet.read"],
        { refreshIfExpiringWithinMs },
      ),
      (error: unknown) =>
        assertSafeError(error, "invalid-request", "X credential request is invalid"),
      "invalid refresh windows are rejected",
    );
  }

  const expiring = cloneBundle({
    ...COMPLETE_BUNDLE,
    expiresAt: "2026-07-27T12:04:00.000Z",
  });
  const storage: MemoryStorage = {
    raw: JSON.stringify(expiring),
    writes: [],
    deletes: 0,
  };
  let refreshCalls = 0;
  let resolveRefresh!: (value: XTokenRefreshResult) => void;
  const pendingRefresh = new Promise<XTokenRefreshResult>((resolve) => {
    resolveRefresh = resolve;
  });
  const service = memoryService(storage, async () => {
    refreshCalls += 1;
    return pendingRefresh;
  });

  const first = service.getAccessToken(["tweet.read"]);
  const second = service.getAccessToken(["users.read"]);
  await Promise.resolve();
  assert.equal(refreshCalls, 1, "concurrent callers share one refresh operation");

  resolveRefresh({
    accessToken: "synthetic-test-access-token-rotated",
    refreshToken: "synthetic-test-refresh-token-rotated",
    expiresAt: "2026-07-27T14:00:00.000Z",
    scopes: ["tweet.read", "users.read", "offline.access", "tweet.write"],
    account: {
      id: "synthetic-account-id-rotated",
      username: "synthetic_rotated",
      name: "Synthetic Rotated User",
    },
  });
  const [firstToken, secondToken] = await Promise.all([first, second]);
  tokenMatches(
    firstToken,
    "synthetic-test-access-token-rotated",
    "the first waiter receives only the rotated access token",
  );
  tokenMatches(
    secondToken,
    "synthetic-test-access-token-rotated",
    "the second waiter receives only the rotated access token",
  );
  assert.equal(storage.writes.length, 1, "the rotated bundle is persisted once");
  const rotated = storedBundle(storage);
  tokenMatches(
    rotated.accessToken,
    "synthetic-test-access-token-rotated",
    "the rotated access token replaces prior custody",
  );
  tokenMatches(
    rotated.refreshToken,
    "synthetic-test-refresh-token-rotated",
    "the rotated refresh token replaces prior custody",
  );
  assert.equal(rotated.expiresAt, "2026-07-27T14:00:00.000Z");
  assert.deepEqual(
    rotated.scopes,
    ["tweet.read", "users.read", "offline.access", "tweet.write"],
  );
  assert.deepEqual(rotated.account, {
    id: "synthetic-account-id-rotated",
    username: "synthetic_rotated",
    name: "Synthetic Rotated User",
  });
}

// Shared refresh persists one candidate, then each waiter independently
// verifies its own scope requirement against that refreshed candidate.
{
  const storage: MemoryStorage = {
    raw: JSON.stringify(cloneBundle()),
    writes: [],
    deletes: 0,
  };
  let refreshCalls = 0;
  let resolveRefresh!: (value: XTokenRefreshResult) => void;
  const pendingRefresh = new Promise<XTokenRefreshResult>((resolve) => {
    resolveRefresh = resolve;
  });
  const service = memoryService(storage, async () => {
    refreshCalls += 1;
    return pendingRefresh;
  });

  const grantedOutcome = service.forceRefresh(["tweet.read"]).then(
    (token) => ({ kind: "granted" as const, token }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  );
  const droppedOutcome = service.forceRefresh(["users.read"]).then(
    (token) => ({ kind: "granted" as const, token }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  );
  await Promise.resolve();
  assert.equal(refreshCalls, 1, "scope-divergent waiters share one refresh");

  resolveRefresh({
    accessToken: "synthetic-test-access-token-scope-reduced",
    refreshToken: "synthetic-test-refresh-token-scope-reduced",
    expiresAt: "2026-07-27T14:30:00.000Z",
    scopes: ["tweet.read"],
  });
  const [granted, dropped] = await Promise.all([
    grantedOutcome,
    droppedOutcome,
  ]);
  assert.equal(granted.kind, "granted");
  if (granted.kind === "granted") {
    tokenMatches(
      granted.token,
      "synthetic-test-access-token-scope-reduced",
      "the still-granted waiter receives the refreshed access token",
    );
  }
  assert.equal(dropped.kind, "rejected");
  if (dropped.kind === "rejected") {
    assert.equal(
      assertSafeError(
        dropped.error,
        "missing-scope",
        "X account is missing a required permission",
      ),
      true,
      "the dropped-scope waiter receives a safe missing-scope error",
    );
  }
  assert.equal(refreshCalls, 1);
  assert.equal(storage.writes.length, 1, "the shared candidate persists once");
  assert.deepEqual(storedBundle(storage).scopes, ["tweet.read"]);
}

// Refresh may omit fields documented as unchanged, but never either newly
// required access-token field. Invalid or failed refreshes leave custody alone.
{
  const omittedStorage: MemoryStorage = {
    raw: JSON.stringify(cloneBundle()),
    writes: [],
    deletes: 0,
  };
  const omittedService = memoryService(omittedStorage, async () => ({
    accessToken: "synthetic-test-access-token-refreshed",
    expiresAt: "2026-07-27T15:00:00.000Z",
  }));
  await omittedService.forceRefresh(["tweet.read"]);
  const omitted = storedBundle(omittedStorage);
  tokenMatches(
    omitted.refreshToken,
    COMPLETE_BUNDLE.refreshToken,
    "an omitted refresh token preserves the existing complete token",
  );
  assert.deepEqual(omitted.scopes, COMPLETE_BUNDLE.scopes);
  assert.deepEqual(omitted.account, COMPLETE_BUNDLE.account);

  const invalidResults: Array<{ name: string; value: unknown }> = [
    {
      name: "expiry before the injected clock",
      value: {
        accessToken: "synthetic-test-access-token-expired-refresh",
        expiresAt: "2026-07-27T11:59:59.999Z",
      },
    },
    {
      name: "expiry equal to the injected clock",
      value: {
        accessToken: "synthetic-test-access-token-expired-refresh",
        expiresAt: "2026-07-27T12:00:00.000Z",
      },
    },
    {
      name: "missing access token",
      value: { expiresAt: "2026-07-27T15:00:00.000Z" },
    },
    {
      name: "missing expiry",
      value: { accessToken: "synthetic-test-access-token-partial" },
    },
    {
      name: "empty access token",
      value: {
        accessToken: "",
        expiresAt: "2026-07-27T15:00:00.000Z",
      },
    },
    {
      name: "empty rotated refresh token",
      value: {
        accessToken: "synthetic-test-access-token-partial",
        refreshToken: "",
        expiresAt: "2026-07-27T15:00:00.000Z",
      },
    },
    {
      name: "invalid expiry",
      value: {
        accessToken: "synthetic-test-access-token-partial",
        expiresAt: "later",
      },
    },
    {
      name: "unknown scope",
      value: {
        accessToken: "synthetic-test-access-token-partial",
        expiresAt: "2026-07-27T15:00:00.000Z",
        scopes: ["synthetic.unknown"],
      },
    },
    {
      name: "partial identity",
      value: {
        accessToken: "synthetic-test-access-token-partial",
        expiresAt: "2026-07-27T15:00:00.000Z",
        account: { id: "synthetic-account-id" },
      },
    },
    {
      name: "extraneous field",
      value: {
        accessToken: "synthetic-test-access-token-partial",
        expiresAt: "2026-07-27T15:00:00.000Z",
        syntheticUnexpected: true,
      },
    },
  ];

  for (const invalid of invalidResults) {
    const original = JSON.stringify(cloneBundle());
    const storage: MemoryStorage = { raw: original, writes: [], deletes: 0 };
    const service = memoryService(storage, async () => invalid.value);
    await assert.rejects(
      service.forceRefresh(["tweet.read"]),
      (error: unknown) =>
        assertSafeError(error, "invalid-response", "X credential data is invalid"),
      `refresh rejects ${invalid.name}`,
    );
    assert.equal(storage.raw === original, true, `${invalid.name} leaves custody untouched`);
    assert.equal(storage.writes.length, 0);
  }

  const expiredInitialStorage: MemoryStorage = {
    raw: JSON.stringify(cloneBundle({
      ...COMPLETE_BUNDLE,
      expiresAt: "2026-07-27T11:00:00.000Z",
    })),
    writes: [],
    deletes: 0,
  };
  const expiredInitialService = memoryService(
    expiredInitialStorage,
    async () => ({
      accessToken: "synthetic-test-access-token-from-expired-initial",
      expiresAt: "2026-07-27T15:00:00.000Z",
    }),
  );
  const recoveredToken = await expiredInitialService.getAccessToken([
    "tweet.read",
  ]);
  tokenMatches(
    recoveredToken,
    "synthetic-test-access-token-from-expired-initial",
    "an expired stored bundle can refresh into a future complete candidate",
  );
  assert.equal(expiredInitialStorage.writes.length, 1);

  const original = JSON.stringify(cloneBundle());
  const failureStorage: MemoryStorage = {
    raw: original,
    writes: [],
    deletes: 0,
  };
  const failureService = memoryService(failureStorage, async () => {
    throw new Error("synthetic upstream body that must not escape");
  });
  await assert.rejects(
    failureService.forceRefresh(["tweet.read"]),
    (error: unknown) =>
      error instanceof XApiError
      && assertSafeError(
        error,
        "upstream-unavailable",
        "X authorization could not be refreshed",
      )
      && !error.message.includes("synthetic upstream body"),
    "refresh failures are sanitized",
  );
  assert.equal(
    failureStorage.raw === original,
    true,
    "refresh failure leaves the last complete bundle untouched",
  );
  assert.equal(failureStorage.writes.length, 0);

  const typedFailureStorage: MemoryStorage = {
    raw: original,
    writes: [],
    deletes: 0,
  };
  const typedFailureService = memoryService(
    typedFailureStorage,
    async (refreshToken) => {
      const unsafeText =
        `synthetic unsafe refresh detail ${COMPLETE_BUNDLE.accessToken} ${refreshToken}`;
      throw new XApiError("upstream-unavailable", unsafeText, {
        status: 503,
        retryAt: refreshToken,
        dispatched: true,
      });
    },
  );
  let typedFailure: unknown;
  try {
    await typedFailureService.forceRefresh(["tweet.read"]);
  } catch (error) {
    typedFailure = error;
  }
  if (!(typedFailure instanceof XApiError)) {
    assert.fail("a typed refresh failure remains a sanitized XApiError");
  }
  assert.equal(typedFailure.code, "upstream-unavailable");
  assert.equal(
    typedFailure.safeMessage === "X authorization could not be refreshed",
    true,
    "injected typed safeMessage is replaced with fixed copy",
  );
  assert.equal(
    typedFailure.message === "X authorization could not be refreshed",
    true,
    "injected typed message is replaced with fixed copy",
  );
  const outwardError = JSON.stringify({
    message: typedFailure.message,
    safeMessage: typedFailure.safeMessage,
    retryAt: typedFailure.retryAt,
  });
  assert.equal(
    outwardError.includes(COMPLETE_BUNDLE.accessToken)
      || outwardError.includes(COMPLETE_BUNDLE.refreshToken),
    false,
    "the outward error contains neither credential",
  );
  assert.equal(
    typedFailureStorage.raw === original,
    true,
    "typed refresh failure leaves the last complete bundle untouched",
  );
  assert.equal(typedFailureStorage.writes.length, 0);
}

// The refresh adapter receives only the credential it needs, never the access
// token, account identity, granted scopes, or complete bundle.
{
  const storage: MemoryStorage = {
    raw: JSON.stringify(cloneBundle()),
    writes: [],
    deletes: 0,
  };
  let refreshInput: unknown;
  let revision = 0;
  const service = createXCredentialService({
    getSecretSnapshot: () =>
      storage.raw === null
        ? null
        : {
          value: storage.raw,
          revision: `synthetic-narrow-revision-${revision}`,
        },
    setSecret: (value) => {
      storage.writes.push(value);
      storage.raw = value;
      revision += 1;
    },
    setSecretIfRevision: (expectedRevision, value) => {
      if (expectedRevision !== `synthetic-narrow-revision-${revision}`) {
        return false;
      }
      storage.writes.push(value);
      storage.raw = value;
      revision += 1;
      return true;
    },
    deleteSecret: () => {
      storage.raw = null;
    },
    refreshBundle: async (input) => {
      refreshInput = input;
      return {
        accessToken: "synthetic-test-access-token-narrow-refresh",
        expiresAt: "2026-07-27T21:00:00.000Z",
      } satisfies XTokenRefreshResult;
    },
    now: () => NOW,
  });
  await service.forceRefresh(["tweet.read"]);
  assert.equal(
    typeof refreshInput,
    "string",
    "the refresh dependency receives one token string, not a bundle",
  );
  assert.equal(
    refreshInput === COMPLETE_BUNDLE.refreshToken,
    true,
    "the narrow dependency receives the current refresh credential",
  );
}

// Refreshed custody commits through one opaque-revision CAS, never the ordinary
// set seam that replaceBundle uses.
{
  let raw = JSON.stringify(cloneBundle());
  let revision = "synthetic-opaque-revision-1";
  let ordinaryWrites = 0;
  let conditionalWrites = 0;
  const service = createXCredentialService({
    getSecretSnapshot: () => ({ value: raw, revision }),
    setSecret: (value) => {
      ordinaryWrites += 1;
      raw = value;
      revision = "synthetic-opaque-revision-ordinary";
    },
    setSecretIfRevision: (expectedRevision, value) => {
      conditionalWrites += 1;
      if (expectedRevision !== revision) return false;
      raw = value;
      revision = "synthetic-opaque-revision-cas";
      return true;
    },
    deleteSecret: () => {
      raw = "";
      revision = "synthetic-opaque-revision-deleted";
    },
    refreshBundle: async () => ({
      accessToken: "synthetic-test-access-token-cas",
      expiresAt: "2026-07-27T21:30:00.000Z",
    }),
    now: () => NOW,
  });
  await service.forceRefresh(["tweet.read"]);
  assert.equal(
    conditionalWrites,
    1,
    "refresh performs exactly one opaque-revision conditional set",
  );
  assert.equal(
    ordinaryWrites,
    0,
    "refresh never persists through the unconditional set seam",
  );
}

// Disconnect invalidates an active single-flight operation. A later bundle
// gets a new refresh operation, and completion of the old operation cannot
// restore deleted or superseded custody.
{
  const storage: MemoryStorage = {
    raw: JSON.stringify(cloneBundle()),
    writes: [],
    deletes: 0,
  };
  const resolvers: Array<(value: XTokenRefreshResult) => void> = [];
  let refreshCalls = 0;
  const service = memoryService(storage, async () => {
    refreshCalls += 1;
    return new Promise<XTokenRefreshResult>((resolve) => {
      resolvers.push(resolve);
    });
  });

  const staleRefresh = service.forceRefresh(["tweet.read"]);
  await Promise.resolve();
  assert.equal(refreshCalls, 1);
  service.disconnect();
  assert.equal(storage.raw, null, "disconnect removes credential custody");
  assert.equal(storage.deletes, 1);
  assert.deepEqual(service.getConnectionStatus(), { connected: false });

  service.replaceBundle(cloneBundle({
    ...COMPLETE_BUNDLE,
    accessToken: "synthetic-test-access-token-reconnected",
    refreshToken: "synthetic-test-refresh-token-reconnected",
  }));
  const currentRefresh = service.forceRefresh(["tweet.read"]);
  await Promise.resolve();
  assert.equal(refreshCalls, 2, "a post-disconnect caller never reuses the old promise");
  resolvers[1]({
    accessToken: "synthetic-test-access-token-current",
    refreshToken: "synthetic-test-refresh-token-current",
    expiresAt: "2026-07-27T16:00:00.000Z",
  });
  const currentToken = await currentRefresh;
  tokenMatches(
    currentToken,
    "synthetic-test-access-token-current",
    "the new refresh operation completes normally",
  );

  resolvers[0]({
    accessToken: "synthetic-test-access-token-stale",
    refreshToken: "synthetic-test-refresh-token-stale",
    expiresAt: "2026-07-27T17:00:00.000Z",
  });
  await assert.rejects(
    staleRefresh,
    (error: unknown) =>
      assertSafeError(error, "not-connected", "X account is not connected"),
    "a disconnected in-flight operation cannot resolve a stale token",
  );
  const current = storedBundle(storage);
  tokenMatches(
    current.accessToken,
    "synthetic-test-access-token-current",
    "a stale completion cannot overwrite current custody",
  );
}

// Separate service instances share the synchronous custody seam. A refresh
// may persist only if that custody still exactly matches its starting value.
{
  const deletedStorage: MemoryStorage = {
    raw: JSON.stringify(cloneBundle()),
    writes: [],
    deletes: 0,
  };
  let resolveDeletedRefresh!: (value: XTokenRefreshResult) => void;
  const deletedPending = new Promise<XTokenRefreshResult>((resolve) => {
    resolveDeletedRefresh = resolve;
  });
  const serviceA = memoryService(deletedStorage, async () => deletedPending);
  const serviceB = memoryService(deletedStorage, async () => {
    throw new Error("refresh should not run");
  });
  const deletedOutcome = serviceA.forceRefresh(["tweet.read"]).then(
    () => "resolved",
    (error: unknown) =>
      assertSafeError(error, "not-connected", "X account is not connected")
        ? "not-connected"
        : "other-error",
  );
  await Promise.resolve();
  serviceB.disconnect();
  assert.equal(deletedStorage.raw, null);
  resolveDeletedRefresh({
    accessToken: "synthetic-test-access-token-after-cross-delete",
    refreshToken: "synthetic-test-refresh-token-after-cross-delete",
    expiresAt: "2026-07-27T18:00:00.000Z",
  });
  assert.equal(
    await deletedOutcome,
    "not-connected",
    "another service's disconnect invalidates the stale refresh",
  );
  assert.equal(deletedStorage.raw, null, "stale refresh cannot resurrect custody");
  assert.equal(deletedStorage.writes.length, 0, "stale candidate is never written");

  const abaStartingRaw = JSON.stringify(cloneBundle());
  const abaStorage: MemoryStorage = {
    raw: abaStartingRaw,
    writes: [],
    deletes: 0,
  };
  let resolveAbaRefresh!: (value: XTokenRefreshResult) => void;
  const abaPending = new Promise<XTokenRefreshResult>((resolve) => {
    resolveAbaRefresh = resolve;
  });
  const abaServiceA = memoryService(abaStorage, async () => abaPending);
  const abaServiceB = memoryService(abaStorage, async () => {
    throw new Error("refresh should not run");
  });
  const abaOutcome = abaServiceA.forceRefresh(["tweet.read"]).then(
    () => "resolved",
    (error: unknown) =>
      assertSafeError(
        error,
        "upstream-unavailable",
        "X authorization could not be refreshed",
      )
        ? "upstream-unavailable"
        : "other-error",
  );
  await Promise.resolve();
  abaServiceB.disconnect();
  abaServiceB.replaceBundle(cloneBundle());
  assert.equal(
    abaStorage.raw === abaStartingRaw,
    true,
    "the post-disconnect replacement is byte-identical to initiating custody",
  );
  resolveAbaRefresh({
    accessToken: "synthetic-test-access-token-stale-aba",
    refreshToken: "synthetic-test-refresh-token-stale-aba",
    expiresAt: "2026-07-27T18:30:00.000Z",
  });
  assert.equal(
    await abaOutcome,
    "upstream-unavailable",
    "opaque revision CAS rejects a byte-identical ABA refresh",
  );
  assert.equal(
    abaStorage.raw === abaStartingRaw,
    true,
    "the stale ABA candidate cannot overwrite replacement custody",
  );
  assert.equal(
    abaStorage.writes.length,
    1,
    "only the post-disconnect replacement is written",
  );

  const replacedStorage: MemoryStorage = {
    raw: JSON.stringify(cloneBundle()),
    writes: [],
    deletes: 0,
  };
  let resolveReplacedRefresh!: (value: XTokenRefreshResult) => void;
  const replacedPending = new Promise<XTokenRefreshResult>((resolve) => {
    resolveReplacedRefresh = resolve;
  });
  const serviceC = memoryService(replacedStorage, async () => replacedPending);
  const serviceD = memoryService(replacedStorage, async () => {
    throw new Error("refresh should not run");
  });
  const replacedOutcome = serviceC.forceRefresh(["tweet.read"]).then(
    () => "resolved",
    (error: unknown) =>
      assertSafeError(
        error,
        "upstream-unavailable",
        "X authorization could not be refreshed",
      )
        ? "upstream-unavailable"
        : "other-error",
  );
  await Promise.resolve();
  const newerBundle = cloneBundle({
    ...COMPLETE_BUNDLE,
    accessToken: "synthetic-test-access-token-other-service",
    refreshToken: "synthetic-test-refresh-token-other-service",
    expiresAt: "2026-07-27T19:00:00.000Z",
  });
  serviceD.replaceBundle(newerBundle);
  const replacementRaw = replacedStorage.raw;
  resolveReplacedRefresh({
    accessToken: "synthetic-test-access-token-stale-cross-replace",
    refreshToken: "synthetic-test-refresh-token-stale-cross-replace",
    expiresAt: "2026-07-27T20:00:00.000Z",
  });
  assert.equal(
    await replacedOutcome,
    "upstream-unavailable",
    "another service's replacement invalidates the stale refresh",
  );
  assert.equal(
    replacedStorage.raw === replacementRaw,
    true,
    "stale refresh cannot overwrite a newer complete bundle",
  );
  assert.equal(
    replacedStorage.writes.length,
    1,
    "only the explicit replacement is written",
  );
  const retained = storedBundle(replacedStorage);
  tokenMatches(
    retained.accessToken,
    newerBundle.accessToken,
    "newer cross-service custody remains authoritative",
  );
}

// Storage faults stay fixed-copy and never trigger a destructive fallback.
{
  let readFallbackWrites = 0;
  let readFallbackDeletes = 0;
  let readFallbackRefreshes = 0;
  const readFailureService = createXCredentialService({
    getSecretSnapshot: () => {
      throw new Error("synthetic storage path detail");
    },
    setSecret: () => {
      readFallbackWrites += 1;
    },
    setSecretIfRevision: () => {
      readFallbackWrites += 1;
      return true;
    },
    deleteSecret: () => {
      readFallbackDeletes += 1;
    },
    refreshBundle: async () => {
      readFallbackRefreshes += 1;
      throw new Error("refresh should not run");
    },
    now: () => NOW,
  });
  assert.throws(
    () => readFailureService.getConnectionStatus(),
    (error: unknown) =>
      assertSafeError(
        error,
        "upstream-unavailable",
        "X credential storage is unavailable",
      ),
    "storage read failures use fixed safe copy",
  );
  assert.equal(readFallbackWrites, 0);
  assert.equal(readFallbackDeletes, 0);
  assert.equal(readFallbackRefreshes, 0);

  let writeFallbackDeletes = 0;
  const writeFailureService = createXCredentialService({
    getSecretSnapshot: () => null,
    setSecret: () => {
      throw new Error("synthetic storage path detail");
    },
    setSecretIfRevision: () => {
      throw new Error("synthetic storage path detail");
    },
    deleteSecret: () => {
      writeFallbackDeletes += 1;
    },
    refreshBundle: async () => {
      throw new Error("refresh should not run");
    },
    now: () => NOW,
  });
  assert.throws(
    () => writeFailureService.replaceBundle(cloneBundle()),
    (error: unknown) =>
      assertSafeError(
        error,
        "upstream-unavailable",
        "X credential storage is unavailable",
      ),
    "storage write failures use fixed safe copy",
  );
  assert.equal(writeFallbackDeletes, 0, "write failure never deletes custody");

  let conditionalFallbackWrites = 0;
  const conditionalFailureService = createXCredentialService({
    getSecretSnapshot: () => ({
      value: JSON.stringify(cloneBundle()),
      revision: "synthetic-conditional-failure-revision",
    }),
    setSecret: () => {
      conditionalFallbackWrites += 1;
    },
    setSecretIfRevision: () => {
      throw new Error("synthetic storage path detail");
    },
    deleteSecret: () => undefined,
    refreshBundle: async () => ({
      accessToken: "synthetic-test-access-token-storage-failure",
      expiresAt: "2026-07-27T22:00:00.000Z",
    }),
    now: () => NOW,
  });
  await assert.rejects(
    conditionalFailureService.forceRefresh(["tweet.read"]),
    (error: unknown) =>
      assertSafeError(
        error,
        "upstream-unavailable",
        "X credential storage is unavailable",
      ),
    "conditional storage failures use fixed safe copy",
  );
  assert.equal(
    conditionalFallbackWrites,
    0,
    "conditional failure never falls back to ordinary set",
  );

  let deleteFallbackWrites = 0;
  const deleteFailureService = createXCredentialService({
    getSecretSnapshot: () => ({
      value: JSON.stringify(cloneBundle()),
      revision: "synthetic-delete-failure-revision",
    }),
    setSecret: () => {
      deleteFallbackWrites += 1;
    },
    setSecretIfRevision: () => {
      deleteFallbackWrites += 1;
      return true;
    },
    deleteSecret: () => {
      throw new Error("synthetic storage path detail");
    },
    refreshBundle: async () => {
      throw new Error("refresh should not run");
    },
    now: () => NOW,
  });
  assert.throws(
    () => deleteFailureService.disconnect(),
    (error: unknown) =>
      assertSafeError(
        error,
        "upstream-unavailable",
        "X credential storage is unavailable",
      ),
    "storage delete failures use fixed safe copy",
  );
  assert.equal(deleteFallbackWrites, 0, "delete failure never rewrites custody");
}

// Production custody uses the real encrypted local vault key and file seams.
{
  xCredentialService.replaceBundle(cloneBundle());
  const rawVault = await readFile(vaultFile, "utf8");
  const encryptedStore = JSON.parse(rawVault) as {
    secrets?: Record<string, unknown>;
  };
  assert.equal(
    Object.hasOwn(encryptedStore.secrets ?? {}, X_OAUTH_TOKEN_BUNDLE_KEY),
    true,
    "the production service stores under X_OAUTH_TOKEN_BUNDLE",
  );
  assert.equal(
    rawVault.includes(COMPLETE_BUNDLE.accessToken)
      || rawVault.includes(COMPLETE_BUNDLE.refreshToken),
    false,
    "the vault file contains neither plaintext token",
  );

  const decrypted = getLocalEncryptedSecret(X_OAUTH_TOKEN_BUNDLE_KEY);
  assert.ok(decrypted, "the real vault can decrypt the stored bundle");
  const parsed = JSON.parse(decrypted) as XTokenBundle;
  tokenMatches(
    parsed.accessToken,
    COMPLETE_BUNDLE.accessToken,
    "production custody stores the complete access token",
  );
  tokenMatches(
    parsed.refreshToken,
    COMPLETE_BUNDLE.refreshToken,
    "production custody stores the complete refresh token",
  );
  const status = xCredentialService.getConnectionStatus();
  assert.equal(status.connected, true);
  assert.equal(
    JSON.stringify(status).includes(COMPLETE_BUNDLE.accessToken)
      || JSON.stringify(status).includes(COMPLETE_BUNDLE.refreshToken),
    false,
  );

  await assert.rejects(
    xCredentialService.forceRefresh(["tweet.read"]),
    (error: unknown) =>
      assertSafeError(
        error,
        "upstream-unavailable",
        "X authorization could not be refreshed",
      ),
    "the production placeholder fails safely without a network call",
  );
  xCredentialService.disconnect();
  assert.equal(getLocalEncryptedSecret(X_OAUTH_TOKEN_BUNDLE_KEY), null);
}

console.log("x-credentials.test.ts: ok");
} finally {
  if (priorVaultFile === undefined) {
    delete process.env.COVEN_CAVE_LOCAL_VAULT_FILE;
  } else {
    process.env.COVEN_CAVE_LOCAL_VAULT_FILE = priorVaultFile;
  }
  if (priorVaultKeyFile === undefined) {
    delete process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE;
  } else {
    process.env.COVEN_CAVE_LOCAL_VAULT_KEY_FILE = priorVaultKeyFile;
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
