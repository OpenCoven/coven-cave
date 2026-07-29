import {
  deleteLocalEncryptedSecret,
  getLocalEncryptedSecret,
  setLocalEncryptedSecret,
} from "../local-encrypted-vault.ts";
import { XApiError, type XScope } from "../x-api.ts";
import { refreshXToken } from "./x-client.ts";

export const X_OAUTH_TOKEN_BUNDLE_KEY = "X_OAUTH_TOKEN_BUNDLE";

const DEFAULT_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const X_SCOPES = new Set<XScope>([
  "tweet.read",
  "users.read",
  "offline.access",
  "tweet.write",
]);
const BUNDLE_KEYS = [
  "accessToken",
  "refreshToken",
  "expiresAt",
  "scopes",
  "account",
] as const;
const ACCOUNT_KEYS = ["id", "username", "name"] as const;
const REFRESH_RESULT_KEYS = [
  "accessToken",
  "refreshToken",
  "expiresAt",
  "scopes",
  "account",
] as const;

type XAccountIdentity = {
  id: string;
  username: string;
  name: string;
};

export type XTokenBundle = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: XScope[];
  account: XAccountIdentity;
};

/**
 * Task 4's refresh client adapts its response to this boundary. X always needs
 * to return a new access token and expiry. A rotated refresh token, changed
 * scopes, or changed account identity replaces the corresponding stored field;
 * omitted optional fields mean that validated current field is unchanged.
 */
export type XTokenRefreshResult = {
  accessToken: string;
  expiresAt: string;
  refreshToken?: string;
  scopes?: XScope[];
  account?: XAccountIdentity;
};

export type XConnectionStatus =
  | { connected: false }
  | {
    connected: true;
    expiresAt: string;
    scopes: XScope[];
    account: XAccountIdentity;
  };

export type XCredentialService = {
  getConnectionStatus(): XConnectionStatus;
  replaceBundle(bundle: XTokenBundle): void;
  getAccessToken(
    requiredScopes: XScope[],
    options?: { refreshIfExpiringWithinMs?: number },
  ): Promise<string>;
  forceRefresh(requiredScopes: XScope[]): Promise<string>;
  disconnect(): void;
};

export type XCredentialServiceDependencies = {
  getSecret?(): string | null;
  getSecretSnapshot?(): XCredentialStorageSnapshot | null;
  setSecret(value: string): void;
  setSecretIfRevision?(expectedRevision: string, value: string): boolean;
  deleteSecret(): void;
  refreshBundle(refreshToken: string): Promise<unknown>;
  now?: () => number;
};

type UnknownRecord = Record<string, unknown>;

export type XCredentialStorageSnapshot = {
  value: string;
  revision: string;
};

function invalidCredentialData(): XApiError {
  return new XApiError("invalid-response", "X credential data is invalid");
}

function invalidCredentialRequest(): XApiError {
  return new XApiError("invalid-request", "X credential request is invalid");
}

function notConnected(): XApiError {
  return new XApiError("not-connected", "X account is not connected");
}

function missingScope(): XApiError {
  return new XApiError(
    "missing-scope",
    "X account is missing a required permission",
  );
}

function storageUnavailable(): XApiError {
  return new XApiError(
    "upstream-unavailable",
    "X credential storage is unavailable",
  );
}

