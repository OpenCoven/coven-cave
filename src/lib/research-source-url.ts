/**
 * Client-side gate for the evidence ledger's Attach source form: only http(s)
 * URLs may be submitted as web sources. Mirrors the server's normalizeWebUrl
 * scheme check (research-artifact-contract.ts) so a typo'd or hostile scheme
 * (ftp:, file:, javascript:, mailto:, data:, …) is refused before it ever
 * reaches an action round-trip.
 *
 * The regex requires an explicit http:// or https:// scheme (case-insensitive,
 * like the URL parser the server uses) followed by a host segment. A bare
 * "example.com" without a scheme, or "https://" with nothing after the scheme,
 * is rejected. Trailing whitespace is tolerated because the form trims input
 * before it is stored.
 */
export const RESEARCH_SOURCE_URL_RE = /^https?:\/\/[^\s/?#]+(?:[/?#]|$)/i;

export function isValidResearchSourceUrl(value: string): boolean {
  return RESEARCH_SOURCE_URL_RE.test(value.trim());
}
