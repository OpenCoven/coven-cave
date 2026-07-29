// @ts-nocheck
// ProjectSetupModal — the in-place "register this ad-hoc folder" flow (spec
// 2026-07-24). It must explain what registering entails, default the chat's
// familiar to write (the chat needs to keep running here) and groups to no
// access, honor Supreme's all-access status, and sequence create → familiar
// grant → group patches with a single registry emit — retrying after a
// partial failure without duplicating the project.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./project-setup-modal.tsx", import.meta.url), "utf8");

// ── Explains what registering entails ──────────────────────────────────────
assert.match(src, /Registering makes this folder a project across the Cave/, "explainer copy present");
assert.match(src, /Familiars can only work in a project after you grant access/, "grant model explained");
assert.match(src, /changed later in Projects and Permissions/, "reversibility called out");

// ── Preference defaults ─────────────────────────────────────────────────────
assert.match(src, /useState<AccessChoice>\("write"\)/, "familiar access defaults to write");
assert.match(src, /groupLevels\[group\.id\] \?\? "none"/, "groups default to no access");
assert.match(src, /familiar\.id === supremeFamiliarId/, "Supreme is detected and grant-skipped");
assert.match(src, /has access to every project/, "Supreme renders as all-access, not a select");

// ── Submit sequence ─────────────────────────────────────────────────────────
assert.match(src, /emitMutation: false/, "creation suppresses its own emit (single fan-out)");
assert.match(src, /"\/api\/project-grants"/, "familiar grant goes to the grants route");
assert.match(src, /targetFamiliarId: familiar\.id/, "grant sends targetFamiliarId (never familiarId)");
assert.match(src, /`\/api\/access-groups\/\$\{group\.id\}`/, "group grants PATCH each group");
assert.match(
  src,
  /\.filter\(\(grant\) => grant\.projectId !== project\.id\)/,
  "group patch replaces any same-project grant instead of duplicating",
);
assert.match(src, /emitProjectRegistryMutation\(\)/, "registry listeners get refreshed");
assert.match(src, /setCreatedProject\(project\)/, "retry after partial failure skips re-creation");

// ── Prefill + validation ────────────────────────────────────────────────────
assert.match(src, /&remote=1/, "GitHub prefill probes the changes remote endpoint");
assert.match(src, /normalizeGitHubRepoUrl/, "repo input validates through the shared normalizer");
assert.match(src, /current\.trim\(\) \? current : /, "prefill never clobbers what the user typed");

// ── Primitives + a11y ───────────────────────────────────────────────────────
assert.match(src, /<Modal\b/, "built on the shared Modal (focus trap + return)");
assert.match(src, /dismissOnBackdrop=\{!busy\}/, "backdrop dismiss is blocked mid-submit");
assert.match(
  src,
  /dismissOnEscape=\{!busy\}/,
  "Escape dismiss is blocked mid-submit too (cave-0g9u)",
);
assert.match(src, /useAnnouncer\(\)/, "completion is announced");
assert.match(src, /StandardSelect/, "access levels use the shared select primitive");
assert.match(src, /aria-pressed=/, "color swatches expose pressed state");
assert.match(src, /PROJECT_SETUP_COLOR_CHOICES/, "swatch palette comes from the lib, not render literals");

assert.match(
  src,
  /createProject: \(\s*name: string,\s*root: string,\s*options\?: CreateProjectOptions,\s*\) => Promise<CaveProject>;/,
  "the modal requires the throwing create variant so failures carry the server message",
);
assert.match(
  src,
  /error instanceof Error && error\.message\s*\?\s*error\.message/,
  "create failures surface the server's error body, not a generic guess",
);

// ── Live field validation (Projects.dc.html handoff) ───────────────────────
// The submit gate and the per-field messages must come from ONE module, or
// they drift and a field goes green on input the submit then rejects.
assert.match(
  src,
  /import \{[\s\S]{0,240}?projectSetupBlocked,[\s\S]{0,240}?\} from "@\/lib\/project-setup-validation"/,
  "field rules and the submit gate come from the shared validation module",
);
assert.match(
  src,
  /const blocked = projectSetupBlocked\(name, repoDraft\)/,
  "the submit gate is computed from the same inputs the fields validate",
);
assert.match(src, /disabled=\{blocked\}/, "Create is blocked while any field is invalid");
// Errors wait for a touch so an opening modal never greets you in red.
assert.match(
  src,
  /const \[touched, setTouched\]/,
  "field messages are gated on a touch, not shown from first render",
);
assert.match(
  src,
  /aria-invalid=\{touched\.name && nameError \? true : undefined\}/,
  "an invalid name is announced, not only coloured",
);
assert.match(
  src,
  /aria-describedby=\{touched\.repo && repoError \? "project-setup-repo-error" : undefined\}/,
  "the repo error is wired to its field for assistive tech",
);

// ── Repository suggester ───────────────────────────────────────────────────
assert.match(
  src,
  /fetch\("\/api\/github\/repos"/,
  "suggestions come from the existing repos route, not a new backend",
);
assert.match(
  src,
  /if \(!repoPickerOpen \|\| repos !== null \|\| reposState === "loading"\) return;/,
  "the repo list is fetched lazily on first open, never on mount",
);
assert.match(
  src,
  /data\?\.configured === false[\s\S]{0,160}?setReposState\("unconfigured"\)/,
  "a missing GitHub token says so instead of rendering an empty list",
);
assert.match(
  src,
  /applyRepoSuggestion\(repo, name\)/,
  "picking a suggestion routes through the shared fill rule",
);

console.log("project-setup-modal.test.ts OK");
