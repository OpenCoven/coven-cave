// Undefined design-token gate — cave-apg39.
//
// The sibling gate, src/lib/design-token-drift.test.ts, asks "is this a raw
// literal that should have been a token?". This one asks the question nothing
// asked: "does the token this names actually exist?".
//
// An undefined custom property resolves to the guaranteed-invalid value, so
// `color: var(--not-a-token)` is dropped and the element silently inherits.
// No console error, no build warning, nothing a reviewer can see in a diff.
// Found live on PR #4872: `border-[var(--fg-primary)] bg-[var(--fg-primary)]
// text-[var(--bg-base)]` painted a --bg-base glyph on a transparent ground.
// Lint, the codemod check and the drift ratchets were all green.
//
// Scope, definition sources, and what this deliberately does NOT resolve are
// documented on scripts/design-system/token-reference-scan.mjs. Read that
// header before changing anything here.
//
// RUN THIS FILE WITHOUT THE CSS FACADE HOOK, for the same reason the drift gate
// does (RAW_SOURCE_SCANNER_TESTS in scripts/run-tests.mjs): the hook inlines
// every @import into src/app/globals.css, so each imported sheet is read twice
// and every per-name count doubles into convincing but bogus "went UP"
// failures. The guard below fails fast with the diagnosis instead.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import cssContract from "../../scripts/css-source-contract.cjs";

{
  const probe = new URL("../app/globals.css", import.meta.url);
  assert.ok(
    readFileSync(probe, "utf8") === cssContract.readRawCssSync(probe, "utf8"),
    "undefined-token-reference.test.ts must run WITHOUT --require ./scripts/css-source-contract-hook.cjs " +
      "(see RAW_SOURCE_SCANNER_TESTS in scripts/run-tests.mjs). The facade hook inlines CSS imports, " +
      "so every imported sheet is counted twice and the per-name banks all read as 'went UP'. " +
      "Run: node --experimental-strip-types --test src/lib/undefined-token-reference.test.ts",
  );
}

import {
  analyzeSources,
  assessTokenReferences,
  blankCssNoise,
  blankJsComments,
  collectCssDefinitions,
  collectDynamicSites,
  collectReferences,
  scanTokenReferences,
  tallyByName,
} from "../../scripts/design-system/token-reference-scan.mjs";

// `file`/`line` are attached by analyzeSources; collectReferences alone omits
// them, so both shapes share one alias.
type Ref = { name: string; fallback: boolean; file?: string; line?: number };
type Def = { name: string; themeScoped: boolean; selectors: string[] };
type Site = { kind: string; file?: string };

const names = (list: { name: string }[]) => list.map((x) => x.name);

// ── no line anchoring ───────────────────────────────────────────────────────
//
// scripts/codemods/tokenize-css.mjs matches with `/^(\s*)([a-zA-Z-]+)…$/`, so
// it only ever sees the FIRST declaration on a line — a hole that hides 31
// on-scale literals across 14 files today. Nothing here may inherit it.

{
  // Two DEFINITIONS on one line. A line-anchored scanner finds only --first.
  const defs = collectCssDefinitions(":root{--first:1px;--second:2px;--third:3px}") as Def[];
  assert.deepEqual(names(defs), ["--first", "--second", "--third"]);

  // Two REFERENCES on one line, the shape PR #4872's line 242 actually had.
  const refs = collectReferences(
    ".dot{border-color:var(--fg-primary);background:var(--fg-primary);color:var(--bg-base)}",
  ) as Ref[];
  assert.deepEqual(names(refs), ["--fg-primary", "--fg-primary", "--bg-base"]);

  // Whole-file minified CSS: no newline anywhere, definitions and references
  // interleaved. This is the real shape of src/styles/board/github-list.css.
  const dense = analyzeSources([
    { path: "a.css", kind: "css", source: ":root{--a:1px;--b:2px}.x{color:var(--a);border:var(--b);outline:var(--c)}" },
  ]);
  assert.deepEqual(names(dense.undefinedRefs), ["--c"], "the third declaration on the only line is still read");

  // A definition that is the last in its block, with no trailing semicolon.
  const trailing = collectCssDefinitions(".x{color:red;--tail:9px}") as Def[];
  assert.deepEqual(names(trailing), ["--tail"]);
}

