const NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const PRERELEASE_IDENTIFIER =
  `(?:${NUMERIC_IDENTIFIER}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const EXACT_SEMVER = new RegExp(
  `^v?(` +
    `${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}` +
    `(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?` +
    `(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?` +
    `)$`,
);

const MAX_SEMVER_LENGTH = 128;

/** Normalize one exact SemVer value while rejecting prose, paths, and opaque tokens. */
export function exactSemver(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SEMVER_LENGTH) return null;
  return EXACT_SEMVER.exec(normalized)?.[1] ?? null;
}