function refreshUnavailable(): XApiError {
  return new XApiError(
    "upstream-unavailable",
    "X authorization could not be refreshed",
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: UnknownRecord,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function hasOnlyKeys(
  value: UnknownRecord,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isStrictNonemptyString(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value;
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function parseScopes(value: unknown): XScope[] | null {
  if (!Array.isArray(value)) return null;
  const scopes: XScope[] = [];
  const seen = new Set<XScope>();
  for (const scope of value) {
    if (typeof scope !== "string" || !X_SCOPES.has(scope as XScope)) {
      return null;
    }
    const typedScope = scope as XScope;
    if (seen.has(typedScope)) return null;
    seen.add(typedScope);
    scopes.push(typedScope);
  }
  return scopes;
}

function parseAccount(value: unknown): XAccountIdentity | null {
  if (!isRecord(value) || !hasExactKeys(value, ACCOUNT_KEYS)) return null;
  if (
    !isStrictNonemptyString(value.id)
    || !isStrictNonemptyString(value.username)
    || !isStrictNonemptyString(value.name)
  ) {
    return null;
  }
  return {
    id: value.id,
    username: value.username,
    name: value.name,
  };
}

function parseBundle(value: unknown): XTokenBundle | null {
  if (!isRecord(value) || !hasExactKeys(value, BUNDLE_KEYS)) return null;
  if (
    !isStrictNonemptyString(value.accessToken)
    || !isStrictNonemptyString(value.refreshToken)
    || !isCanonicalIsoDate(value.expiresAt)
  ) {
    return null;
  }
  const scopes = parseScopes(value.scopes);
  const account = parseAccount(value.account);
  if (!scopes || !account) return null;
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresAt: value.expiresAt,
    scopes,
    account,
  };
}

function parseRefreshResult(
  value: unknown,
  current: XTokenBundle,
): XTokenBundle | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, REFRESH_RESULT_KEYS)
    || !Object.hasOwn(value, "accessToken")
    || !Object.hasOwn(value, "expiresAt")
    || !isStrictNonemptyString(value.accessToken)
    || !isCanonicalIsoDate(value.expiresAt)
  ) {
    return null;
  }

  let refreshToken = current.refreshToken;
  if (Object.hasOwn(value, "refreshToken")) {
    if (!isStrictNonemptyString(value.refreshToken)) return null;
    refreshToken = value.refreshToken;
  }

  let scopes = [...current.scopes];
  if (Object.hasOwn(value, "scopes")) {
    const parsedScopes = parseScopes(value.scopes);
    if (!parsedScopes) return null;
    scopes = parsedScopes;
  }

  let account = { ...current.account };
  if (Object.hasOwn(value, "account")) {
    const parsedAccount = parseAccount(value.account);
    if (!parsedAccount) return null;
    account = parsedAccount;
  }

  return parseBundle({
    accessToken: value.accessToken,
    refreshToken,
    expiresAt: value.expiresAt,
    scopes,
    account,
  });
}

function parseRequiredScopes(requiredScopes: unknown): XScope[] {
  if (!Array.isArray(requiredScopes) || requiredScopes.length === 0) {
    throw invalidCredentialRequest();
  }
  const parsed: XScope[] = [];
  const seen = new Set<XScope>();
  for (const scope of requiredScopes) {
    if (typeof scope !== "string" || !X_SCOPES.has(scope as XScope)) {
      throw invalidCredentialRequest();
    }
    const typedScope = scope as XScope;
    if (!seen.has(typedScope)) {
      seen.add(typedScope);
      parsed.push(typedScope);
    }
  }
  return parsed;
}

function parseRefreshWindow(options: unknown): number {
  if (options === undefined) return DEFAULT_REFRESH_WINDOW_MS;
  if (!isRecord(options)) throw invalidCredentialRequest();
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidCredentialRequest();
  }
  const keys = Reflect.ownKeys(options);
  if (
    keys.length > 1
    || (keys.length === 1 && keys[0] !== "refreshIfExpiringWithinMs")
  ) {
    throw invalidCredentialRequest();
  }
  if (keys.length === 0) return DEFAULT_REFRESH_WINDOW_MS;
  const refreshWindow = options.refreshIfExpiringWithinMs;
  if (
    typeof refreshWindow !== "number"
    || !Number.isFinite(refreshWindow)
    || refreshWindow < 0
  ) {
    throw invalidCredentialRequest();
  }
  return refreshWindow;
}

function requireGrantedScopes(
  bundle: XTokenBundle,
  requiredScopes: readonly XScope[],
): void {
  const granted = new Set(bundle.scopes);
  if (requiredScopes.some((scope) => !granted.has(scope))) {
    throw missingScope();
  }
}

type XCredentialReadSnapshot = {
  value: string;
  revision: string | null;
};

