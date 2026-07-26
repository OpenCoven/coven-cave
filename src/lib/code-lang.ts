// ---------------------------------------------------------------------------
// code-lang — resolve a fence token OR a bare file extension to a Shiki id
// ---------------------------------------------------------------------------
//
// Two callers feed the shared Shiki highlighter very differently:
//
//   • Chat code fences feed a language NAME — ```typescript, ```rust.
//   • The Projects file preview feeds a bare EXTENSION — it does
//     `previewPath.split(".").pop()`, so Shiki sees "ts", "tsx", "rs", "yml".
//
// The highlighter only bundles the canonical ids in SHIKI_LANGS. Anything not
// on that list silently falls back to "text" — which renders MONOCHROME, no
// tokens highlighted. That fallback is exactly why every `.ts`/`.tsx` file in
// the Projects preview rendered as flat, uncolored text. Both callers now
// funnel through resolveShikiLang() so an extension is mapped to its real
// grammar before it reaches Shiki.

export const SHIKI_LANGS = [
  "typescript", "tsx", "javascript", "jsx", "rust", "swift", "python", "go",
  "ruby", "bash", "shell", "json", "yaml", "toml", "sql", "html", "css", "scss",
  "markdown", "diff", "dockerfile", "graphql", "lua", "c", "cpp", "java",
  "kotlin", "php", "scala", "zig", "elixir", "erlang", "haskell", "ocaml",
  "clojure", "fsharp", "r", "dart", "vue", "svelte", "text",
] as const;

export type ShikiLang = (typeof SHIKI_LANGS)[number];

const SHIKI_LANG_SET: ReadonlySet<string> = new Set(SHIKI_LANGS);

// Extension / alternate-name → canonical Shiki id. Every value here MUST be a
// member of SHIKI_LANGS (enforced by the unit test) so the highlighter can
// actually load the grammar.
const ALIASES: Record<string, ShikiLang> = {
  // TypeScript / JavaScript family
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  "ts-node": "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  // (tsx / jsx are canonical ids — no alias needed)

  // Python
  py: "python",
  pyi: "python",
  pyw: "python",

  // Rust
  rs: "rust",

  // Ruby
  rb: "ruby",
  gemfile: "ruby",
  rake: "ruby",

  // Shell
  sh: "bash",
  zsh: "bash",
  fish: "bash",
  ksh: "bash",
  // "bash" and "shell" are canonical ids already

  // Config / data
  yml: "yaml",
  htm: "html",

  // Markdown
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  mkd: "markdown",

  // C / C++
  h: "c",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  cc: "cpp",
  cxx: "cpp",
  "c++": "cpp",

  // Kotlin
  kt: "kotlin",
  kts: "kotlin",

  // Go
  golang: "go",

  // GraphQL
  gql: "graphql",

  // Swift
  // (canonical)

  // Functional langs
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",
  hs: "haskell",
  lhs: "haskell",
  ml: "ocaml",
  mli: "ocaml",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  fs: "fsharp",
  fsx: "fsharp",

  // Misc
  rlang: "r",
  scpt: "scala",
  plpgsql: "sql",
  postgres: "sql",
  mysql: "sql",
  containerfile: "dockerfile",

  // Common aliases people type in fences
  yamlld: "yaml",
  shellscript: "bash",
};

/**
 * Map a fence-info token (`typescript`, `ts:foo.ts`) or a bare file extension
 * (`ts`, `TSX`, `.rs`) to a Shiki language id the highlighter can load.
 * Returns "text" when nothing matches — the safe, no-grammar fallback.
 */
export function resolveShikiLang(input: string | null | undefined): ShikiLang {
  if (!input) return "text";
  // Tolerate `lang:filename.ext` fence syntax, a leading dot, and casing.
  let token = input.trim().toLowerCase();
  const colon = token.indexOf(":");
  if (colon > 0) token = token.slice(0, colon).trim();
  if (token.startsWith(".")) token = token.slice(1);
  if (!token) return "text";
  if (SHIKI_LANG_SET.has(token)) return token as ShikiLang;
  return ALIASES[token] ?? "text";
}

/** True when the input resolves to a real grammar (not the "text" fallback). */
export function isHighlightableLang(input: string | null | undefined): boolean {
  return resolveShikiLang(input) !== "text";
}

/**
 * Best-effort grammar for the code INSIDE a unified diff, read from its
 * `+++ b/<path>` / `--- a/<path>` file headers. The bundled `diff` grammar
 * colors whole lines by +/- status only — flat, token-less output. When a
 * header names a file whose extension (or bare name, e.g. Dockerfile)
 * resolves to a real grammar, callers can highlight the diff's content in
 * that language and keep the +/- chrome as line strips instead.
 * Returns "text" when no header names a highlightable file.
 */
export function diffContentLang(diffText: string): ShikiLang {
  for (const line of diffText.split("\n", 10)) {
    const m = /^(?:\+\+\+|---) (?:[ab]\/)?(.+)$/.exec(line);
    if (!m) continue;
    // `git diff` may append a tab + timestamp after the path.
    const path = m[1].split("\t")[0].trim();
    if (!path || path === "/dev/null") continue;
    const base = path.split("/").pop() ?? "";
    const token = base.includes(".") ? base.split(".").pop() ?? "" : base;
    const lang = resolveShikiLang(token);
    // A `.diff` target would re-enter diff rendering — keep flat mode there.
    if (lang !== "text" && lang !== "diff") return lang;
  }
  return "text";
}

// Human-facing display names for the resolved grammar — surfaced as the
// language badge in the Projects preview header. Keyed by canonical id.
const LANG_LABELS: Partial<Record<ShikiLang, string>> = {
  typescript: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  jsx: "JSX",
  rust: "Rust",
  swift: "Swift",
  python: "Python",
  go: "Go",
  ruby: "Ruby",
  bash: "Shell",
  shell: "Shell",
  json: "JSON",
  yaml: "YAML",
  toml: "TOML",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  markdown: "Markdown",
  diff: "Diff",
  dockerfile: "Dockerfile",
  graphql: "GraphQL",
  lua: "Lua",
  c: "C",
  cpp: "C++",
  java: "Java",
  kotlin: "Kotlin",
  php: "PHP",
  scala: "Scala",
  zig: "Zig",
  elixir: "Elixir",
  erlang: "Erlang",
  haskell: "Haskell",
  ocaml: "OCaml",
  clojure: "Clojure",
  fsharp: "F#",
  r: "R",
  dart: "Dart",
  vue: "Vue",
  svelte: "Svelte",
  text: "Text",
};

/**
 * Human label for the resolved grammar — e.g. "ts" → "TypeScript".
 * Falls back to the uppercased extension when the grammar is unknown, so a
 * `.env`/`.lock` file still gets an honest badge rather than a blank one.
 */
export function resolveLangLabel(input: string | null | undefined): string {
  const resolved = resolveShikiLang(input);
  if (resolved !== "text") return LANG_LABELS[resolved] ?? resolved;
  // Unknown grammar — show the raw token uppercased so the badge stays useful.
  const raw = (input ?? "").trim().replace(/^\./, "").toUpperCase();
  return raw && raw.length <= 6 ? raw : "Text";
}