// ── fallbacks are a distinct class, not a pass ──────────────────────────────

{
  const refs = collectReferences("a{color:var(--x);border:var(--y, 8px);outline:var(--z,var(--w))}") as Ref[];
  assert.deepEqual(
    refs.map((r) => [r.name, r.fallback]),
    [
      ["--x", false],
      ["--y", true],
      ["--z", true],
      ["--w", false],
    ],
    "a fallback is detected by the comma, and a nested var() is still its own reference",
  );
}

// ── theme-scoped definitions are not global definitions ─────────────────────
//
// The default Coven palette has NO [data-theme] block: it is the :root in
// foundations.css. So a token defined only inside `[data-theme="snow"]`
// resolves to nothing on the palette a fresh profile gets.

{
  const defs = collectCssDefinitions(
    ':root{--base:1}\n[data-theme="snow"]{--only-snow:2}\n[data-theme="snow"][data-mode="light"]{--only-snow:3}\n.card{--scoped:4}',
  ) as Def[];
  const scoped = Object.fromEntries(defs.map((d) => [d.name, d.themeScoped]));
  assert.deepEqual(scoped, {
    "--base": false,
    "--only-snow": true,
    "--scoped": false,
  });

  const scan = analyzeSources([
    { path: "t.css", kind: "css", source: '[data-theme="snow"]{--only-snow:2}\n.card{color:var(--only-snow)}' },
  ]);
  assert.deepEqual(names(scan.themeScopedOnlyRefs), ["--only-snow"]);
  assert.equal(scan.undefinedRefs.length, 0, "theme-scoped-only is its own class, not 'undefined'");

  // A component-scoped definition (.card) is NOT theme-scoped: proving a
  // reference is inside .card needs a cascade model this gate does not claim.
  const componentScoped = analyzeSources([
    { path: "c.css", kind: "css", source: ".card{--pad:4px}\n.other{padding:var(--pad)}" },
  ]);
  assert.equal(componentScoped.themeScopedOnlyRefs.length, 0);
  assert.equal(componentScoped.undefinedRefs.length, 0);
}

// ── comments and strings are never structure, and never reference sites ─────

{
  assert.equal(
    analyzeSources([{ path: "c.css", kind: "css", source: "/* .x { color: var(--ghost) } */\n.y{color:red}" }])
      .references.length,
    0,
    "a commented-out CSS reference is not a reference",
  );
  assert.equal(
    analyzeSources([{ path: "c.ts", kind: "code", source: "// paints var(--ghost)\nconst a = 1;\n" }]).references
      .length,
    0,
    "a JS line comment mentioning var() is not a reference",
  );
  // …but a string IS: every Tailwind arbitrary value lives in one.
  const inCode = analyzeSources([
    { path: "c.tsx", kind: "code", source: 'const cls = "rounded-[var(--radius-control)] text-[var(--text-sm)]";' },
  ]);
  assert.deepEqual(names(inCode.references), ["--radius-control", "--text-sm"]);

  // A brace or semicolon inside a CSS string must not close a block.
  const tricky = collectCssDefinitions('.x{content:"};";--after:1px}') as Def[];
  assert.deepEqual(names(tricky), ["--after"], "a brace inside content: cannot end the block");
  assert.ok(blankCssNoise('a{content:"}"}').includes("a{content:"));
  assert.ok(!blankJsComments("const a = 1; // var(--x)").includes("var(--x)"));
}

// ── runtime-constructed names are reported, never silently passed ───────────

