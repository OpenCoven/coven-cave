// Undefined design-token gate — cave-apg39.
//
// WHAT THIS CATCHES THAT NOTHING ELSE DID
//
// The existing design-token gates (scripts/codemods/tokenize-css.mjs,
// scripts/codemods/tokenize-tsx-design.mjs, src/lib/design-token-drift.test.ts)
// all ask one question: "is this a raw literal that should have been a token?"
// None of them asks "does the token this names actually exist?".
//
// CSS resolves an undefined custom property to the guaranteed-invalid value,
// so `color: var(--not-a-token)` drops to `unset` and the element silently
// inherits — no console error, no build warning, nothing in a diff to see.
// Found live on PR #4872, where `border-[var(--fg-primary)]
// bg-[var(--fg-primary)] text-[var(--bg-base)]` painted a --bg-base glyph on a
// transparent ground: an invisible completed-step dot that every gate passed.
//
// SCOPE — deliberately stated, because partial coverage that is honest beats a
// gate that claims more than it checks.
//
// Definition sources (a token counts as DEFINED if any of these declares it):
//   1. every custom-property declaration in every .css file under src/, in any
//      selector or at-rule context — :root, a theme block, a component class,
//      a media query, `@theme inline`;
//   2. every custom property a non-test .ts/.tsx/.js/.mjs file under src/ sets
//      at runtime — object-literal keys (`"--x":`), computed keys
//      (`["--x" as string]:`), and `element.style.setProperty("--x", …)`;
//   3. next/font `variable: "--font-x"` declarations (src/app/fonts.ts), whose
//      classes the root layout spreads onto <html>;
//   4. Tailwind's own default theme, read from the installed
//      node_modules/tailwindcss/theme.css. This is a version-pinned external
//      contract, not a hand-maintained allowlist.
//
// Reference sites (all three forms the repo actually uses):
//   - `var(--x)` in .css under src/;
//   - `var(--x)` inside a Tailwind arbitrary value in TSX
//     (`rounded-[var(--radius-control)]`) — these are plain substrings of a
//     className string, so the same scan finds them;
//   - `var(--x)` in an inline style object or style string in TSX.
//   Test files (*.test.*, *.spec.*) are NOT reference sites: they carry
//   deliberate fixture strings like `var(--missing)`, and asserting on a
//   fixture is not rendering it.
//
// WHAT IT DOES NOT RESOLVE, and says so rather than passing silently:
//   - Cascade scope. A definition on `.foo` counts as defined even for a
//     reference outside `.foo`. Proving reachability needs a real cascade
//     model; existence is the cheap, decisive half.
//   - The one scope case worth resolving is carved out separately below as
//     THEME-SCOPED-ONLY: a token whose every definition sits behind
//     `[data-theme=…]` / `[data-mode=…]` is undefined on the palettes that do
//     not define it, including the default Coven palette, which has no
//     `[data-theme]` block at all.
//   - Runtime-constructed names (`var(${cssVar})`, `setProperty(name, …)`).
//     A static scan cannot resolve either side. Both are COUNTED and banked
//     per file, so an existing gallery keeps working while a new dynamic site
//     has to be declared instead of slipping in unnoticed.
//   - A Tailwind default-theme token materializes only where Tailwind's
//     compiler sees the reference. Referencing one from a sheet outside the
//     Tailwind graph can still resolve to nothing; treating the framework's
//     own theme as undefined would fire on correct code, which is worse.
//
// NO LINE ANCHORING. scripts/codemods/tokenize-css.mjs matches declarations
// with `/^(\s*)([a-zA-Z-]+)(\s*:\s*)([^;]*)(;.*)$/`, so it only ever inspects
// the FIRST declaration on a line — a hole that hides 31 on-scale literals in
// 14 files today. Nothing here is anchored to a line: declarations come from a
// brace/semicolon walk of the whole source and references from a global regex,
// so `a{--x:1px;--y:2px}` yields both definitions and
// `color:var(--a);background:var(--b)` yields both references.
// token-reference-scan.test.mjs proves it.
//
// Usage:
//   node scripts/design-system/token-reference-scan.mjs           # report
//   node scripts/design-system/token-reference-scan.mjs --check   # exit 1
//   node scripts/design-system/token-reference-scan.mjs --json

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Tailwind's installed default theme — the external half of the defined set. */
export const TAILWIND_THEME_CSS = path.join(repoRoot, "node_modules", "tailwindcss", "theme.css");