export function createXCredentialService(
  dependencies: XCredentialServiceDependencies,
): XCredentialService {
  const now = dependencies.now ?? Date.now;
  let generation = 0;
  let inFlight:
    | { generation: number; promise: Promise<XTokenBundle> }
    | null = null;

  function getStoredSnapshot(): XCredentialReadSnapshot | null {
    try {
      if (dependencies.getSecret) {
        const value = dependencies.getSecret();
        return value === null ? null : { value, revision: null };
      }
      if (dependencies.getSecretSnapshot) {
        return dependencies.getSecretSnapshot();
      }
      throw new Error("X credential storage getter is required");
    } catch {
      throw storageUnavailable();
    }
  }

  function parseStoredBundle(raw: string): XTokenBundle | null {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
    return parseBundle(decoded);
  }

  function readBundle(): {
    revision: string | null;
    bundle: XTokenBundle;
  } | null {
    const snapshot = getStoredSnapshot();
    if (!snapshot) return null;
    const bundle = parseStoredBundle(snapshot.value);
    return bundle ? { revision: snapshot.revision, bundle } : null;
  }

  function writeBundle(bundle: XTokenBundle): void {
    try {
      dependencies.setSecret(JSON.stringify(bundle));
    } catch {
      throw storageUnavailable();
    }
  }

  function writeBundleIfRevision(
    expectedRevision: string | null,
    bundle: XTokenBundle,
  ): boolean {
    if (expectedRevision === null || !dependencies.setSecretIfRevision) {
      writeBundle(bundle);
      return true;
    }
    try {
      return dependencies.setSecretIfRevision(
        expectedRevision,
        JSON.stringify(bundle),
      );
    } catch {
      throw storageUnavailable();
    }
  }

  function refresh(
    current: XTokenBundle,
    startingRevision: string | null,
  ): Promise<XTokenBundle> {
    if (inFlight) return inFlight.promise;

    const refreshGeneration = generation;
    const promise = (async () => {
      let result: unknown;
      try {
        result = await dependencies.refreshBundle(current.refreshToken);
      } catch {
        throw refreshUnavailable();
      }

      const refreshed = parseRefreshResult(result, current);
      if (!refreshed) throw invalidCredentialData();
      const refreshedAt = now();
      if (
        !Number.isFinite(refreshedAt)
        || Date.parse(refreshed.expiresAt) <= refreshedAt
      ) {
        throw invalidCredentialData();
      }
      if (generation !== refreshGeneration) throw notConnected();
      if (!writeBundleIfRevision(startingRevision, refreshed)) {
        if (!getStoredSnapshot()) throw notConnected();
        throw refreshUnavailable();
      }
      return refreshed;
    })();

    inFlight = { generation: refreshGeneration, promise };
    void promise.then(
      () => {
        if (inFlight?.promise === promise) inFlight = null;
      },
      () => {
        if (inFlight?.promise === promise) inFlight = null;
      },
    );
    return promise;
  }

  function currentBundle(requiredScopes: unknown): {
    bundle: XTokenBundle;
    revision: string | null;
    required: XScope[];
  } {
    const required = parseRequiredScopes(requiredScopes);
    const stored = readBundle();
    if (!stored) throw notConnected();
    requireGrantedScopes(stored.bundle, required);
    return { ...stored, required };
  }

  return {
    getConnectionStatus(): XConnectionStatus {
      const stored = readBundle();
      if (!stored) return { connected: false };
      const { bundle } = stored;
      return {
        connected: true,
        expiresAt: bundle.expiresAt,
        scopes: [...bundle.scopes],
        account: { ...bundle.account },
      };
    },

    replaceBundle(bundle: XTokenBundle): void {
      const validated = parseBundle(bundle);
      if (!validated) throw invalidCredentialData();
      writeBundle(validated);
      generation += 1;
      inFlight = null;
    },

    async getAccessToken(
      requiredScopes: XScope[],
      options?: { refreshIfExpiringWithinMs?: number },
    ): Promise<string> {
      const refreshWindow = parseRefreshWindow(options);
      const { bundle, revision, required } = currentBundle(requiredScopes);
      const currentTime = now();
      if (!Number.isFinite(currentTime)) throw invalidCredentialData();
      if (Date.parse(bundle.expiresAt) - currentTime > refreshWindow) {
        return bundle.accessToken;
      }
      const refreshed = await refresh(bundle, revision);
      requireGrantedScopes(refreshed, required);
      return refreshed.accessToken;
    },

    async forceRefresh(requiredScopes: XScope[]): Promise<string> {
      const { bundle, revision, required } = currentBundle(requiredScopes);
      const refreshed = await refresh(bundle, revision);
      requireGrantedScopes(refreshed, required);
      return refreshed.accessToken;
    },

    disconnect(): void {
      generation += 1;
      inFlight = null;
      try {
        dependencies.deleteSecret();
      } catch {
        throw storageUnavailable();
      }
    },
  };
}

export const xCredentialService: XCredentialService =
  createXCredentialService({
    getSecret: () => getLocalEncryptedSecret(X_OAUTH_TOKEN_BUNDLE_KEY),
    setSecret: (value) =>
      setLocalEncryptedSecret(X_OAUTH_TOKEN_BUNDLE_KEY, value),
    deleteSecret: () =>
      deleteLocalEncryptedSecret(X_OAUTH_TOKEN_BUNDLE_KEY),
    refreshBundle: (refreshToken) => refreshXToken({ refreshToken }),
  });
