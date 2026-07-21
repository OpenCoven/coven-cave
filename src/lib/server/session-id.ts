// Daemons issue more than UUIDs: Hermes uses timestamp-prefixed IDs such as
// `20260721_192314_1d8d4e`. Keep the same conservative grammar used by local
// session management: no separators, whitespace, or URI syntax.
const SESSION_ID_RE = /^[A-Za-z0-9:._-]{1,256}$/;

export function isValidSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}