const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "__snapshots__"]);

/** A custom-property name: `--` plus at least one name character. */
const NAME = "--[A-Za-z0-9_-]+";

/**
 * Blank out CSS comments and quoted strings, preserving byte offsets and
 * newlines, so a `content: "}"` or a `/* … *\/` can never be read as
 * structure. Offsets are preserved so callers can still report line numbers.
 */
export function blankCssNoise(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        if (source[j] === "\\") j += 1;
        if (source[j] === "\n") break;
        j += 1;
      }
      const stop = Math.min(j + 1, source.length);
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const DECL_HEAD = new RegExp(`^\\s*(${NAME})\\s*:`);
const THEME_SCOPE = /\[data-(?:theme|mode)\s*[~^$*|]?=/;

/**
 * Every custom-property declaration in a CSS source, with the selector stack
 * it sits under. Structural walk over braces and semicolons — never anchored
 * to a line, so any number of declarations may share one.
 *
 * @returns {{name: string, index: number, selectors: string[], themeScoped: boolean}[]}
 */
export function collectCssDefinitions(source) {
  const clean = blankCssNoise(source);
  const found = [];
  const stack = [];
  let chunkStart = 0;

  const flush = (end) => {
    const chunk = clean.slice(chunkStart, end);
    const m = DECL_HEAD.exec(chunk);
    // A declaration only counts inside a block; `--x: 1` at top level is not
    // a declaration, and `@supports (--x: 1)` is blanked out of structure by
    // never opening a block we track as a selector we care about.
    if (m && stack.length > 0) {
      found.push({
        name: m[1],
        index: chunkStart + chunk.indexOf(m[1]),
        selectors: [...stack],
        themeScoped: stack.some((s) => THEME_SCOPE.test(s)),
      });
    }
  };

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === "{") {
      stack.push(clean.slice(chunkStart, i).trim());
      chunkStart = i + 1;
    } else if (ch === "}") {
      flush(i);
      stack.pop();
      chunkStart = i + 1;
    } else if (ch === ";") {
      flush(i);
      chunkStart = i + 1;
    }
  }
  return found;
}

/**
 * Blank out `//` and block comments in a JS/TS source, preserving offsets and
 * newlines. Strings are NOT blanked — a real `var(--x)` lives inside a
 * className or style string — but they are tracked so a `//` inside one is not
 * mistaken for a comment. A doc comment that merely mentions `var()` is not a
 * render site, and counting it as one would fire the gate on correct code.
 */
export function blankJsComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        if (source[j] === "\\") j += 1;
        else if (source[j] === "\n" && ch !== "`") break;
        j += 1;
      }
      const stop = Math.min(j + 1, source.length);
      out += source.slice(i, stop);
      i = stop;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const CODE_DEF_PATTERNS = [
  // { "--x": v }  and  { ["--x" as string]: v }
  new RegExp(`["'\`](${NAME})["'\`](?:\\s+as\\s+[A-Za-z]+)?\\s*\\]?\\s*:`, "g"),
  // element.style.setProperty("--x", v) / removeProperty("--x")
  new RegExp(`\\.(?:set|remove)Property\\(\\s*["'\`](${NAME})["'\`]`, "g"),
  // next/font:  variable: "--font-x"
  new RegExp(`variable\\s*:\\s*["'\`](${NAME})["'\`]`, "g"),
];

/** Custom properties a TS/TSX/JS source defines at runtime. */
export function collectCodeDefinitions(source) {
  const names = [];
  for (const re of CODE_DEF_PATTERNS) {
    for (const m of source.matchAll(re)) names.push({ name: m[1], index: m.index });
  }
  return names;
}

