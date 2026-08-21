// @ts-nocheck
// Parity gate for the siderail's shared header (scope switcher + New chat).
//
// Home (SidebarMinimal) and Chat (WorkspaceSidebar) are separate components
// with separate stylesheets. For a long time each declared this header's chrome
// by hand, and the only parity contract was a `/* Matches .cnav__new on the
// Chat rail */` comment — so the copies drifted: a hardcoded 10px radius
// against var(--radius-control) (themes.css moves that token to 7/12/16/18px),
// --text-sm against --text-base, 32px against 34px. Toggling Home <-> Chat
// visibly restyled controls that never move.
//
// No existing gate could catch that: every drifted value was token-legal, and
// the design lint / codemod / drift-ratchet check that values come from the
// scale — never that two components which must look identical picked the SAME
// value. This file is that missing check. It asserts the structure (one
// component, one namespace, one panel surface) rather than the numbers, so it
// keeps holding as the design evolves.
//
// See docs/specs/2026-08-06-sidebar-rail-parity-design.md.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const railHeader = read("./sidebar-rail-header.tsx");
const homeSidebar = read("./sidebar-minimal.tsx");
const chatSidebar = read("./workspace-sidebar.tsx");
const railHeaderCss = read("../styles/globals/rail-header.css");
const workspaceContextSwitcherCss = read("../styles/globals/workspace-context-switcher.css");
const homeCss = read("../styles/sidebar-minimal/shell-chrome.css");
const sectionTabsCss = read("../styles/sidebar-minimal/section-tabs.css");
const homeRailCss = read("../styles/sidebar-minimal/activity-rail.css");
const chatCss = read("../styles/globals/shell-navigation.css");
const globals = read("../app/globals.css");

// ── One component, rendered by both sections ─────────────────────────────────
for (const [name, sidebar] of [
  ["Home", homeSidebar],
  ["Chat", chatSidebar],
]) {
  assert.match(
    sidebar,
    /import \{ SidebarRailHeader \} from "@\/components\/sidebar-rail-header";/,
    `the ${name} rail imports the shared header instead of building its own`,
  );
  assert.match(sidebar, /<SidebarRailHeader/, `the ${name} rail renders the shared header`);
}

// The switcher and the primary action must not be re-mounted directly by either
// sidebar — that is exactly how the two forked in the first place.
assert.doesNotMatch(
  homeSidebar,
  /<FamiliarQuickSwitch|<FamiliarSwitcher/,
  "the Home rail reaches the familiar switcher only through the shared header",
);
assert.doesNotMatch(
  chatSidebar,
  /<FamiliarSwitcher/,
  "the Chat rail reaches the familiar switcher only through the shared header",
);

// Neither sidebar mounts ProjectPicker directly — both reach it through WorkspaceContextSwitcher.
assert.doesNotMatch(homeSidebar, /<ProjectPicker/, "the Home rail does not mount ProjectPicker directly");
assert.doesNotMatch(chatSidebar, /<ProjectPicker/, "the Chat rail does not mount ProjectPicker directly");

// The shared header now owns WorkspaceContextSwitcher and does NOT mount
// FamiliarSwitcher directly — the composition is WorkspaceContextSwitcher's job.
assert.match(
  railHeader,
  /import \{ WorkspaceContextSwitcher \} from "@\/components\/workspace-context-switcher";/,
  "the shared header imports WorkspaceContextSwitcher",
);
assert.match(railHeader, /<WorkspaceContextSwitcher/, "the shared header renders WorkspaceContextSwitcher");
assert.doesNotMatch(
  railHeader,
  /<FamiliarSwitcher/,
  "the shared header delegates to WorkspaceContextSwitcher, not FamiliarSwitcher directly",
);

// Chat's ⌘N hint rides the shared button's trailing slot rather than forking it.
assert.match(
  chatSidebar,
  /newChatTrailing=\{<kbd className="rail-header__new-kbd">⌘N<\/kbd>\}/,
  "Chat's shortcut hint uses the shared header's trailing slot, not a forked button",
);
assert.match(
  railHeader,
  /\{newChatTrailing\}/,
  "the shared button renders whatever trailing content its host supplies",
);

// ── One namespace, declared once ────────────────────────────────────────────
assert.match(globals, /@import "\.\.\/styles\/globals\/rail-header\.css";/, "the shared sheet is imported");
assert.match(
  globals,
  /@import "\.\.\/styles\/globals\/workspace-context-switcher\.css";/,
  "the workspace context switcher sheet is imported",
);

