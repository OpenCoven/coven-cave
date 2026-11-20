/** Core GitHub object identity validation, independent of Research views. */
export const GITHUB_OBJECT_SHA_PATTERN = /^[a-f0-9]{40}$/;

export function sanitizeGithubObjectSha(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return GITHUB_OBJECT_SHA_PATTERN.test(normalized) ? normalized : null;
}
