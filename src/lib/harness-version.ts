// Extract the first line of a version-probe's output that actually looks like
// a version, skipping leading log/warning noise.
//
// Some harnesses print log lines (e.g. OpenCode's
// `2026/07/12 11:01:30 WARN FZF not found in $PATH...`) to stdout/stderr
// *before* their version string. Naively taking the first output line would
// surface that noise as the "version". This skips obvious log lines and
// returns the first line that looks like a version (contains a digit), falling
// back to the first non-noise line so we never regress to null when a tool
// reports an unusual-but-valid version format.
export function pickVersionLine(raw: string): string | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  // A leading log line typically starts with a timestamp and/or a level token
  // like WARN/INFO/ERROR/DEBUG/TRACE, or is bracketed like [warn].
  const isLogNoise = (l: string): boolean =>
    /^\d{4}[/-]\d{2}[/-]\d{2}[ tT]/.test(l) ||
    /^\[?(warn|warning|info|error|debug|trace|notice)\b/i.test(l);
  const looksLikeVersion = (l: string): boolean => /\d/.test(l);
  const firstSignal = lines.find((l) => !isLogNoise(l) && looksLikeVersion(l));
  if (firstSignal) return firstSignal;
  const firstNonNoise = lines.find((l) => !isLogNoise(l));
  return firstNonNoise ?? lines[0] ?? null;
}
