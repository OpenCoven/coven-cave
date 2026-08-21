// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./workspace-context-switcher.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("../styles/globals/workspace-context-switcher.css", import.meta.url),
  "utf8",
);

assert.match(source, /<ProjectPicker/, "project is the first context control");
assert.match(source, /allProjectsLabel="All projects"/, "the shell exposes operator scope");
assert.match(source, /<FamiliarSwitcher/, "familiar identity remains visible");
assert.match(source, /familiars=\{projectId \? projectCrew : allFamiliars\}/);
assert.match(source, /aggregateLabel=\{projectId \? "Project crew" : "All familiars"\}/);
assert.match(
  source,
  /aggregateDescription=\{projectId \? `\$\{projectCrew\.length\} with access` : undefined\}/,
);
assert.match(
  source,
  /disabled=\{projectLoading \|\| Boolean\(projectError\)\}/,
  "project selection fails closed while the registry is unavailable",
);
assert.match(source, /disabled=\{projectCrewLoading \|\| Boolean\(projectCrewError\)\}/);
// A selected-but-unverified project context must never fall back to the global familiar pool.
assert.doesNotMatch(source, /familiars=\{project \? projectCrew : allFamiliars\}/);
assert.match(source, /role="alert"/, "crew load failure is visible");
assert.match(source, /onClick=\{reloadProjects\}/, "project registry failure can retry");
assert.match(source, /onClick=\{reloadProjectCrew\}/, "crew load failure can retry");
assert.match(source, /No familiars have access to this project/, "empty crew is explicit");
assert.match(source, /role="note"/, "non-pilot context notices are explicit");
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "styles use tokens only");
assert.match(css, /\.shell-nav--rail \.workspace-context-switcher/, "collapsed rail is explicit");

// ── Project ordering: ProjectPicker must appear before FamiliarSwitcher ─────
const projectIndex = source.indexOf("<ProjectPicker");
const familiarIndex = source.indexOf("<FamiliarSwitcher");
assert.ok(projectIndex < familiarIndex, "project picker renders before familiar switcher");

// ── No raw 10px gaps — spacing must use tokens ──────────────────────────────
assert.doesNotMatch(css, /\bgap:\s*10px\b/, "CSS gap uses spacing tokens, not raw 10px");

// ── Crew trigger: quiet 1px hairline at rest, presence accent on hover ───────
// The recipe moved in the desktop chrome refresh (#4791): the resting border is
// now the plain --border-hairline token over --bg-subtle, and --accent-presence
// marks the control on hover instead of tinting it permanently. That direction
// is the design language's ("the accent is presence first... never for
// secondary buttons, links, or decorative colour"), so the contract — not the
// old color-mix spelling — is what this pin guards: a 1px border whose colour
// comes from the hairline token, and the presence accent still identifying the
// familiar control on interaction. Scoped to the crew rule so a hairline border
// elsewhere in the sheet cannot satisfy it.
const crewTriggerRule = css.match(
  /^\.workspace-context-switcher__crew \.familiar-switcher__trigger--labeled \{[\s\S]*?\n\}/m,
)?.[0];
assert.ok(crewTriggerRule, "crew trigger rule is present");
const crewBorder = crewTriggerRule.match(/\n\s*border:\s*([^;]+);/)?.[1];
assert.ok(crewBorder, "crew trigger declares a border");
assert.match(crewBorder, /^1px solid\b/, "crew trigger border is exactly 1px solid");
assert.match(
  crewBorder,
  /var\(--border-hairline\)/,
  "crew trigger border colour comes from the --border-hairline token",
);

const crewHoverRule = css.match(
  /^\.workspace-context-switcher__crew \.familiar-switcher__trigger--labeled:hover \{[\s\S]*?\n\}/m,
)?.[0];
assert.ok(crewHoverRule, "crew trigger hover rule is present");
assert.match(
  crewHoverRule,
  /var\(--accent-presence\)/,
  "the presence accent marks the crew trigger on hover",
);

// ── Collapsed caret selector targets the stable class, not a generated icon class ──
assert.match(
  css,
  /cave-project-picker__trigger-caret/,
  "collapsed CSS targets the stable caret class",
);
assert.doesNotMatch(
  css,
  /\.ph-caret-up-down-bold/,
  "collapsed CSS must not target generated icon class name",
);

// ── createProjectOrThrow is optional — no synthetic throwing default ─────────
assert.match(
  source,
  /createProjectOrThrow\?:/,
  "createProjectOrThrow is optional in WorkspaceContextSwitcherProps",
);
// No throwing default should be injected here — it belongs only in callers that have it
assert.doesNotMatch(
  source,
  /createProjectOrThrow.*=.*async.*throw new Error/s,
  "no synthetic throwing default in WorkspaceContextSwitcher",
);

// createProjectOrThrow is passed through to ProjectPicker as optional prop
assert.match(
  source,
  /createProjectOrThrow=\{createProjectOrThrow\}/,
  "optional createProjectOrThrow is threaded through to ProjectPicker",
);

// ── .workspace-context-switcher fills its scope container ───────────────────
assert.match(
  css,
  /\.workspace-context-switcher \{[\s\S]*?width:\s*100%;/,
  ".workspace-context-switcher has width:100% so it fills the rail-header scope container",
);

// ── Retry button accessible names ───────────────────────────────────────────
// The two Retry buttons have the same visible label; each must carry a distinct
// aria-label so AT users can tell them apart without visual context.
assert.match(
  source,
  /aria-label="Retry loading projects"/,
  "project retry button has a distinct accessible name",
);
assert.match(
  source,
  /aria-label="Retry loading project crew"/,
  "crew retry button has a distinct accessible name",
);

console.log("workspace context switcher contract passed");