const REF_RE = new RegExp(`var\\(\\s*(${NAME})\\s*(,?)`, "g");
// A `var(` NOT followed by a literal token name — the name is built at runtime.
// The lookahead swallows the whitespace itself: `var\(\s*(?!-)` would backtrack
// `\s*` to zero width and then "pass" on the whitespace, so a multi-line
// `var(\n  --x)` would read as dynamic. That bug was live in this file's first
// draft and flagged src/styles/document-reader.css:3.
const DYNAMIC_REF_RE = /var\((?!\s*--)/g;
// setProperty / removeProperty whose first argument is not a string literal.
// Same lookahead discipline, and `\.`-anchored so a TypeScript interface
// declaring `setProperty(name: string): void` is not read as a call site.
const DYNAMIC_DEF_RE = /\.(?:set|remove)Property\((?!\s*["'`])/g;

/** @returns {{name: string, index: number, fallback: boolean}[]} */
export function collectReferences(source) {
  const out = [];
  for (const m of source.matchAll(REF_RE)) {
    out.push({ name: m[1], index: m.index, fallback: m[2] === "," });
  }
  return out;
}

/** Sites where the token NAME itself is computed, which no static gate can resolve. */
export function collectDynamicSites(source) {
  const out = [];
  for (const m of source.matchAll(DYNAMIC_REF_RE)) out.push({ index: m.index, kind: "reference" });
  for (const m of source.matchAll(DYNAMIC_DEF_RE)) out.push({ index: m.index, kind: "definition" });
  return out;
}

export function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === "\n") line += 1;
  return line;
}

/** Repo-relative, POSIX-separated paths of every scanned source under src/. */
export function sourceFilesInScope(root = repoRoot) {
  const cssFiles = [];
  const codeFiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.endsWith(".css")) cssFiles.push(rel);
      else if (CODE_EXT.test(entry) && !TEST_FILE.test(entry)) codeFiles.push(rel);
    }
  };
  walk(path.join(root, "src"));
  return { cssFiles, codeFiles };
}

/**
 * Analyze an in-memory file set. Pure — no filesystem, no banks, no judgment;
 * {@link assessTokenReferences} is where policy lives, and
 * {@link scanTokenReferences} is the filesystem wrapper. Tests drive this
 * directly so a fixture exercises the exact code path the tree does.
 *
 * @param {{path: string, kind: "css"|"code", source: string}[]} files
 */
export function analyzeSources(files) {
  /** name -> { global: boolean, sites: string[] } */
  const defined = new Map();
  const define = (name, where, global) => {
    const rec = defined.get(name) ?? { global: false, sites: [] };
    rec.global ||= global;
    rec.sites.push(where);
    defined.set(name, rec);
  };

  const references = [];
  const dynamicSites = [];

  for (const { path: rel, kind, source } of files) {
    const clean = kind === "css" ? blankCssNoise(source) : blankJsComments(source);
    if (kind === "css") {
      for (const d of collectCssDefinitions(source)) {
        define(d.name, `${rel}:${lineOf(source, d.index)}`, !d.themeScoped);
      }
    } else {
      for (const d of collectCodeDefinitions(clean)) {
        define(d.name, `${rel}:${lineOf(source, d.index)}`, true);
      }
    }
    for (const r of collectReferences(clean)) {
      references.push({ ...r, file: rel, line: lineOf(source, r.index) });
    }
    for (const d of collectDynamicSites(clean)) {
      dynamicSites.push({ ...d, file: rel, line: lineOf(source, d.index) });
    }
  }

  const undefinedRefs = [];
  const themeScopedOnlyRefs = [];
  for (const ref of references) {
    const rec = defined.get(ref.name);
    if (!rec) undefinedRefs.push(ref);
    else if (!rec.global) themeScopedOnlyRefs.push(ref);
  }

  return { defined, references, undefinedRefs, themeScopedOnlyRefs, dynamicSites };
}

/**
 * Scan the tree: read every in-scope source plus Tailwind's installed default
 * theme, then hand the lot to {@link analyzeSources}.
 */
export function scanTokenReferences(root = repoRoot) {
  const { cssFiles, codeFiles } = sourceFilesInScope(root);

  const files = [];
  // Tailwind's default theme, from the installed package — the external half
  // of the defined set. First so it is never mistaken for repo authorship.
  let tailwindTokens = 0;
  if (existsSync(TAILWIND_THEME_CSS)) {
    const source = readFileSync(TAILWIND_THEME_CSS, "utf8");
    tailwindTokens = collectCssDefinitions(source).length;
    // Only its DEFINITIONS matter; strip nothing, but note that Tailwind's own
    // var() usages are framework-internal and never repo reference sites.
    files.push({ path: "tailwindcss/theme.css", kind: "css", source, external: true });
  }
  for (const rel of cssFiles) {
    files.push({ path: rel, kind: "css", source: readFileSync(path.join(root, rel), "utf8") });
  }
  for (const rel of codeFiles) {
    files.push({ path: rel, kind: "code", source: readFileSync(path.join(root, rel), "utf8") });
  }

  const analyzed = analyzeSources(files.map((f) => (f.external ? { ...f, source: definitionsOnly(f.source) } : f)));
  return { cssFiles, codeFiles, tailwindTokens, ...analyzed };
}

