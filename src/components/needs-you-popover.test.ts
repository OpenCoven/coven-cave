import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-text contracts for the Needs-you inbox (design handoff
// `Coven Cave Prototype.dc.html` frame 2c, spec §4.4/§7).
//
// Behaviour — ordering, the seen-key rule, elsewhere counts, the wait fraction
// — is covered against real data in `src/lib/needs-you-inbox.test.ts` and
// `src/lib/needs-you-seen.test.ts`. What this file pins is the set of decisions
// that live in the markup, where a regression would be silent: the rules a
// future edit is most likely to undo without noticing.

const source = readFileSync(new URL("./needs-you-popover.tsx", import.meta.url), "utf8");
const styles = readFileSync(
  new URL("../styles/needs-you-inbox.css", import.meta.url),
  "utf8",
);

// ── Derivation stays in the model ────────────────────────────────────────────
// The component draws; it must not re-decide what needs you or in what order.
assert.match(
  source,
  /from "@\/lib\/needs-you-inbox"/,
  "rows come from the pure model, not from a filter written here",
);
assert.doesNotMatch(
  source,
  /\.sort\(/,
  "ordering belongs to needsYouItems — a second sort here could silently disagree with it",
);

// ── The panel is opaque ──────────────────────────────────────────────────────
// The handoff's third P0 finding is drawer transcript text reading THROUGH this
// popover. Glass here would reintroduce exactly that.
assert.doesNotMatch(source, /glass-overlay/, "the panel never uses the glass treatment");
assert.match(
  styles,
  /\.ui-popover\.needs-you-panel \{[^}]*background: var\(--bg-elevated\)/s,
  "the panel paints an opaque --bg-elevated",
);
// Overriding `background` alone is not enough: the base .ui-popover carries a
// backdrop blur, which still composites whatever sits under the panel.
assert.match(
  styles,
  /\.ui-popover\.needs-you-panel \{[^}]*backdrop-filter: none/s,
  "the base popover's backdrop blur is cancelled explicitly",
);
// Qualified with .ui-popover so it beats the base rule whatever the sheet
// order — this sheet is deliberately outside the globals facade.
assert.doesNotMatch(
  styles,
  /^\.needs-you-panel \{/m,
  "the panel rule stays qualified rather than relying on load order",
);

// ── Row tint is spent on awaiting and blocked ONLY ───────────────────────────
// A row-wide red field across every failure is the alarm wall this redesign
// retires. Failed keeps a badge and an edge; it must not get a background.
for (const state of ["awaiting", "blocked"]) {
  assert.match(
    styles,
    new RegExp(
      `\\.needs-you-row\\[data-lifecycle="${state}"\\] \\{[^}]*background: color-mix\\(`,
      "s",
    ),
    `${state} rows carry a tinted field`,
  );
}
{
  const failedRule = /\.needs-you-row\[data-lifecycle="failed"\] \{([^}]*)\}/.exec(styles);
  assert.ok(failedRule, "the failed row declares its tint token");
  assert.doesNotMatch(
    failedRule[1],
    /background:/,
    "failed carries a badge and an edge, never a row-wide field",
  );
}

// ── Every colour derives from one solid token ────────────────────────────────
// No hardcoded hex may reach render: the panel has to survive 12 palettes × 2
// modes. (Shadow alphas on black are the documented exception.)
assert.doesNotMatch(
  styles.replace(/rgb\(0 0 0 \/ [^)]*\)/g, ""),
  /#[0-9a-fA-F]{3,8}\b/,
  "no hardcoded colour in the stylesheet",
);
assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/, "no hardcoded colour in the component");

// ── The badge counts actionable work only ────────────────────────────────────
assert.match(
  source,
  /count > 0 \? \(/,
  "the badge renders only when something needs you — a permanent count is not a signal",
);
assert.match(source, /count > 99 \? "99\+"/, "the badge caps at 99 per spec §6");
assert.match(
  source,
  /`Needs you, \$\{count\} \$\{count === 1 \? "item" : "items"\}`/,
  "the exact count survives the 99+ cap in the accessible name",
);
// One trigger in every state: rendering a separate zero-state button would
// remount the element `anchorRef` positions the panel against.
assert.equal(
  source.match(/ref=\{anchorRef\}/g)?.length,
  1,
  "exactly one element carries the popover anchor",
);

// ── Running is text in the footer, never a badge ─────────────────────────────
assert.match(
  source,
  /needs-you-foot__stat"\s+data-tone="running"\s*>\s*\n?\s*\{runningCount\} running/,
  "the running count is footer text",
);
assert.doesNotMatch(
  source,
  /needs-you-trigger__badge[\s\S]{0,200}runningCount/,
  "the trigger badge never shows the running total",
);

// ── Accessibility ────────────────────────────────────────────────────────────
// Colour is never the only channel: every state ships a glyph AND the word.
assert.match(
  source,
  /const STATE_ICON: Record<NeedsYouLifecycle, IconName> = \{[\s\S]*?blocked:[\s\S]*?failed:[\s\S]*?awaiting:[\s\S]*?\}/,
  "each state has its own glyph",
);
assert.match(
  source,
  /\{presentation\.label\}/,
  "the row writes the state's one canonical word",
);
assert.match(
  source,
  /aria-label=\{`\$\{item\.title\} — \$\{presentation\.label\}/,
  "the row's accessible name leads with the title and the state",
);
assert.match(source, /focus-ring/, "interactive elements carry a focus ring");
assert.match(
  source,
  /announce\(/,
  "marking items seen is announced — it mutates the list without moving focus",
);

// ── Reduced motion and reduced transparency both change output ───────────────
assert.match(
  styles,
  /@media \(prefers-reduced-motion: reduce\)/,
  "a reduced-motion story exists",
);
assert.match(
  styles,
  /@media \(prefers-reduced-transparency: reduce\)/,
  "tints resolve against an opaque base under reduced transparency",
);

// ── Its own sheet, component-imported ────────────────────────────────────────
// The root CSS bundle runs at zero headroom; only routes that mount this pay.
assert.match(
  source,
  /import "@\/styles\/needs-you-inbox\.css"/,
  "the component imports its own stylesheet",
);
{
  const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.doesNotMatch(
    globals,
    /needs-you-inbox\.css/,
    "the sheet stays off the globals facade (see CLAUDE.md, new surface CSS)",
  );
}
