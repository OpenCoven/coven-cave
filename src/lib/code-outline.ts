/**
 * File outline for the Coding Room's code viewer (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame puts a row of symbol chips above the source —
 * "≡ outline 4" — each chip jumping to a line. This derives that list from the
 * file text itself, with no language server and no index: a reader needs a table
 * of contents far more often than they need a resolver, and a regex pass over
 * one already-loaded file costs nothing and can never be stale relative to what
 * is on screen.
 *
 * Deliberately shallow. It reports declarations that start a line (allowing
 * `export`, `pub`, `async`, and decorator-free indentation), which is what a
 * jump target needs to be. It does not attempt nesting, overloads, generics, or
 * anything requiring a parse — a wrong symbol is worse than a missing one, so
 * every pattern here is anchored and conservative.
 */

/** Symbol classes, in the vocabulary the chips print. */
export type CodeOutlineKind = "fn" | "type" | "class" | "const" | "impl" | "sec";

export type CodeOutlineSymbol = {
  kind: CodeOutlineKind;
  name: string;
  /** 1-based line number, matching the gutter. */
  line: number;
};

/** Outline languages, keyed off the file extension. */
export type CodeOutlineLang = "ts" | "rust" | "swift" | "python" | "shell" | "markdown" | "none";

const EXT_LANG: Record<string, CodeOutlineLang> = {
  ts: "ts",
  tsx: "ts",
  mts: "ts",
  cts: "ts",
  js: "ts",
  jsx: "ts",
  mjs: "ts",
  cjs: "ts",
  rs: "rust",
  swift: "swift",
  py: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  md: "markdown",
  mdx: "markdown",
};

export function codeOutlineLang(fileName: string): CodeOutlineLang {
  const base = fileName.replace(/[\\/]+$/, "");
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "none";
  return EXT_LANG[base.slice(dot + 1).toLowerCase()] ?? "none";
}

type Pattern = { re: RegExp; kind: CodeOutlineKind; group?: number };

const PATTERNS: Record<Exclude<CodeOutlineLang, "none">, Pattern[]> = {
  ts: [
    { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: "fn" },
    { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
    { re: /^\s*(?:export\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/, kind: "type" },
    { re: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "type" },
    // `const Foo = (…) =>` and `const Foo = function` read as functions; a plain
    // `const` binding reads as a constant. Both are jump targets people use.
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)\s*(?::[^=]+)?=>|function\b)/, kind: "fn" },
    { re: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: "const" },
  ],
  rust: [
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_][\w]*)/, kind: "fn" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_][\w]*)/, kind: "type" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_][\w]*)/, kind: "type" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_][\w]*)/, kind: "type" },
    { re: /^\s*impl(?:<[^>]*>)?\s+(.+?)\s*\{?\s*$/, kind: "impl" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+([A-Za-z_][\w]*)/, kind: "const" },
  ],
  swift: [
    { re: /^\s*(?:(?:public|private|internal|fileprivate|open)\s+)?(?:static\s+)?(?:override\s+)?func\s+([A-Za-z_][\w]*)/, kind: "fn" },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|open)\s+)?(?:final\s+)?class\s+([A-Za-z_][\w]*)/, kind: "class" },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|open)\s+)?struct\s+([A-Za-z_][\w]*)/, kind: "type" },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|open)\s+)?enum\s+([A-Za-z_][\w]*)/, kind: "type" },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|open)\s+)?protocol\s+([A-Za-z_][\w]*)/, kind: "type" },
    { re: /^\s*extension\s+([A-Za-z_][\w.]*)/, kind: "impl" },
  ],
  python: [
    { re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/, kind: "fn" },
    { re: /^\s*class\s+([A-Za-z_][\w]*)/, kind: "class" },
  ],
  shell: [
    { re: /^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{/, kind: "fn" },
  ],
  markdown: [
    { re: /^(#{1,4})\s+(.+?)\s*$/, kind: "sec", group: 2 },
  ],
};

/** Outline chips never fill the viewport — past this the header would wrap into
 *  a wall, so the caller shows the count and the first slice. */
export const CODE_OUTLINE_LIMIT = 60;

/**
 * Symbols in `text`, in source order, capped at {@link CODE_OUTLINE_LIMIT}.
 * Returns an empty list for an unknown extension rather than guessing — the
 * caller hides the outline control entirely when there is nothing to show.
 */
export function codeOutline(text: string, fileName: string): CodeOutlineSymbol[] {
  const lang = codeOutlineLang(fileName);
  if (lang === "none") return [];
  const patterns = PATTERNS[lang];
  const out: CodeOutlineSymbol[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && out.length < CODE_OUTLINE_LIMIT; i += 1) {
    const line = lines[i];
    // A blank or comment-only line can't declare anything; skipping first keeps
    // the regex bank off the majority of lines in a real file.
    if (!line.trim()) continue;
    for (const pattern of patterns) {
      const match = pattern.re.exec(line);
      if (!match) continue;
      const name = (match[pattern.group ?? 1] ?? "").trim();
      if (!name) break;
      out.push({ kind: pattern.kind, name, line: i + 1 });
      break;
    }
  }
  return out;
}
