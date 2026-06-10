import { signMobileAccessToken } from "./mobile-access-token.ts";

export const MOBILE_INVITE_TTL_MS = 10 * 60 * 1000;

type TailscaleServeStatus = {
  Web?: Record<
    string,
    {
      Handlers?: Record<
        string,
        {
          Proxy?: string;
        }
      >;
    }
  >;
};

function normalizeServeHost(host: string) {
  return host.endsWith(":443") ? host.slice(0, -4) : host;
}

export function findServeUrl(status: unknown, backendUrl: string) {
  const web = (status as TailscaleServeStatus | null)?.Web;
  if (!web || typeof web !== "object") return null;

  for (const [host, config] of Object.entries(web)) {
    const handlers = config?.Handlers;
    if (!handlers || typeof handlers !== "object") continue;
    for (const [path, handler] of Object.entries(handlers)) {
      if (handler?.Proxy !== backendUrl) continue;
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const suffix = normalizedPath === "/" ? "/" : normalizedPath;
      return `https://${normalizeServeHost(host)}${suffix}`;
    }
  }

  return null;
}

export function buildInviteUrl({
  baseUrl,
  mobileAccessToken,
  sidecarToken,
}: {
  baseUrl: string;
  mobileAccessToken: string;
  sidecarToken?: string | null;
}) {
  const url = new URL(baseUrl);
  url.searchParams.set("coven_access_token", mobileAccessToken);
  if (sidecarToken) url.searchParams.set("covenCaveToken", sidecarToken);
  return url.toString();
}

export async function createMobileInvite({
  baseUrl,
  accessSecret,
  sidecarToken,
  ttlMs = MOBILE_INVITE_TTL_MS,
  now = Date.now(),
  nonce,
}: {
  baseUrl: string;
  accessSecret: string;
  sidecarToken?: string | null;
  ttlMs?: number;
  now?: number;
  nonce?: string;
}) {
  const expiresAt = now + ttlMs;
  const mobileAccessToken = await signMobileAccessToken({
    secret: accessSecret,
    expiresAt,
    nonce,
  });
  return {
    expiresAt,
    expiresAtIso: new Date(expiresAt).toISOString(),
    url: buildInviteUrl({ baseUrl, mobileAccessToken, sidecarToken }),
  };
}
