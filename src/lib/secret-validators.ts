/**
 * Pluggable secret validators for Marketplace credential collection. Keyed by
 * env var. Each validator takes the resolved secret value and an injectable
 * fetch (so it's unit-testable without the network) and returns pass/fail +
 * an optional detail. The secret value is never logged or returned.
 */

export type SecretValidation = { ok: boolean; login?: string; error?: string };
type FetchLike = typeof fetch;
type Validator = (value: string, fetchImpl: FetchLike) => Promise<SecretValidation>;

export async function validateGithubToken(value: string, fetchImpl: FetchLike): Promise<SecretValidation> {
  try {
    const res = await fetchImpl("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${value}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "token rejected by GitHub" };
    if (!res.ok) return { ok: false, error: `GitHub API error (${res.status})` };
    const data = await res.json().catch(() => null);
    return { ok: true, login: data?.login ?? undefined };
  } catch {
    return { ok: false, error: "could not reach GitHub" };
  }
}

const VALIDATORS: Record<string, Validator> = {
  GITHUB_PERSONAL_ACCESS_TOKEN: validateGithubToken,
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
