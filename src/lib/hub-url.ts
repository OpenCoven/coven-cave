function isLoopbackHubHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function normalizeHubUrl(rawUrl: string): string {
  const whitespaceTrimmed = rawUrl.trim();
  let end = whitespaceTrimmed.length;
  while (end > 0 && whitespaceTrimmed[end - 1] === "/") end -= 1;
  const trimmed = whitespaceTrimmed.slice(0, end);
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function isSecureHubCredentialTransport(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopbackHubHostname(url.hostname));
  } catch {
    return false;
  }
}
