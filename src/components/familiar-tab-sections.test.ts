// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab sections — shared architecture contracts (cave-7e1l →
// cave-moig skills-page handoff). Each of the five sections (Identity ·
// Skills · MCP · Analytics · Memory) owns its internals — those are pinned in
// the per-section test files — but the pieces they SHARE must not drift:
// the hairline card language in familiar-tab.css, the component-imported CSS
// convention (#3264), the one-derivation section model, and the no-fabricated-
// data rule the prototype violated (hash-generated versions, invented stats).

const SECTIONS = ["skills", "identity", "mcp", "analytics", "memory"];
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const css = read("../styles/familiar-tab.css");

test("the shared card language survives in familiar-tab.css", () => {
  assert.match(css, /\.familiar-tab__card \{[^}]*border: 1px solid var\(--border-hairline\)/, "cards are hairline-bordered");
  assert.match(css, /\.familiar-tab__card \{[^}]*color-mix\(in oklch, var\(--bg-raised\) 40%, transparent\)/, "40% translucent panel wash");
  assert.match(css, /\.familiar-tab__card-title \{[^}]*text-transform: uppercase/, "uppercase card headers");
});

test("every section is its own module importing its own CSS (surface CSS from the component, not globals)", () => {
  for (const name of SECTIONS) {
    const src = read(`./familiar-tab-${name}.tsx`);
    assert.match(
      src,
      new RegExp(`import "@/styles/familiar-tab-${name}\\.css"`),
      `${name} section imports its own stylesheet`,
    );
    assert.match(
      src,
      new RegExp(`export function Familiar${name[0].toUpperCase()}${name.slice(1)}Section\\(`, "i"),
      `${name} section exports its single public component`,
    );
  }
});

test("snapshot-fed sections consume the one shared derivation, not their own provenance math", () => {
  for (const name of ["skills", "identity", "mcp"]) {
    const src = read(`./familiar-tab-${name}.tsx`);
    assert.match(
      src,
      /from "@\/lib\/familiar-tab-section-model"/,
      `${name} section types against the shared section model`,
    );
    assert.doesNotMatch(
      src,
      /fetch\("\/api\/roles"|fetch\("\/api\/skills\/local"/,
      `${name} section does not re-fetch what the hub already loaded`,
    );
  }
});

test("no section fabricates data the prototype hash-generated", () => {
  for (const name of SECTIONS) {
    const src = read(`./familiar-tab-${name}.tsx`);
    assert.doesNotMatch(src, /hashN|charCodeAt\(i\) % 9973/, `${name}: no hash-derived fake stats`);
    assert.doesNotMatch(src, /"31 covens"|"268k"|Invocations 12/, `${name}: no prototype literals`);
  }
});

test("sections keep the design language: tokens, no hex, no raw palette", () => {
  for (const name of SECTIONS) {
    const src = read(`./familiar-tab-${name}.tsx`);
    const sectionCss = read(`../styles/familiar-tab-${name}.css`);
    assert.doesNotMatch(src, /#[0-9a-fA-F]{6}\b/, `${name} component: no hex colors`);
    assert.doesNotMatch(sectionCss, /#[0-9a-fA-F]{6}\b/, `${name} css: no hex colors`);
  }
});
