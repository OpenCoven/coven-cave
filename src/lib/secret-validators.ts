/**
 * Pluggable secret validators for Marketplace credential collection. Keyed by
 * env var. Each validator takes the resolved secret value and an injectable
 * fetch (so it's unit-testable without the network) and returns pass/fail +
 * an optional detail. The secret value is never logged or returned.
 */

import { upstreamFetch } from "./server/upstream-fetch.ts";
import { userLogin } from "./server/upstream-answer.ts";

export type SecretValidation = { ok: boolean; login?: string; error?: string };
type FetchLike = typeof fetch;
type Validator = (value: string, fetchImpl: FetchLike) => Promise<SecretValidation>;

export async function validateGithubToken(value: string, fetchImpl: FetchLike): Promise<SecretValidation> {
  try {
    const res = await upstreamFetch("github", "https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${value}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    }, { fetchImpl });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "token rejected by GitHub" };
    if (!res.ok) return { ok: false, error: `GitHub API error (${res.status})` };
    const data = await res.json().catch(() => null);
    // A 200 that names no account hasn't verified this token, and it isn't a
    // rejection either: the error says so, and checking again can succeed.
    const login = userLogin(data);
    if (login === null) return { ok: false, error: "GitHub answered without identifying the token's account" };
    return { ok: true, login };
  } catch {
    return { ok: false, error: "could not reach GitHub" };
  }
}

const VALIDATORS: Record<string, Validator> = {
  GITHUB_PAT: validateGithubToken,
};

export function hasValidator(env: string): boolean {
  return Object.prototype.hasOwnProperty.call(VALIDATORS, env);
}

/** Run the registered validator for `env`; defaults fetchImpl to global fetch. */
export async function validateSecret(
  env: string,
  value: string,
  fetchImpl: FetchLike = fetch,
): Promise<SecretValidation> {
  const validator = VALIDATORS[env];
  if (!validator) return { ok: false, error: "no validator for this field" };
  return validator(value, fetchImpl);
}
