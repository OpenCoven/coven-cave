import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  LAYER_ALIGNMENT_TOLERANCE_PX,
  METRIC_AFFECTING_PROPERTIES,
  METRIC_PROBE_TOLERANCE_PX,
  MIRRORED_LAYER_STYLE_PROPERTIES,
  composerLayerAligned,
  emphasisIsMetricSafe,
} from "./composer-markdown-layer.ts";

// ── The fail-open guards ────────────────────────────────────────────────────

test("an aligned layer is one whose line boxes match within tolerance", () => {
  assert.equal(composerLayerAligned(120, 120), true);
  assert.equal(composerLayerAligned(120, 120 + LAYER_ALIGNMENT_TOLERANCE_PX), true);
  assert.equal(composerLayerAligned(120, 120 - LAYER_ALIGNMENT_TOLERANCE_PX), true);
  // Pinned as literals, not via the constant: two elements rounding a wrapped
  // block independently differ by a fraction of a pixel routinely, and a
  // zero-tolerance comparison would flap the decoration on and off mid-typing.
  assert.equal(composerLayerAligned(120, 120.5), true);
  assert.equal(composerLayerAligned(120, 121), true);
});

test("a wrap divergence of a whole line refuses to blank the textarea", () => {
  // A font mismatch shows up as a changed wrap count, i.e. one line of height.
  assert.equal(composerLayerAligned(120, 144), false);
  assert.equal(composerLayerAligned(144, 120), false);
});

test("an unmeasured layer is never treated as aligned", () => {
  // The direction of this guard is the whole point: reading "nothing has
  // rendered yet" as "perfectly aligned" would hide the composer's text
  // before the layer had any content to replace it with.
  assert.equal(composerLayerAligned(0, 0), false);
  assert.equal(composerLayerAligned(120, 0), false);
  assert.equal(composerLayerAligned(0, 120), false);
  assert.equal(composerLayerAligned(-1, -1), false);
  assert.equal(composerLayerAligned(Number.NaN, 120), false);
  assert.equal(composerLayerAligned(120, Number.POSITIVE_INFINITY), false);
});

test("slant is metric-safe only when the two probe widths agree", () => {
  // Equal widths ⇒ the browser synthesized the oblique from the regular face.
  assert.equal(emphasisIsMetricSafe(200, 200), true);
  assert.equal(emphasisIsMetricSafe(200, 200 + METRIC_PROBE_TOLERANCE_PX), true);
  // A real italic face has its own advances, so slanting would drift the line.
  assert.equal(emphasisIsMetricSafe(200, 206), false);
  assert.equal(emphasisIsMetricSafe(206, 200), false);
});

test("an unmeasured probe refuses slant", () => {
  assert.equal(emphasisIsMetricSafe(0, 0), false);
  assert.equal(emphasisIsMetricSafe(200, 0), false);
  assert.equal(emphasisIsMetricSafe(Number.NaN, Number.NaN), false);
});

test("the mirrored property list covers every metric that moves a wrap point", () => {
  // Anything absent here is a property the layer silently inherits from its own
  // stylesheet instead of from the textarea — which is how the layer drifts
  // when a surface (the font catalog, the screen-scale steps, the mobile type
  // rules) changes composer typography without knowing this file exists.
  for (const property of [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontStretch",
    "lineHeight",
    "letterSpacing",
    "wordSpacing",
    "textTransform",
    "tabSize",
    "paddingTop",
    "paddingLeft",
    "paddingRight",
    "paddingBottom",
    "boxSizing",
  ]) {
    assert.ok(
      (MIRRORED_LAYER_STYLE_PROPERTIES as readonly string[]).includes(property),
      `${property} must be mirrored from the textarea`,
    );
  }
});

// ── The stylesheet contract ─────────────────────────────────────────────────

type CssRule = { selector: string; body: string };

function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const selector = match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!selector || selector.startsWith("@")) continue;
    rules.push({ selector, body: match[2] });
  }
  return rules;
}

function declaredProperties(body: string): string[] {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .map((declaration) => declaration.split(":")[0]?.trim().toLowerCase() ?? "")
    .filter(Boolean);
}

const COMPOSER_CSS = readFileSync(
  path.join(process.cwd(), "src/styles/cave-composer.css"),
  "utf8",
);

/** Rules that paint the decoration layer's own text. */
const LAYER_RULES = parseRules(COMPOSER_CSS).filter((rule) =>
  /cave-composer-md-layer|cave-md-tok|cave-md-blk/.test(rule.selector),
);

test("the decoration layer's rules exist at all", () => {
  assert.ok(LAYER_RULES.length > 0, "no decoration-layer rules found in cave-composer.css");
});

test("no decoration-layer rule sets a property that changes text metrics", () => {
  // The layer re-lays out the same characters as the textarea. Any property
  // here that moves a wrap point detaches the painted decoration from the
  // glyphs it describes — so bold is inked with -webkit-text-stroke rather
  // than font-weight, and a heading is coloured rather than enlarged.
  const banned = new Set<string>(METRIC_AFFECTING_PROPERTIES);
  const violations: string[] = [];
  for (const rule of LAYER_RULES) {
    for (const property of declaredProperties(rule.body)) {
      if (banned.has(property)) violations.push(`${rule.selector} { ${property} }`);
    }
  }
  assert.deepEqual(violations, []);
});

test("slant is only ever applied behind the metric-safe measurement", () => {
  // font-style is the one metric-affecting property the layer may use, and
  // only where the runtime probe measured the oblique as synthesized.
  const unguarded = LAYER_RULES.filter(
    (rule) =>
      declaredProperties(rule.body).includes("font-style") &&
      !rule.selector.includes('[data-metric-safe="true"]'),
  ).map((rule) => rule.selector);
  assert.deepEqual(unguarded, []);
});

test("the textarea is only blanked through the guarded modifier class", () => {
  // `-webkit-text-fill-color: transparent` is the property that makes the
  // composer's own text invisible. It must live on the modifier the component
  // applies only after measuring, never on the base composer input.
  const blanking = parseRules(COMPOSER_CSS).filter((rule) =>
    /(?:^|[\s,{])color\s*:\s*transparent|-webkit-text-fill-color\s*:\s*transparent/.test(
      rule.body,
    ),
  );
  assert.ok(blanking.length > 0, "expected the blanking rule to exist");
  for (const rule of blanking) {
    assert.ok(
      rule.selector.includes("cave-composer-input--md"),
      `${rule.selector} blanks composer text outside the guarded modifier`,
    );
  }
});

test("the layer never takes pointer events or a place in the tab order", () => {
  const found = LAYER_RULES.find((rule) => rule.selector === ".cave-composer-md-layer");
  assert.ok(found, "expected a base .cave-composer-md-layer rule");
  // Comments in this rule explain why display:none is wrong, so the assertions
  // below have to read declarations rather than prose.
  const base = { ...found, body: found.body.replace(/\/\*[\s\S]*?\*\//g, "") };
  assert.match(base.body, /pointer-events\s*:\s*none/);
  // `visibility: hidden`, not `display: none` — the alignment check has to be
  // able to measure the layer while it is inactive, and a display:none element
  // reports a scrollHeight of 0.
  assert.match(base.body, /visibility\s*:\s*hidden/);
  assert.doesNotMatch(base.body, /display\s*:\s*none/);
});
