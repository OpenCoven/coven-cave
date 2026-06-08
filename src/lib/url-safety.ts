const SAFE_URL_PROTOCOLS = new Set(["http:", "https:"]);
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

export function parseSafeHttpUrl(value: string | undefined | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return SAFE_URL_PROTOCOLS.has(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function isSafeHttpUrl(value: string | undefined | null): boolean {
  return parseSafeHttpUrl(value) !== null;
}

export function parseSafeGitHubUrl(value: string | undefined | null): URL | null {
  const url = parseSafeHttpUrl(value);
  if (!url) return null;
  return GITHUB_HOSTS.has(url.hostname.toLowerCase()) ? url : null;
}

export function isSafeGitHubUrl(value: string | undefined | null): boolean {
  return parseSafeGitHubUrl(value) !== null;
}
