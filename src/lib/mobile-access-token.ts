export const MOBILE_ACCESS_TOKEN_ENV = "COVEN_MOBILE_ACCESS_TOKEN";
export const MOBILE_ACCESS_TOKEN_QUERY = "coven_mobile_token";
export const MOBILE_ACCESS_TOKEN_COOKIE = "coven_mobile_token";
export const MOBILE_ACCESS_TOKEN_HEADER = "x-coven-mobile-token";

export function mobileAccessToken(): string {
  return process.env[MOBILE_ACCESS_TOKEN_ENV]?.trim() ?? "";
}

export function tokensMatch(expected: string, actual: string | null | undefined): boolean {
  if (!expected || !actual || expected.length !== actual.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0;
}

export function bearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
