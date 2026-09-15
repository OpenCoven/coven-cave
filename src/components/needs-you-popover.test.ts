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

// The surface is split in two on purpose: the trigger is always-mounted menu
// bar chrome, the panel loads on first open. Each half is asserted against its
// own file so a rule cannot quietly migrate into the eager half.
const source = readFileSync(new URL("./needs-you-popover.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./needs-you-panel.tsx", import.meta.url), "utf8");
const styles = readFileSync(
  new URL("../styles/needs-you-inbox.css", import.meta.url),
  "utf8",
);
const triggerStyles = readFileSync(
  new URL("../styles/needs-you-trigger.css", import.meta.url),
  "utf8",
);

// ── The panel is loaded on demand ────────────────────────────────────────────
// Measured: importing the panel's sheet eagerly cost 6.1 KB of first-load CSS
// against 20.2 KB of headroom, on a budget that warns THIN below ~15 KB.
assert.match(
  source,
  /dynamic\(\(\) => import\("@\/components\/needs-you-panel"\)/,
  "the panel is dynamically imported, so its CSS is not paid for on first paint",
);
assert.doesNotMatch(
  source,
  /needs-you-inbox\.css/,
  "the trigger must not import the panel sheet — that is what puts it in first-load CSS",
);
assert.match(
  panel,
  /import "@\/styles\/needs-you-inbox\.css"/,
  "the panel owns the heavy sheet",
);
assert.match(
  source,
  /import "@\/styles\/needs-you-trigger\.css"/,
  "the trigger keeps only its own small sheet",
);
assert.ok(
  triggerStyles.length < styles.length,
  "the eagerly-loaded sheet stays the smaller of the two",
);

// ── Derivation stays in the model ────────────────────────────────────────────
// The component draws; it must not re-decide what needs you or in what order.
assert.match(
  source,
  /from "@\/lib\/needs-you-inbox"/,
  "rows come from the pure model, not from a filter written here",
);
for (const [name, text] of [["trigger", source], ["panel", panel]] as const) {
  assert.doesNotMatch(
    text,
    /\.sort\(/,
    `ordering belongs to needsYouItems — a second sort in the ${name} could silently disagree with it`,
  );
}

// ── The panel is opaque ──────────────────────────────────────────────────────
// The handoff's third P0 finding is drawer transcript text reading THROUGH this
// popover. Glass here would reintroduce exactly that.
assert.doesNotMatch(panel, /glass-overlay/, "the panel never uses the glass treatment");
assert.match(
  styles,
  /\.ui-popover\.needs-you-panel \{[^}]*background: var\(--bg-elevated\)/,
  "the panel paints an opaque --bg-elevated",
);
// Overriding `background` alone is not enough: the base .ui-popover carries a
// backdrop blur, which still composites whatever sits under the panel.
assert.match(
  styles,
  /\.ui-popover\.needs-you-panel \{[^}]*backdrop-filter: none/,
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
assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/, "no hardcoded colour in the trigger");
assert.doesNotMatch(panel, /#[0-9a-fA-F]{6}\b/, "no hardcoded colour in the panel");
assert.doesNotMatch(
  triggerStyles.replace(/rgb\(0 0 0 \/ [^)]*\)/g, ""),
  /#[0-9a-fA-F]{3,8}\b/,
  "no hardcoded colour in the trigger sheet",
);

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
  panel,
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
  panel,
  /const STATE_ICON: Record<NeedsYouLifecycle, IconName> = \{[\s\S]*?blocked:[\s\S]*?failed:[\s\S]*?awaiting:[\s\S]*?\}/,
  "each state has its own glyph",
);
assert.match(
  panel,
  /\{presentation\.label\}/,
  "the row writes the state's one canonical word",
);
// The row carries NO explicit aria-label, and that is the fix rather than an
// omission. An aria-label REPLACES a button's descendant name, so labelling
// the row suppressed the wait — the very thing the list is ordered by — from
// assistive tech while leaving it on screen. Composed from visible content the
// name reads title · metadata · state · "4d waiting".
assert.doesNotMatch(
  panel,
  /aria-label=\{`\$\{item\.title\}/,
  "the row name composes from visible content, so the wait is announced too",
);
assert.match(
  panel,
  /<RelativeTime iso=\{item\.since\}[\s\S]{0,80}?waiting/,
  "the wait is real text inside the button, which is what makes it nameable",
);
assert.match(source, /focus-ring/, "the trigger carries a focus ring");
assert.match(panel, /focus-ring/, "the panel's interactive elements carry a focus ring");
assert.match(
  source,
  /announce\(/,
  "marking items seen is announced — it mutates the list without moving focus",
);

// ── An advertised shortcut must actually do something ────────────────────────
// The trigger's tooltip names ⇧⌘A. A hint that performs no action is the same
// defect ⌘, was wired to fix in workspace.tsx.
{
  const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
  const catalog = readFileSync(
    new URL("../lib/keyboard-shortcuts.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /⇧⌘A/, "the trigger advertises the shortcut");
  assert.match(
    source,
    /window\.addEventListener\(NEEDS_YOU_OPEN_EVENT/,
    "the popover listens for the open request",
  );
  assert.match(
    workspace,
    /e\.shiftKey && !alt && e\.key\.toLowerCase\(\) === "a"[\s\S]{0,200}?NEEDS_YOU_OPEN_EVENT/,
    "the workspace binds ⇧⌘A and dispatches the open request",
  );
  assert.match(
    catalog,
    /keys: "⇧⌘A"/,
    "the shortcut is catalogued, per that file's own truthfulness rule",
  );
}

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

{
  const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const sheet of ["needs-you-inbox.css", "needs-you-trigger.css"]) {
    assert.ok(
      !globals.includes(sheet),
      `${sheet} stays off the globals facade (see the design contract, new surface CSS)`,
    );
  }
}
