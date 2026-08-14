import { XApiError, type XScope } from "../x-api.ts";

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_API_BASE_URL = "https://api.x.com/2";
export const X_OAUTH_REDIRECT_URI = "http://127.0.0.1:1456/x/oauth/callback";
export const X_OAUTH_CALLBACK_PORT = 1456;

export const X_RESEARCH_SCOPES = Object.freeze([
  "tweet.read",
  "users.read",
  "offline.access",
] as const) satisfies readonly XScope[];
export const X_PUBLISH_SCOPES = Object.freeze([
  "tweet.read",
  "users.read",
  "offline.access",
  "tweet.write",
] as const) satisfies readonly XScope[];

const X_PACKAGED_PRODUCTION_CLIENT_ID = process.env.COVEN_CAVE_X_PRODUCTION_CLIENT_ID?.trim() ?? "";

type XClientIdEnvironment = Record<string, string | undefined>;

function trimmedEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** Resolves an explicit environment without consulting ambient process state. */
export function resolveXClientId(env: XClientIdEnvironment): string {
  const clientId = trimmedEnvValue(env.COVEN_CAVE_X_CLIENT_ID)
    ?? trimmedEnvValue(env.COVEN_CAVE_X_PRODUCTION_CLIENT_ID);
  if (!clientId) {
    throw new XApiError("not-configured", "OpenCoven X app configuration is unavailable");
  }
  return clientId;
}

/** Resolves the production app ID using the direct build-captured fallback. */
export function getXClientId(runtimeEnv: XClientIdEnvironment = process.env): string {
  return resolveXClientId({
    COVEN_CAVE_X_CLIENT_ID: runtimeEnv.COVEN_CAVE_X_CLIENT_ID,
    COVEN_CAVE_X_PRODUCTION_CLIENT_ID:
      X_PACKAGED_PRODUCTION_CLIENT_ID || runtimeEnv.COVEN_CAVE_X_PRODUCTION_CLIENT_ID,
  });
}
