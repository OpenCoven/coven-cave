/**
 * JavaScript strings may contain isolated UTF-16 surrogate code units even
 * though those values are not valid Unicode scalar values. Windows process
 * launch and UTF-8 JSON/filesystem boundaries replace them with U+FFFD, which
 * would silently change a Research instruction after validation. Reject that
 * lossy shape before it crosses either boundary.
 */
export function hasUnpairedUtf16Surrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}