for (const [name, css] of [
  ["Home", homeCss + homeRailCss],
  ["Chat", chatCss],
]) {
  // Selectors only — both sheets carry prose pointing at rail-header.css.
  assert.doesNotMatch(
    css,
    /^[^\r\n]*\.rail-header[\w-]*[^\r\n]*\{/m,
    `the ${name} sheet does not override the shared header — one declaration is the point`,
  );
}

// The retired forks must stay retired; re-adding one is the regression.
assert.doesNotMatch(
  homeCss + homeRailCss,
  /^[^\r\n]*(\.sidebar-familiar-switch\b|\.sidebar-actions:not\(\.sidebar-actions--footer\))[^\r\n]*\{/m,
  "the Home rail's forked switcher and New-chat CTA styles stay retired",
);
assert.doesNotMatch(
  chatCss,
  /^[^\r\n]*(\.cnav__switcher\b|\.cnav__quick\b|\.cnav__new\b)[^\r\n]*\{/m,
  "the Chat rail's forked header styles stay retired",
);

// ── The parity-critical properties resolve from the shared rule ─────────────
// Selector-specific layout for the crew/project triggers moved from
// rail-header.css into workspace-context-switcher.css (Task 5). The New-chat
// rule stays in rail-header.css unchanged.
const scopeRule =
  workspaceContextSwitcherCss.match(
    /\.workspace-context-switcher__crew \.familiar-switcher__trigger--labeled \{[\s\S]*?\n\}/,
  )?.[0] ?? "";
const newRule = railHeaderCss.match(/\.rail-header__new \{[\s\S]*?\n\}/)?.[0] ?? "";

assert.notEqual(scopeRule, "", "the shared scope-trigger rule exists");
assert.notEqual(newRule, "", "the shared New-chat rule exists");

// Radius comes from the token, never a literal. themes.css moves
// --radius-control to 7/12/16/18px across palettes, so a hardcoded px value
// here silently diverges on most of the 42 theme combinations — which is the
// exact bug this file exists to prevent.
for (const [label, rule] of [
  ["scope trigger", scopeRule],
  ["New chat", newRule],
]) {
  assert.match(rule, /border-radius: var\(--radius-control\);/, `the ${label} takes its radius from the token`);
  assert.doesNotMatch(rule, /border-radius:\s*\d+px/, `the ${label} does not hardcode a radius`);
  // min-height, not height: the control has to grow with a longer label or a
  // larger touch target rather than clipping. The value is the shared rail
  // constant, so these two controls are also the same box as their own
  // collapsed-rail squares and as the nav rows below (#4351).
  assert.match(
    rule,
    /min-height: var\(--rail-control\);/,
    `the ${label} shares the rail control height`,
  );
  assert.doesNotMatch(rule, /\n\s*height:\s*\d+px/, `the ${label} does not pin a fixed height`);
  // Border-compensated leading padding: both are bordered boxes, and their
  // glyphs have to land on the same icon column as the border-less nav rows.
  assert.match(
    rule,
    /padding: 0 calc\(var\(--rail-lead\) - 1px\);/,
    `the ${label} leads its glyph from the shared icon column`,
  );
}

assert.match(newRule, /font-size: var\(--text-base\);/, "the New chat label uses the rail's base type size");
assert.match(
  workspaceContextSwitcherCss,
  /\.workspace-context-switcher__crew \.familiar-switcher__trigger-label \{[\s\S]*?font-size: var\(--text-base\);/,
  "the scope trigger's label uses the same base type size as the button below it",
);
assert.match(
  scopeRule,
  /border: 1px solid var\(--border-hairline\);/,
  "the scope selector uses a quiet hairline instead of a heavy accent outline",
);
assert.match(
  scopeRule,
  /background: var\(--bg-subtle\);/,
  "the scope selector rests on the rail's subtle surface",
);
assert.match(
  sectionTabsCss,
  /\.nav-sections \{[\s\S]*?background: transparent;[\s\S]*?border: 0;/,
  "the Home and Chat switcher integrates into the rail instead of floating in another card",
);

// ── One panel surface and one content inset ─────────────────────────────────
// The rail's background belongs to the shared .shell-nav ancestor; both
// sections render transparent over it, so toggling cannot change the shade.
assert.match(chatCss, /--rail-pad: 4px;/, "the rail declares one content inset on the shared ancestor");
// The inset is not a free choice: it is what puts the expanded panel's icon
// column exactly where the collapsed rail centres its squares (#4351).
assert.match(chatCss, /--rail-lead: 8px;/, "the rail declares one leading padding for its controls");
assert.match(chatCss, /--rail-control: 32px;/, "the rail declares one control box size");
assert.match(
  chatCss,
  /\.cnav \{[\s\S]*?--cnav-pad: var\(--rail-pad\);/,
  "the Chat section derives its inset from the shared token",
);
assert.match(railHeaderCss, /padding: 0 var\(--rail-pad\);/, "the shared header sits at the shared inset");
assert.match(
  homeCss,
  /\.sidebar-minimal \{[\s\S]*?background: transparent;/,
  "the Home section paints no panel background of its own",
);
assert.match(
  chatCss,
  /\.cnav \{[\s\S]*?background: transparent;/,
  "the Chat section paints no panel background of its own",
);

// ── One vertical rhythm ─────────────────────────────────────────────────────
// Matching horizontal insets are not enough: the rail also has to START at the
// same offset and space its bands the same way in both rooms, or it jumps
// vertically on every Home/Chat toggle. Two separate regressions came from
// exactly this — .sidebar-minimal carried `gap: 10px` (a blanket column gap
// between every band, which .cnav has no equivalent of) and `padding: 10px 0`
// (which pushed Home's whole column down). Neither container may reintroduce
// either; vertical spacing belongs to the SHARED bands.
const homeContainer = homeCss.match(/^\.sidebar-minimal \{[\s\S]*?\n\}/m)?.[0] ?? "";
const chatContainer = chatCss.match(/^\.cnav \{[\s\S]*?\n\}/m)?.[0] ?? "";
assert.notEqual(homeContainer, "", "the Home rail container rule exists");
assert.notEqual(chatContainer, "", "the Chat rail container rule exists");

// Parse the declared values rather than pattern-matching them — a lookahead
// after `\s*` backtracks and quietly passes.
function declared(rule, prop) {
  const m = rule.match(new RegExp(`\\n\\s*${prop}:([^;]*);`));
  return m ? m[1].trim() : null;
}
const ZERO = /^0(px)?$/;

for (const [name, rule] of [
  ["Home", homeContainer],
  ["Chat", chatContainer],
]) {
  const gap = declared(rule, "gap");
  assert.ok(
    gap === null || ZERO.test(gap),
    `the ${name} rail container declares no column gap (found "${gap}") — the shared bands own their spacing`,
  );
  // Block padding shifts the whole column; a horizontal-only shorthand is fine.
  const pad = declared(rule, "padding");
  const blockPad = pad === null ? "0" : pad.split(/\s+/)[0];
  assert.ok(
    ZERO.test(blockPad),
    `the ${name} rail container declares no block padding (found "${pad}") — both rails start at the same offset`,
  );
  for (const prop of ["padding-block", "padding-top", "padding-bottom"]) {
    const v = declared(rule, prop);
    assert.ok(v === null || ZERO.test(v), `the ${name} rail container sets no ${prop} (found "${v}")`);
  }
}

// The spacing under the header is declared once, on the shared header itself.
assert.match(
  railHeaderCss,
  /\.rail-header \{[\s\S]*?margin-bottom: var\(--space-2\);/,
  "the shared header owns the gap beneath it in both rooms",
);

// ── Design-system hygiene ───────────────────────────────────────────────────
assert.doesNotMatch(railHeaderCss, /#[0-9a-fA-F]{3,8}\b/, "no hardcoded colors in the shared header styles");
assert.match(railHeaderCss, /\.shell-nav--rail \.rail-header/, "the shared header has a collapsed-rail story");
assert.match(railHeaderCss, /@media \(max-width: 1023px\)/, "the shared header meets the mobile touch target");
assert.match(railHeader, /className="rail-header__new focus-ring"/, "the primary action carries the shared focus ring");

// ── createProjectOrThrow: optional, no throwing default ─────────────────────
// Task 6 callers will provide this; before Task 6 the prop is simply absent
// (undefined). A throwing default in the component itself would fire at the
// first render whenever the caller omits it, which is exactly what the
// transitional period requires not happen.
assert.doesNotMatch(
  railHeader,
  /createProjectOrThrow\s*=\s*async[\s\S]*?throw new Error/,
  "SidebarRailHeader must not inject a throwing default for createProjectOrThrow",
);
// The type declares it optional (?:); the destructuring carries no default so
// the prop is genuinely undefined when the caller omits it.
assert.match(
  railHeader,
  /createProjectOrThrow\?:/,
  "createProjectOrThrow is declared optional in SidebarRailHeaderProps",
);
assert.doesNotMatch(
  railHeader,
  /createProjectOrThrow\s*=\s*(async\s*)?\(/,
  "createProjectOrThrow destructuring carries no default value",
);
// The optional prop threads through to WorkspaceContextSwitcher unchanged.
assert.match(
  railHeader,
  /createProjectOrThrow=\{createProjectOrThrow\}/,
  "the optional createProjectOrThrow is passed through to WorkspaceContextSwitcher",
);

// ── Module-level stable identities — no render-local allocations ─────────────
// Arrays/sets/functions created during render have a new identity on every call,
// forcing downstream consumers to re-render needlessly. All stable fallbacks for
// Task6 props must be module-level constants, never inline defaults.
assert.match(
  railHeader,
  /^const EMPTY_PROJECTS: CaveProject\[\] = \[\];/m,
  "EMPTY_PROJECTS is a module-level stable constant",
);
assert.match(
  railHeader,
  /^const EMPTY_CREW: ResolvedFamiliar\[\] = \[\];/m,
  "EMPTY_CREW is a module-level stable constant",
);
assert.match(
  railHeader,
  /^const EMPTY_SELECTED_FAMILIAR_IDS: ReadonlySet<string> = new Set<string>\(\);/m,
  "EMPTY_SELECTED_FAMILIAR_IDS is a module-level stable constant",
);
assert.doesNotMatch(
  railHeader,
  /onProjectChange\s*=\s*\(\s*\)\s*=>/,
  "onProjectChange must not have an inline arrow-function default — use the module-level NOOP",
);
assert.doesNotMatch(
  railHeader,
  /reloadProjects\s*=\s*\(\s*\)\s*=>/,
  "reloadProjects must not have an inline arrow-function default — use the module-level NOOP",
);
assert.doesNotMatch(
  railHeader,
  /selectedFamiliarIds \?\? new Set\(\)/,
  "selectedFamiliarIds must not fall back to an inline new Set() — use EMPTY_SELECTED_FAMILIAR_IDS",
);
assert.match(
  railHeader,
  /selectedFamiliarIds \?\? EMPTY_SELECTED_FAMILIAR_IDS/,
  "selectedFamiliarIds falls back to the stable module-level constant",
);

// ── workspaceContextReady: Task6 readiness fail-closed ──────────────────────
// The component detects when Task6 callers have wired all required props.
// Until then both controls are forced loading so no fake no-op selector appears.
assert.match(
  railHeader,
  /const workspaceContextReady/,
  "workspaceContextReady is derived to detect Task6 prop wiring",
);
assert.match(
  railHeader,
  /projects !== undefined/,
  "readiness requires projects to be supplied",
);
assert.match(
  railHeader,
  /projectId !== undefined/,
  "readiness requires projectId to be supplied (null is ok, undefined is not)",
);
// createProjectOrThrow must NOT be part of readiness — creation can be unavailable.
assert.doesNotMatch(
  railHeader,
  /createProjectOrThrow !== undefined/,
  "createProjectOrThrow must not appear in the workspaceContextReady check",
);
// Both controls are forced loading when context is not ready.
assert.match(
  railHeader,
  /projectLoading=\{!workspaceContextReady/,
  "project control is forced loading when context is not ready",
);
assert.match(
  railHeader,
  /projectCrewLoading=\{!workspaceContextReady/,
  "crew control is forced loading when context is not ready",
);

// ── Crew trigger border: quiet rail chrome ───────────────────────────────────
assert.match(
  workspaceContextSwitcherCss,
  /border: 1px solid var\(--border-hairline\)/,
  "crew trigger border uses the quiet rail hairline",
);
assert.doesNotMatch(
  workspaceContextSwitcherCss,
  /border: 2px solid var\(--accent-presence\)/,
  "crew trigger must not use the old 2px solid accent border",
);

// ── No raw 10px gaps in workspace-context-switcher.css ──────────────────────
assert.doesNotMatch(
  workspaceContextSwitcherCss,
  /\bgap:\s*10px\b/,
  "workspace-context-switcher.css gap uses spacing tokens, not raw 10px",
);

// ── Collapsed caret: stable class, not generated icon class ─────────────────
assert.match(
  workspaceContextSwitcherCss,
  /cave-project-picker__trigger-caret/,
  "collapsed CSS targets the stable caret class",
);
assert.doesNotMatch(
  workspaceContextSwitcherCss,
  /\.ph-caret-up-down-bold/,
  "collapsed CSS must not target the generated icon class name — use the stable caret class",
);