{
  const dyn = collectDynamicSites('style={{ background: `var(${dotToken})` }}') as Site[];
  assert.deepEqual(
    dyn.map((d) => d.kind),
    ["reference"],
  );
  const setter = collectDynamicSites("root.style.setProperty(name, value);") as Site[];
  assert.deepEqual(
    setter.map((d) => d.kind),
    ["definition"],
  );

  // A literal setProperty is a DEFINITION, not a dynamic site.
  assert.equal(collectDynamicSites('root.style.setProperty("--radius", v);').length, 0);
  assert.equal(
    analyzeSources([{ path: "d.ts", kind: "code", source: 'root.style.setProperty("--mint", v);' }]).defined.has(
      "--mint",
    ),
    true,
  );

  // A TypeScript interface declaring the method is not a call site.
  assert.equal(collectDynamicSites("interface S { setProperty(name: string): void }").length, 0);

  // A multi-line var() is a LITERAL reference, not a dynamic one. The naive
  // `/var\(\s*(?!-)/` backtracks `\s*` to zero width and "passes" on the
  // newline; this asserts the lookahead swallows the whitespace itself.
  assert.equal(collectDynamicSites("--a: var(\n  --b\n);").length, 0);
  assert.deepEqual(names(collectReferences("--a: var(\n  --b\n);") as Ref[]), ["--b"]);
}

// ── the decisive case: PR #4872, reproduced as a fixture ────────────────────
//
// Three tokens defined nowhere, used 12 times in one component, next to
// --bg-base on the same line, which IS defined. Every existing gate passed it.
// Do not pull that branch in — this is an equivalent fixture, and it must fail.

{
  const foundations = `:root {
  --bg-base: oklch(0.225 0.004 291);
  --text-primary: oklch(0.985 0 0);
  --radius-control: 8px;
}`;
  // The multiplicities are PR #4872's own: --fg-primary x7, --fg-secondary x2,
  // --text-danger x3, and --bg-base sharing the dot's line.
  const surface = `export function ResearchRunSurface() {
  return (
    <div className="text-[var(--text-danger)]">
      <h2 className="text-[var(--fg-primary)]">{title}</h2>
      <span className="border-[var(--fg-primary)] text-[var(--fg-primary)]" />
      <span className="border-[var(--fg-primary)] bg-[var(--fg-primary)] text-[var(--bg-base)]" />
      <b className="text-[var(--text-danger)] decoration-[var(--text-danger)]" />
      <p className="text-[var(--fg-primary)] caret-[var(--fg-secondary)]">{note}</p>
      <small className="text-[var(--fg-secondary)]">{sub}</small>
      <footer className="text-[var(--fg-primary)]" />
      <i className="bg-[var(--surface-muted)]" />
    </div>
  );
}`;
  const fixture = analyzeSources([
    { path: "src/styles/globals/foundations.css", kind: "css", source: foundations },
    { path: "src/components/research-run-surface.tsx", kind: "code", source: surface },
  ]);

  const tally = tallyByName(fixture.undefinedRefs) as Map<string, number>;
  assert.deepEqual(
    Object.fromEntries(tally),
    { "--text-danger": 3, "--fg-primary": 7, "--fg-secondary": 2, "--surface-muted": 1 },
    "the undefined tokens are found, and --bg-base on the same line is not flagged",
  );
  assert.ok(
    fixture.references.some((r: Ref) => r.name === "--bg-base"),
    "--bg-base is still counted as a reference — it is simply a defined one",
  );

  // Now the gate, not just the scanner. The four tokens take three DIFFERENT
  // paths through it, which is why the fixture keeps the real multiplicities:
  //   --fg-secondary  unbanked             -> fails outright
  //   --fg-primary    retired by z2sbd      -> fails outright
  //   --text-danger   retired by z2sbd      -> fails outright
  //   --surface-muted banked at 1, used 1  -> does NOT fail, and must not
  // An equivalent mutant would reach only the unbanked path and still look green.
  const verdict = assessTokenReferences({
    undefinedRefs: fixture.undefinedRefs,
    themeScopedOnlyRefs: [],
    dynamicSites: [],
  });
  assert.equal(verdict.ok, false, "the gate must fail on PR #4872's case");
  assert.ok(
    verdict.failures.some((f: string) => f.includes("--fg-secondary") && f.includes("undefined token, NO fallback")),
    `an unbanked undefined token must fail outright: ${verdict.failures.join(" | ")}`,
  );
  assert.ok(
    verdict.failures.some((f: string) => f.includes("--fg-primary") && f.includes("undefined token, NO fallback")),
    `a retired undefined token must fail outright: ${verdict.failures.join(" | ")}`,
  );
  assert.ok(
    verdict.failures.some((f: string) => f.includes("--text-danger") && f.includes("undefined token, NO fallback")),
    `a second retired undefined token must fail outright: ${verdict.failures.join(" | ")}`,
  );
  assert.ok(
    !verdict.failures.some((f: string) => f.includes("--surface-muted")),
    "a banked token still under its count is not a new defect",
  );
  assert.ok(
    verdict.failures.every((f: string) => !f.includes("--bg-base")),
    "the defined token on the same line is never implicated",
  );

  // The "went UP" branch, isolated: a banked name over its banked count.
  const overBank = assessTokenReferences({
    undefinedRefs: Array.from({ length: 2 }, (_, i) => ({
      name: "--surface-muted",
      fallback: false,
      file: "src/components/research-run-surface.tsx",
      line: 240 + i,
    })),
    themeScopedOnlyRefs: [],
    dynamicSites: [],
  });
  assert.equal(overBank.ok, false);
  assert.ok(
    overBank.failures.some((f: string) => f.includes("--surface-muted") && f.includes("went UP")),
    `a banked name over its count must fail: ${overBank.failures.join(" | ")}`,
  );

  // …and exactly at the banked count it must NOT fail, or the gate fires on
  // the tree it was measured against.
  const atBank = assessTokenReferences({
    undefinedRefs: Array.from({ length: 1 }, (_, i) => ({
      name: "--surface-muted",
      fallback: false,
      file: "src/components/research-run-surface.tsx",
      line: 32 + i,
    })),
    themeScopedOnlyRefs: [],
    dynamicSites: [],
  });
  assert.equal(atBank.ok, true, "at the banked count the gate is quiet");
}

