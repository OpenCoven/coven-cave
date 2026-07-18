// Design-token codemod — Cave UX P3 (Sage's 2026-07-03 audit, tier P3).
//
// Rewrites exact on-scale px literals in src CSS to the sanctioned tokens
// from `src/app/globals.css` (design-language checklist rule 1: tokens only):
//
//   font-size:      10/11/12/13/14/20/28px     -> var(--text-*)
//                   (16px stays literal — iOS anti-zoom floor, see below)
//   padding/margin/gap family: 4px grid values -> var(--space-*)
//   border-radius:  8/12/16/999px              -> var(--radius-*)
//
// Every mapping is value-preserving by construction: each token is *defined*
// as that exact px value (pinned against the live globals.css definitions by
// `src/lib/design-token-drift.test.ts`, which also asserts this codemod is a
// no-op over the tree — the "no new on-scale literals" gate).
//
// What it deliberately leaves alone:
//   - custom-property definition lines (`--foo: 12px;`) — token definitions
//     are the sanctioned place for literals;
//   - off-scale values (6px, 10.5px, …) — those need design judgment, and
//     stay visible in the drift ratchet instead;
//   - values inside calc()/max()/var() fallbacks, negative values, and
//     multi-line or commented declarations;
//   - `src/app/mockup/` (standalone mockup with its own token copy);
//   - lines carrying a `tokens-exempt` marker comment.
//
// Usage:
//   node scripts/codemods/tokenize-css.mjs            # rewrite in place
//   node scripts/codemods/tokenize-css.mjs --check    # exit 1 if drift found
//   node scripts/codemods/tokenize-css.mjs a.css b.css  # limit to files
//
// Idempotent: rerun any time drift accumulates.

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// px -> token name. Mirrors src/app/globals.css :root; the drift gate test
// asserts this table matches the live definitions, so a token retune fails
// loudly here instead of silently diverging.
//
// 16px (--text-lg) is deliberately NOT mapped: `font-size: 16px` on inputs is
// the iOS Safari anti-zoom floor (see composer-zoom-smoke.test.ts and
// ui/field.test.ts) — a behavior threshold, not a type-scale choice. It must
// survive a token retune, so it stays a sanctioned literal.
export const FONT_SIZE_TOKENS = new Map([
  ["10px", "--text-2xs"],
  ["11px", "--text-xs"],
  ["12px", "--text-sm"],
  ["13px", "--text-base"],
  ["14px", "--text-md"],
  ["20px", "--text-xl"],
  ["28px", "--text-display"],
]);

// font-size literals the drift ratchet treats as sanctioned (not drift).
export const SANCTIONED_FONT_SIZE_LITERALS = new Set(["16px"]);

export const SPACE_TOKENS = new Map([
  ["4px", "--space-1"],
  ["8px", "--space-2"],
  ["12px", "--space-3"],
  ["16px", "--space-4"],
  ["20px", "--space-5"],
  ["24px", "--space-6"],
  ["32px", "--space-8"],
  ["40px", "--space-10"],
]);

export const RADIUS_TOKENS = new Map([
  ["8px", "--radius-control"],
  ["12px", "--radius-card"],
  ["16px", "--radius-panel"],
  ["999px", "--radius-pill"],
]);

export const FONT_SIZE_PROPS = new Set(["font-size"]);

export const SPACING_PROPS = new Set([
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-block",
  "padding-inline",
  "padding-block-start",
  "padding-block-end",
  "padding-inline-start",
  "padding-inline-end",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-inline",
  "margin-block-start",
  "margin-block-end",
  "margin-inline-start",
  "margin-inline-end",
  "gap",
  "row-gap",
  "column-gap",
]);

export const RADIUS_PROPS = new Set(["border-radius"]);

/** Repo-relative path prefixes the codemod (and the drift gate) never touch. */
export const EXCLUDED_PATHS = ["src/app/mockup/"];

export const EXEMPT_MARKER = "tokens-exempt";

// One declaration on one line: indent, property, colon, value, `;` + rest.
const DECL_RE = /^(\s*)([a-zA-Z-]+)(\s*:\s*)([^;]*)(;.*)$/;
// A bare positive px length ("12px", "12.0px") — not calc()/var() parts,
// which never split into a bare `<n>px` whitespace token.
const PX_RE = /^([0-9]+(?:\.[0-9]+)?)px$/;

function tableFor(prop) {
  if (FONT_SIZE_PROPS.has(prop)) return FONT_SIZE_TOKENS;
  if (SPACING_PROPS.has(prop)) return SPACE_TOKENS;
  if (RADIUS_PROPS.has(prop)) return RADIUS_TOKENS;
  return null;
}

function rewriteValue(value, table) {
  // Split on whitespace runs, preserving them, and map each bare px piece.
  return value
    .split(/(\s+)/)
    .map((piece) => {
      const m = PX_RE.exec(piece);
      if (!m) return piece;
      const canonical = `${Number.parseFloat(m[1])}px`;
      const token = table.get(canonical);
      return token ? `var(${token})` : piece;
    })
    .join("");
}

/**
 * Tokenize one CSS source. Pure and idempotent; returns the rewritten text.
 */
export function tokenizeCss(source) {
  let inComment = false;
  return source
    .split("\n")
    .map((line) => {
      const startedInComment = inComment;
      // Track block-comment state (no nesting in CSS).
      let scan = line;
      while (true) {
        if (inComment) {
          const end = scan.indexOf("*/");
          if (end === -1) break;
          inComment = false;
          scan = scan.slice(end + 2);
        } else {
          const start = scan.indexOf("/*");
          if (start === -1) break;
          inComment = true;
          scan = scan.slice(start + 2);
        }
      }
      if (startedInComment) return line;
      if (line.includes(EXEMPT_MARKER)) return line;
      const trimmed = line.trimStart();
      if (trimmed.startsWith("--")) return line; // token definitions stay literal
      const m = DECL_RE.exec(line);
      if (!m) return line;
      const [, indent, prop, sep, value, tail] = m;
      const table = tableFor(prop.toLowerCase());
      if (!table) return line;
      if (value.includes("/*")) return line; // comment inside value — hands off
      return `${indent}${prop}${sep}${rewriteValue(value, table)}${tail}`;
    })
    .join("\n");
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** All in-scope CSS files, repo-relative. Shared with the drift gate test. */
export function cssFilesInScope() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      // POSIX-normalize so EXCLUDED_PATHS ("/"-separated) works on Windows.
      const rel = path.relative(repoRoot, full).split(path.sep).join("/");
      if (EXCLUDED_PATHS.some((p) => (rel + "/").startsWith(p) || rel.startsWith(p))) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".css")) out.push(rel);
    }
  };
  walk(path.join(repoRoot, "src"));
  return out.sort();
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const files = args.filter((a) => a !== "--check");
  const targets = files.length > 0 ? files : cssFilesInScope();

  let changed = 0;
  for (const rel of targets) {
    const full = path.resolve(repoRoot, rel);
    const before = readFileSync(full, "utf8");
    const after = tokenizeCss(before);
    if (after === before) continue;
    changed += 1;
    if (check) {
      console.error(`[tokenize-css] drift: ${rel}`);
    } else {
      writeFileSync(full, after);
      console.log(`[tokenize-css] rewrote ${rel}`);
    }
  }
  if (check && changed > 0) {
    console.error(
      `[tokenize-css] ${changed} file(s) carry on-scale px literals — run: node scripts/codemods/tokenize-css.mjs`,
    );
    process.exit(1);
  }
  console.log(`[tokenize-css] ${check ? "checked" : "done"} — ${changed} file(s) ${check ? "with drift" : "rewritten"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
