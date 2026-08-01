import { NextResponse } from "next/server.js";
import { loadConfig, type CaveConfig } from "../cave-config.ts";
import { XApiError, xErrorHttpStatus, type XScope } from "../x-api.ts";
import { isValidFamiliarId } from "./familiar-id.ts";
import {
  xCredentialService,
  type XCredentialService,
} from "./x-credentials.ts";
import { sweepExpiredXCache } from "./x-sources.ts";

export type XCapability = "research" | "publish";

type XAccessConfig = Pick<CaveConfig, "familiars">;
type XAccessCredentials = Pick<
  XCredentialService,
  "getAccessToken" | "forceRefresh"
>;

export type XAccessDependencies = {
  loadConfig(): Promise<XAccessConfig>;
  credentials: XAccessCredentials;
  sweepExpiredCache?(): Promise<unknown>;
};

export type XAccess = {
  requireXCapability(
    familiarId: string,
    capability: XCapability,
  ): Promise<void>;
  withXAuthenticatedRead<T>(
    familiarId: string,
    requiredScopes: XScope[],
    operation: (accessToken: string) => Promise<T>,
  ): Promise<T>;
  withXWritePreflight<T>(
    familiarId: string,
    requiredScopes: XScope[],
    operation: (accessToken: string) => Promise<T>,
  ): Promise<T>;
  toXErrorResponse(error: unknown): NextResponse;
};

const WRITE_REFRESH_WINDOW_MS = 5 * 60 * 1000;

function invalidFamiliarId(): XApiError {
  return new XApiError("invalid-request", "Familiar id is invalid");
}

function capabilityDisabled(capability: XCapability): XApiError {
  return new XApiError(
    "capability-disabled",
    `Enable X ${capability === "research" ? "research" : "publishing"} for this familiar`,
  );
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof XApiError
    && (error.code === "unauthorized" || error.status === 401);
}

export function createXAccess(dependencies: XAccessDependencies): XAccess {
  async function requireXCapability(
    familiarId: string,
    capability: XCapability,
  ): Promise<void> {
    if (!isValidFamiliarId(familiarId)) throw invalidFamiliarId();
    await dependencies.sweepExpiredCache?.();
    const config = await dependencies.loadConfig();
    const entry = config.familiars[familiarId];
    const granted = capability === "research"
      ? entry?.xResearchEnabled === true
      : entry?.xPublishEnabled === true;
    if (!granted) throw capabilityDisabled(capability);
  }

  async function withXAuthenticatedRead<T>(
    familiarId: string,
    requiredScopes: XScope[],
    operation: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    await requireXCapability(familiarId, "research");
    const accessToken = await dependencies.credentials.getAccessToken(requiredScopes);
    try {
      return await operation(accessToken);
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
    }
    const refreshedToken = await dependencies.credentials.forceRefresh(requiredScopes);
    return operation(refreshedToken);
  }

  async function withXWritePreflight<T>(
    familiarId: string,
    requiredScopes: XScope[],
    operation: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    await requireXCapability(familiarId, "publish");
    const accessToken = await dependencies.credentials.getAccessToken(
      requiredScopes,
      { refreshIfExpiringWithinMs: WRITE_REFRESH_WINDOW_MS },
    );
    return operation(accessToken);
  }

  function toXErrorResponse(error: unknown): NextResponse {
    if (error instanceof XApiError) {
      return NextResponse.json(
        {
          ok: false,
          code: error.code,
          error: error.safeMessage,
          ...(error.retryAt ? { retryAt: error.retryAt } : {}),
        },
        { status: xErrorHttpStatus(error.code) },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: "internal",
        error: "X request could not be completed",
      },
      { status: 500 },
    );
  }

  return {
    requireXCapability,
    withXAuthenticatedRead,
    withXWritePreflight,
    toXErrorResponse,
  };
}

const xAccess = createXAccess({
  loadConfig,
  credentials: xCredentialService,
  sweepExpiredCache: sweepExpiredXCache,
});

export const requireXCapability = xAccess.requireXCapability;
export const withXAuthenticatedRead = xAccess.withXAuthenticatedRead;
export const withXWritePreflight = xAccess.withXWritePreflight;
export const toXErrorResponse = xAccess.toXErrorResponse;