/**
 * Keep a stylesheet's declarations but blank every `var(` in it, so an external
 * package contributes definitions without contributing reference sites we
 * would then have to judge.
 */
function definitionsOnly(source) {
  return source.replace(/var\(/g, "   (");
}

/** Group reference records by token name into `name -> count`. */
export function tallyByName(refs) {
  const out = new Map();
  for (const r of refs) out.set(r.name, (out.get(r.name) ?? 0) + 1);
  return out;
}

/** Group any site record by file into `file -> count`. */
export function tallyByFile(sites) {
  const out = new Map();
  for (const s of sites) out.set(s.file, (out.get(s.file) ?? 0) + 1);
  return out;
}

// ── banks ───────────────────────────────────────────────────────────────────
//
// Every entry below is a defect that predates this gate. They are banked
// rather than fixed because each one needs a design decision about which token
// it SHOULD have named, and a gate PR is the wrong place to make ninety of
// those. Banking is per name with an exact site count, not one summed integer:
// a summed ratchet lets a new `var(--fg-primary)` in a new file hide behind
// somebody else's fix elsewhere, and hiding exactly this bug is what the whole
// gate exists to stop.
//
// Rules the gate enforces on these:
//   - a name NOT in the bank -> hard failure, always;
//   - a banked name whose count goes UP -> hard failure;
//   - a banked name whose count goes DOWN -> the run prints the new number so
//     the next PR banks the progress.
//
// Cleanup is tracked on cave-apg39's follow-ups; see the PR body for the list.

/**
 * Undefined AND no fallback — `var(--x)` with nothing after the name. These
 * are the guaranteed silent failures: the declaration is dropped and the
 * element inherits.
 */
export const BANKED_UNDEFINED_NO_FALLBACK = new Map([
  // Semantic colour names from a vocabulary this repo never adopted. The
  // foundations sheet spells these --text-primary / --text-secondary /
  // --bg-panel / --border-hairline; these are the ones that got typed anyway.
  ["--bg-inset", 2],
  ["--bg-surface", 12],
  ["--border-muted", 1],
  ["--border-panel", 11],
  ["--border-subtle", 3],
  ["--fg-primary", 5],
  ["--surface-muted", 1],
  ["--surface-raised", 1],
  ["--surface-sunken", 1],
  ["--text-danger", 7],
  ["--text-strong", 1],
  ["--text-success", 1],
  ["--text-warning", 7],
  ["--danger", 2],
  ["--color-warning-foreground", 1],
  ["--focus-ring", 2],
  // Scale steps that do not exist: the space scale is 1/2/3/4/5/6/8/10.
  ["--space-7", 8],
  ["--space-9", 4],
  // Shadow and motion vocabularies that were never defined here.
  ["--shadow-elevated", 1],
  ["--motion-fast", 13],
  // A font role with no definition; the type system is serif/sans/mono.
  ["--font-display", 1],
  // Vendored Beautiful UI's own shadow token, which did not come across with
  // the components (src/components/ui/beautiful/, MIT, beautifului.dev).
  ["--bui-shadow-bui-btn", 1],
]);

/**
 * Undefined but WITH a fallback — `var(--x, …)`. These render, so they are not
 * the silent-failure class, and they are still wrong: the name is dead, so a
 * designer retuning that token moves nothing here and the fallback is the real
 * value forever. Banked separately so the report says which class each is and
 * an author reads the right remedy.
 */
export const BANKED_UNDEFINED_WITH_FALLBACK = new Map([
  ["--accent-fg", 1],
  ["--bg-surface", 1],
  ["--citation-card-w", 2],
  ["--composer-pill-gold", 11],
  ["--gh-diff-gutter", 2],
  ["--metric-accent", 2],
  ["--shadow-panel", 1],
  ["--surface-raised", 2],
  ["--text-faint", 1],
  ["--text-warning", 1],
]);

/**
 * Defined ONLY behind `[data-theme=…]` / `[data-mode=…]`, referenced anyway.
 * The default Coven palette has no `[data-theme]` block, so on that palette —
 * the one a fresh profile gets — these resolve to nothing exactly like an
 * undefined token.
 *
 * --destructive is the live one worth naming: 12 definitions in themes.css,
 * all inside six palettes' blocks (ghosty, claymorphism, claude, codex,
 * pastel-dreams, snow). Referenced unconditionally across the four Research
 * surfaces, so every failed/error colour there is unpainted on the default
 * palette and on tide / ember / slate / contrast / solstice.
 */
export const BANKED_THEME_SCOPED_ONLY = new Map([
  ["--destructive", 19],
  ["--shadow-popover", 9],
]);

/**
 * Sites where the token name itself is computed. Counted per file so a new one
 * has to be declared here — a static gate cannot check what it cannot read,
 * and passing it in silence is the failure mode this whole file exists about.
 */
export const BANKED_DYNAMIC_SITES = new Map([
  // The /aesthetic showcase renders the token catalog itself: `var(${p.cssVar})`
  // over the palette, radius and spacing tables it is documenting. The names
  // come from the catalog, so a literal here would defeat the page.
  ["src/app/aesthetic/page.tsx", 3],
  // Resolves a themed terminal colour by name, falling back to `var(${name})`
  // when getComputedStyle has nothing yet.
  ["src/components/bottom-terminal.tsx", 2],
  // Per-node dot colour chosen from a token set at render time.
  ["src/components/grimoire-graph-view.tsx", 1],
  // Appearance settings write the user's chosen palette, font and radius onto
  // <html> by name; the names are the settings keys.
  ["src/components/settings-shell.tsx", 5],
  // Clears the appearance overrides above, by the same key list.
  ["src/lib/appearance-restore.ts", 1],
  // Canvas inspector applies a user-edited property to the selected element.
  ["src/lib/canvas-inspector.ts", 1],
  // Builds a font stack from the catalog's own cssVar field (src/app/fonts.ts
  // declares each one, so the NAMES are checked — just not at this call site).
  ["src/lib/font-catalog.ts", 1],
  ["src/lib/font-storage.ts", 2],
  // A var() substitution engine for the contrast audit: it parses `var(` out of
  // token values rather than authoring a reference.
  ["src/lib/theme-contrast.ts", 1],
  // The theme runtime writes a whole palette onto <html> key by key.
  ["src/lib/theme-runtime.ts", 2],
]);

const BANKS = [
  {
    key: "undefinedNoFallback",
    bank: BANKED_UNDEFINED_NO_FALLBACK,
    label: "undefined token, NO fallback",
    remedy:
      "This resolves to nothing and the declaration is dropped — the element silently inherits. " +
      "Define the token in src/styles/globals/foundations.css, or name one that exists " +
      "(docs/coven-design-language.md).",
  },
  {
    key: "undefinedWithFallback",
    bank: BANKED_UNDEFINED_WITH_FALLBACK,
    label: "undefined token, with a fallback",
    remedy:
      "This renders — via the fallback, forever, because the token it names does not exist. " +
      "Either define the token or drop the var() and keep the value.",
  },
  {
    key: "themeScopedOnly",
    bank: BANKED_THEME_SCOPED_ONLY,
    label: "token defined only inside a [data-theme]/[data-mode] block",
    remedy:
      "Undefined on every palette that does not define it, including the default Coven palette, " +
      "which has no [data-theme] block. Add a base definition in foundations.css.",
  },
];

/**
 * Apply policy to a scan. Returns `{ ok, failures, progress, counts }`;
 * `failures` are human-readable lines, already carrying the remedy.
 */
export function assessTokenReferences(scan) {
  const failures = [];
  const progress = [];

  const buckets = {
    undefinedNoFallback: scan.undefinedRefs.filter((r) => !r.fallback),
    undefinedWithFallback: scan.undefinedRefs.filter((r) => r.fallback),
    themeScopedOnly: scan.themeScopedOnlyRefs,
  };

  const counts = {};
  for (const { key, bank, label, remedy } of BANKS) {
    const actual = tallyByName(buckets[key]);
    counts[key] = actual;
    for (const [name, count] of [...actual].sort()) {
      const banked = bank.get(name);
      const where = buckets[key]
        .filter((r) => r.name === name)
        .slice(0, 8)
        .map((r) => `${r.file}:${r.line}`);
      if (banked === undefined) {
        failures.push(
          `${label}: ${name} (${count} site${count === 1 ? "" : "s"}) — ${where.join(", ")}\n    ${remedy}`,
        );
      } else if (count > banked) {
        failures.push(
          `${label}: ${name} went UP — ${count} sites, banked at ${banked}. ` +
            `${where.join(", ")}\n    ${remedy}`,
        );
      } else if (count < banked) {
        progress.push(
          `${label}: ${name} is down to ${count} from ${banked} — lower the bank in ` +
            `scripts/design-system/token-reference-scan.mjs to keep it.`,
        );
      }
    }
    for (const [name, banked] of bank) {
      if (!actual.has(name)) {
        progress.push(
          `${label}: ${name} is gone (banked at ${banked}) — remove it from the bank in ` +
            `scripts/design-system/token-reference-scan.mjs.`,
        );
      }
    }
  }

  const dynamic = tallyByFile(scan.dynamicSites);
  counts.dynamicSites = dynamic;
  for (const [file, count] of [...dynamic].sort()) {
    const banked = BANKED_DYNAMIC_SITES.get(file);
    if (banked === undefined) {
      failures.push(
        `runtime-constructed token name: ${file} (${count} site${count === 1 ? "" : "s"})\n    ` +
          `A static gate cannot resolve a name built at runtime, so this file is not covered. ` +
          `Prefer a literal name; if it must be dynamic, add the file to BANKED_DYNAMIC_SITES in ` +
          `scripts/design-system/token-reference-scan.mjs and say why.`,
      );
    } else if (count > banked) {
      failures.push(
        `runtime-constructed token name: ${file} went UP — ${count} sites, banked at ${banked}.\n    ` +
          `Prefer a literal token name; raise the bank in ` +
          `scripts/design-system/token-reference-scan.mjs only with a reason.`,
      );
    } else if (count < banked) {
      progress.push(
        `runtime-constructed token name: ${file} is down to ${count} from ${banked} — lower the bank.`,
      );
    }
  }
  for (const [file, banked] of BANKED_DYNAMIC_SITES) {
    if (!dynamic.has(file)) {
      progress.push(
        `runtime-constructed token name: ${file} is gone (banked at ${banked}) — remove it from the bank.`,
      );
    }
  }

  return { ok: failures.length === 0, failures, progress, counts };
}

function main() {
  const args = process.argv.slice(2);
  const scan = scanTokenReferences();
  const verdict = assessTokenReferences(scan);

  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          ok: verdict.ok,
          failures: verdict.failures,
          progress: verdict.progress,
          definedTokens: scan.defined.size,
          references: scan.references.length,
          undefinedRefs: scan.undefinedRefs.map((r) => `${r.file}:${r.line} ${r.name}`),
          themeScopedOnlyRefs: scan.themeScopedOnlyRefs.map((r) => `${r.file}:${r.line} ${r.name}`),
          dynamicSites: scan.dynamicSites.map((d) => `${d.file}:${d.line} ${d.kind}`),
        },
        null,
        2,
      ),
    );
  } else {
    for (const line of verdict.progress) console.log(`[token-refs] ${line}`);
    for (const line of verdict.failures) console.error(`[token-refs] ${line}`);
    console.log(
      `[token-refs] ${scan.cssFiles.length} css + ${scan.codeFiles.length} code files; ` +
        `${scan.defined.size} tokens defined (${scan.tailwindTokens} from tailwindcss/theme.css); ` +
        `${scan.references.length} var() references; ` +
        `${scan.undefinedRefs.length} undefined, ${scan.themeScopedOnlyRefs.length} theme-scoped-only, ` +
        `${scan.dynamicSites.length} runtime-constructed`,
    );
  }

  if (args.includes("--check") && !verdict.ok) {
    console.error(`[token-refs] ${verdict.failures.length} finding(s) — see above.`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
