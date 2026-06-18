// Detecting inline file references in chat prose (e.g. `src/foo.ts` or
// `lib/bar.py:42`) so they can be linkified to open in the Code workspace.
// Pure + JSX-free so it's unit-testable without a DOM or the bubble renderer.

/**
 * A file path ending in a known code/config extension, with an optional
 * `:line` or `:line:col` suffix. Anchored so it only matches when the whole
 * (inline-code) token is a reference — prose like `npm install`, `e.g.`, or
 * `foo()` never matches.
 */
export const FILE_REF_RE =
  /^([/\w@][\w./@+-]*\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|sass|html|py|rs|go|rb|java|c|h|cpp|hpp|cc|sh|bash|zsh|yaml|yml|toml|sql|swift|kt|lua|php|xml|svg|nix|txt|lock|cfg|ini|conf))(?::(\d+))?(?::\d+)?$/;

export type FileRef = { path: string; line?: number };

/** Parse a trimmed token into a file reference, or null if it isn't one. */
export function parseFileRef(text: string): FileRef | null {
  const match = FILE_REF_RE.exec(text.trim());
  if (!match) return null;
  return { path: match[1], line: match[2] ? Number(match[2]) : undefined };
}