// ── the same three tokens WITH fallbacks are a different verdict ────────────

{
  const withFallbacks = assessTokenReferences({
    undefinedRefs: [{ name: "--fg-secondary", fallback: true, file: "x.tsx", line: 1 }],
    themeScopedOnlyRefs: [],
    dynamicSites: [],
  });
  assert.equal(withFallbacks.ok, false, "an undefined token is still wrong with a fallback");
  assert.ok(
    withFallbacks.failures.some((f: string) => f.includes("with a fallback")),
    "…but it is reported as its own class, with its own remedy",
  );
}

// ── a new runtime-constructed site must be declared, not absorbed ───────────

{
  const fresh = assessTokenReferences({
    undefinedRefs: [],
    themeScopedOnlyRefs: [],
    dynamicSites: [{ kind: "reference", file: "src/components/brand-new.tsx", line: 12 }],
  });
  assert.equal(fresh.ok, false);
  assert.ok(fresh.failures.some((f: string) => f.includes("runtime-constructed token name")));
}

// ── the tree itself ─────────────────────────────────────────────────────────

const scan = scanTokenReferences();

assert.ok(scan.cssFiles.length > 100, "scanner should find the src CSS tree");
assert.ok(scan.codeFiles.length > 500, "scanner should find the src TS/TSX tree");
assert.ok(scan.tailwindTokens > 300, "Tailwind's installed default theme should contribute its tokens");
assert.ok(
  scan.defined.has("--bg-base") && scan.defined.has("--radius-control"),
  "foundations.css tokens must be in the defined set",
);
assert.ok(scan.references.length > 1000, "the tree should have plenty of var() references to check");

const verdict = assessTokenReferences(scan);
for (const line of verdict.progress) console.log(`[token-refs] ${line}`);
assert.ok(
  verdict.ok,
  `undefined design-token references:\n\n${verdict.failures.join("\n\n")}\n\n` +
    `Each of these names a custom property nothing defines. Run ` +
    `\`node scripts/design-system/token-reference-scan.mjs\` for the full report. ` +
    `Every pre-existing case is banked by name and exact count in ` +
    `scripts/design-system/token-reference-scan.mjs — a bank is only ever LOWERED, ` +
    `and a name that is not in it is a new defect.`,
);

console.log(
  `undefined-token-reference: ok (${scan.cssFiles.length} css + ${scan.codeFiles.length} code files; ` +
    `${scan.defined.size} tokens defined; ${scan.references.length} var() references; ` +
    `${scan.undefinedRefs.length} undefined / ${scan.themeScopedOnlyRefs.length} theme-scoped-only / ` +
    `${scan.dynamicSites.length} runtime-constructed, all banked)`,
);
