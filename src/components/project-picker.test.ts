// @ts-nocheck
// Project selection used to be four unrelated widgets (chat overflow popover,
// chat empty-state picker, home-composer picker, comux rail), and the only
// way to register a new root was to fail a send and click the 403 recovery.
// ProjectPicker is the one shared picker, and useAddProjectFlow the one shared
// add flow — folder dialog → addChatProject, which registers AND grants, so a
// freshly added project is immediately usable instead of 403ing in chat.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveProjectPickerSelection } from "../lib/project-picker-selection.ts";

const src = readFileSync(new URL("./project-picker.tsx", import.meta.url), "utf8");
const helperSrc = readFileSync(
  new URL("../lib/project-picker-selection.ts", import.meta.url),
  "utf8",
);
// The picker's CSS moved out of surface-marketplace.css when that sheet was
// code-split onto the Marketplace chunk (cave-ii7xi) — a shared picker used by
// the always-loaded shell cannot ship with a mode-gated surface.
const css = readFileSync(
  new URL("../styles/globals/shared-pickers-and-toasts.css", import.meta.url),
  "utf8",
);
const homeComposer = readFileSync(new URL("./home-composer.tsx", import.meta.url), "utf8");
const contextPill = readFileSync(new URL("./composer-context-pill.tsx", import.meta.url), "utf8");
const addMenu = readFileSync(new URL("./composer-add-menu.tsx", import.meta.url), "utf8");
const actionsMenu = readFileSync(new URL("./composer-actions-menu.tsx", import.meta.url), "utf8");

// ── One shared add flow: register + grant in a single human-initiated step ──
assert.match(src, /export function useAddProjectFlow\(/, "shared flow exported");
assert.match(src, /addChatProject\(\{/, "register+grant goes through the tested helper");
assert.match(src, /createProject\?: \(/, "the shared flow can rely on the throwing creator alone");
assert.match(src, /createProjectOrThrow: args\.createProjectOrThrow/, "the shared flow threads the throwing creation path");
assert.match(src, /const canAddProject = Boolean\(createProject \|\| createProjectOrThrow\)/, "a throwing-only creator still enables the shared add flow");
assert.match(src, /onAddProject=\{canAddProject \? addFlow\.beginAddProject : undefined\}/, "the picker exposes add when only the throwing creator is available");
assert.match(src, /shell_pick_directory/, "native folder dialog on desktop builds");
assert.match(src, /DirectoryPickerModal/, "web fallback directory browser");

// ── One shared picker: No project, project list, proactive Add project ──────
assert.match(src, /export function ProjectPicker\(/, "picker exported");
assert.match(src, /onChange\(NO_PROJECT_ID\);/, "explicit No-project row");
assert.match(src, /Add project…/, "proactive add affordance (not 403-recovery-only)");
assert.match(src, /aria-label="Filter projects"/, "typed project-name input is always available");
assert.doesNotMatch(
  src,
  /projects\.length > 6 \? \([\s\S]*?aria-label="Filter projects"/,
  "small project lists must not hide manual name entry",
);
assert.match(
  src,
  /projectForPickerQuery\(sortedProjects, query\)/,
  "Enter resolves through the shared exact-name-first matcher",
);
// Enter now goes through pick(), which records the frecency pick, calls
// onChange and closes (cave-ow9f) — same outcome, one path shared with
// clicking a row instead of a second inline copy.
assert.match(
  src,
  /event\.key !== "Enter"[\s\S]*?event\.preventDefault\(\);[\s\S]*?pick\(match\);/,
  "Enter selects the typed match",
);
assert.match(
  src,
  /const pick = \(project: \{ id: string; root: string \}\) => \{[\s\S]*?onChange\(project\.id\);\s*close\(\);/,
  "and pick() is what changes the selection and closes the picker",
);
assert.match(src, /aria-haspopup="dialog"/, "trigger announces the popover");
assert.match(src, /role="alert"/, "add-flow failures surface inline, not silently");
assert.match(src, /sortProjectsAlphabetically\(projects\)/, "picker renders projects alphabetically");
assert.doesNotMatch(src, /if \(!q\) return projects;/, "unfiltered picker must not expose raw API order");
assert.match(src, /projectAccessLabel/, "picker uses the shared Read/Full access copy");
assert.match(src, /cave-project-picker__option-access/, "every scoped project option renders access");
assert.match(
  src,
  /aria-label=\{`\$\{ariaLabel\}: \$\{selectedAccessibleLabel\}`\}/,
  "the picker trigger's accessible name includes the selected project's Read or Full access",
);
// Selection logic lives in the shared helper — check it there.
assert.match(
  helperSrc,
  /allowNoProject \? "No project" : "Choose project"/,
  "a required picker names the missing state as Choose project, not No project",
);
assert.match(
  helperSrc,
  /isStale[\s\S]{0,80}foundProject === null/,
  "an explicit stale picker value resolves to no project instead of silently selecting the first",
);
assert.match(
  helperSrc,
  /defaultToFirst \? \(sorted\[0\]/,
  "callers that require an explicit durable choice can keep null rendered as Choose project",
);
assert.match(src, /import \{ Button \}/, "picker trigger uses the shared Button primitive");

// cave-ocy8: clicking a project avatar opens the lightbox. The row avatar is
// expandable (shared AvatarLightbox), rendered as a SIBLING of the menuitem so
// the zoom button is never nested inside the row's select button.
assert.match(
  src,
  /<ProjectAvatar name=\{entry\.name\} root=\{entry\.root\} color=\{entry\.color\} size="sm" expandable \/>/,
  "picker rows' avatars are expandable — clicking peeks at the full-size project icon",
);
assert.match(src, /cave-project-picker__row/, "expandable avatar leads the row inside a presentation wrapper");
assert.doesNotMatch(src, /<button\b/, "picker should not hand-roll button controls");
assert.doesNotMatch(
  src,
  /rounded-md|rounded-lg|rounded(?=\s|")/,
  "picker should use shared CSS/tokenized radii instead of hard-coded rounded classes",
);

// ── Home composer: the shell rail owns project selection ────────────────────
assert.match(
  homeComposer,
  /<ComposerContextChips[\s\S]*?showProject=\{false\}/,
  "Home suppresses its redundant project picker while retaining model context",
);
assert.doesNotMatch(
  homeComposer,
  /plusAddProject|setSelectedProjectId/,
  "Home no longer owns a second add/select project flow",
);
assert.match(contextPill, /export type ComposerContextProps = \{/, "context props are reusable");
assert.match(
  contextPill,
  /export function useComposerContextActions\(/,
  "context derivation is reusable outside the Home pill wrapper",
);
assert.match(contextPill, /export function ComposerContextPickers\(/, "picker siblings are reusable");
assert.match(contextPill, /const context = useComposerContextActions\(props\);/, "the pill wrapper still builds one shared context controller");
assert.match(
  contextPill,
  /aria-label=\{`Project: \$\{projectLabel\} — change project`\}[\s\S]*?<ProjectPickerPopover/,
  "the project chip is a labelled control that opens the shared ProjectPickerPopover",
);
assert.match(
  actionsMenu,
  /<ComposerContextPickers[\s\S]*?context=\{context\}/,
  "the actions menu still threads the shared context into the extracted pickers",
);
assert.match(contextPill, /<ProjectPickerPopover/, "the context pill opens the shared ProjectPickerPopover");
assert.match(contextPill, /useAddProjectFlow\(\{/, "the context pill folds in the shared add-project flow");
assert.match(contextPill, /const canAddProject = Boolean\(config\.createProject \|\| config\.createProjectOrThrow\)/, "composer context supports throwing-only project creation");
assert.match(contextPill, /onAddProject=\{context\.canAddProject \? context\.addFlow\.beginAddProject : undefined\}/, "composer pickers expose the add flow for the throwing creator");
assert.match(
  contextPill,
  /projectAccessLabel\(context\.selectedProject\.access\)/,
  "the selected project chip visibly includes its effective access level",
);
assert.match(
  actionsMenu,
  /access: p\.access/,
  "the chat actions menu preserves access metadata in its alternate project chooser",
);
assert.match(
  addMenu,
  /projectAccessLabel\(p\.access\)/,
  "the alternate Add-to-project chooser shows Read or Full",
);

// ── Styled ──────────────────────────────────────────────────────────────────
assert.match(css, /\.cave-project-picker__trigger/, "trigger styled");
assert.match(css, /\.cave-project-picker__option-root/, "root subtitle styled");
assert.match(css, /\.cave-project-picker__option-access/, "access label styled with design tokens");
assert.match(
  css,
  /\.ui-popover\.cave-project-picker__popover \.ui-popover-item > span:not\(\.project-avatar\)/,
  "project picker grows the text column without stretching avatar badges",
);

// ── In-place registration row (spec 2026-07-24) ─────────────────────────────
// A chat running in an ad-hoc unregistered folder offers to register THAT
// folder — no directory re-browse — above the generic Add-project row.
assert.match(src, /registerCurrentRoot\?: string;/, "picker takes the candidate root");
assert.match(src, /onRegisterCurrentRoot\?: \(\) => void;/, "and the setup-open callback");
assert.match(src, /Register this folder as a project…/, "in-place registration row");
assert.match(src, /ph:folder-plus/, "register row carries the folder-plus icon");

// cave-8e7q: selection travels as the project's generated id, never its display
// name. Emitting the name would make presentation text a connection identifier,
// which is what mangled names containing spaces. The behaviour of the id the
// caller then resolves is pinned in lib/project-display-name-spaces.test.ts.
assert.match(src, /onChange: \(id: string\) => void;/, "the picker's selection callback takes an id");
assert.match(src, /onChange\(project\.id\);/, "picking a project emits its id, not its display name");

// ── Stage 1 Task 4: All projects option ─────────────────────────────────────
// Both props are optional and additive — existing callers with neither retain
// existing behavior. onChange: (id: string) => void is unchanged.
assert.match(
  src,
  /allProjectsLabel\?: string/,
  "ProjectPicker and popover accept optional allProjectsLabel prop",
);
assert.match(
  src,
  /onSelectAllProjects\?: \(\) => void/,
  "ProjectPicker and popover accept optional onSelectAllProjects callback",
);
// Both picker surfaces call the shared helper which enforces these invariants:
assert.match(
  helperSrc,
  /const allProjectsEnabled = Boolean\(allProjectsLabel && hasAllProjectsAction\)/,
  "allProjectsEnabled is a clear boolean requiring both props — no partial-prop UI",
);
assert.match(
  helperSrc,
  /const allProjectsSelected = allProjectsEnabled && value === null;/,
  "allProjectsSelected is the explicit null-scope gate",
);
assert.strictEqual(
  (src.match(/hasAllProjectsAction: Boolean\(onSelectAllProjects\)/g) ?? []).length,
  2,
  "both picker surfaces pass the action flag to the shared helper — default-to-first suppression cannot diverge",
);
assert.match(
  src,
  /onSelectAllProjects\?\.\(\);[\s\S]{0,40}close\(\)/,
  "All projects onSelect calls the callback then closes the popover",
);
assert.match(
  src,
  /checked=\{allProjectsSelected\}[\s\S]{0,80}active=\{allProjectsSelected\}/,
  "All projects row is checked/active only when allProjectsSelected",
);
// noProjectSelected: corrected semantics (reviewer cases — see table tests below).
// - NO_PROJECT_ID + allowNoProject=false → NOT selected ("Choose project")
// - stale + full All + allowNoProject → IS selected/labeled "No project"
assert.match(
  helperSrc,
  /\(isExplicitNoProject && allowNoProject\)[\s\S]{0,20}\|\|[\s\S]{0,50}\(isStale && allowNoProject\)/,
  "noProjectSelected gates NO_PROJECT_ID on allowNoProject and covers stale+allowNoProject regardless of All projects",
);
assert.match(
  src,
  /checked=\{noProjectSelected\}[\s\S]{0,80}active=\{noProjectSelected\}/,
  "No project row is checked/active only from noProjectSelected (value === NO_PROJECT_ID)",
);
assert.doesNotMatch(
  src,
  /No project[\s\S]{0,120}checked=\{!selected\}/,
  "No project row no longer shares the null-selected state with All projects",
);
assert.doesNotMatch(
  src,
  /No project[\s\S]{0,120}active=\{!selected\}/,
  "No project row no longer shares the null-active state with All projects",
);
assert.match(
  src,
  /ph:squares-four/,
  "All projects row uses the ph:squares-four icon",
);
// ── Stable caret class for collapsed-rail hide ──────────────────────────────
// The collapsed CSS in workspace-context-switcher.css hides the caret by
// targeting .cave-project-picker__trigger-caret — a stable authored class.
// This pin ensures the class stays on the Icon so the CSS rule keeps working.
assert.match(
  src,
  /className="cave-project-picker__trigger-caret"/,
  "trigger caret carries the stable class for collapsed-rail CSS targeting",
);
assert.match(
  css,
  /\.cave-project-picker__trigger-caret\s*\{[\s\S]*?margin-left:\s*auto;/,
  "the project caret uses the same trailing-edge spacing as familiar selection",
);
assert.match(
  src,
  /\{allProjectsLabel\}/,
  "All projects row renders the allProjectsLabel string",
);
// emptyLabel now lives in the helper; "Choose project" is gated on allowNoProject
// (NO_PROJECT_ID + allowNoProject=false → "Choose project", not "No project").
assert.match(
  helperSrc,
  /const emptyLabel = allProjectsSelected\s*\?\s*allProjectsLabel!\s*:\s*\(allowNoProject \? "No project" : "Choose project"\)/,
  "empty trigger label: All projects scope wins, then allowNoProject determines the fallback; NO_PROJECT_ID without allowNoProject shows Choose project",
);
// Existing NO_PROJECT_ID / No project path preserved
assert.match(src, /onChange\(NO_PROJECT_ID\);/, "explicit No-project row preserved");
assert.match(src, /NO_PROJECT_ID/, "NO_PROJECT_ID constant still imported and used");

// ── Pure helper unit tests (table-driven) ────────────────────────────────────
// Directly exercises resolveProjectPickerSelection. Catches the two reviewer
// cases without going through React rendering.
{
  const NO = "__no-project__";
  const A = { id: "a" };
  const B = { id: "b" };
  const sorted = [A, B];

  // Helper to run a case and check key outputs.
  function check(label, args, expected, projectList = sorted) {
    const result = resolveProjectPickerSelection({ ...args, noProjectId: NO, sorted: projectList });
    for (const [key, val] of Object.entries(expected)) {
      assert.strictEqual(
        result[key], val,
        `[${label}] ${key}: expected ${JSON.stringify(val)}, got ${JSON.stringify(result[key])}`,
      );
    }
    // Exclusivity: at most one of selected/allProjectsSelected/noProjectSelected is truthy.
    const truths = [
      result.selected !== null,
      result.allProjectsSelected,
      result.noProjectSelected,
    ].filter(Boolean).length;
    assert.ok(
      truths <= 1,
      `[${label}] checked-state exclusivity violated: ${JSON.stringify(result)}`,
    );
  }

  // ── Full All props ──────────────────────────────────────────────────────────
  const full = { allProjectsLabel: "All", hasAllProjectsAction: true };

  // null → All projects selected (suppress defaultToFirst)
  check("null+full+allowNoProject", { value: null, allowNoProject: true, defaultToFirst: true, ...full },
    { selected: null, allProjectsEnabled: true, allProjectsSelected: true, noProjectSelected: false, emptyLabel: "All" });

  // known id → project selected
  check("knownId+full", { value: "a", allowNoProject: false, defaultToFirst: true, ...full },
    { selected: A, allProjectsEnabled: true, allProjectsSelected: false, noProjectSelected: false });

  // NO_PROJECT_ID + allowNoProject=true → No project selected
  check("noProjectId+full+allow", { value: NO, allowNoProject: true, defaultToFirst: true, ...full },
    { selected: null, noProjectSelected: true, emptyLabel: "No project" });

  // REVIEWER CASE 1: NO_PROJECT_ID + allowNoProject=false → "Choose project", NOT No project
  check("noProjectId+full+noallow", { value: NO, allowNoProject: false, defaultToFirst: true, ...full },
    { selected: null, noProjectSelected: false, emptyLabel: "Choose project" });

  // REVIEWER CASE 2: stale + full All + allowNoProject → No project selected and labeled
  check("stale+full+allowNoProject", { value: "stale-xyz", allowNoProject: true, defaultToFirst: true, ...full },
    { selected: null, allProjectsEnabled: true, allProjectsSelected: false, noProjectSelected: true, emptyLabel: "No project" });

  // stale + full All + !allowNoProject → no row selected, "Choose project"
  check("stale+full+noallow", { value: "stale-xyz", allowNoProject: false, defaultToFirst: true, ...full },
    { selected: null, noProjectSelected: false, emptyLabel: "Choose project" });

  // ── Partial/neither props (legacy behavior) ─────────────────────────────────
  const labelOnly = { allProjectsLabel: "All", hasAllProjectsAction: false };
  const actionOnly = { allProjectsLabel: undefined, hasAllProjectsAction: true };
  const neither = { allProjectsLabel: undefined, hasAllProjectsAction: false };

  for (const [desc, props] of [["labelOnly", labelOnly], ["actionOnly", actionOnly], ["neither", neither]]) {
    // Partial: no All projects row; null+defaultToFirst → first project
    check(`null+${desc}+defaultToFirst`, { value: null, allowNoProject: false, defaultToFirst: true, ...props },
      { selected: A, allProjectsEnabled: false, allProjectsSelected: false, noProjectSelected: false, emptyLabel: "Choose project" });

    // Partial: null+defaultToFirst=false+allowNoProject → noProjectSelected
    check(`null+${desc}+notDefault+allow`, { value: null, allowNoProject: true, defaultToFirst: false, ...props },
      { selected: null, allProjectsEnabled: false, noProjectSelected: true, emptyLabel: "No project" });

    // Partial: null+defaultToFirst=false+!allowNoProject → "Choose project"
    check(`null+${desc}+notDefault+noallow`, { value: null, allowNoProject: false, defaultToFirst: false, ...props },
      { selected: null, noProjectSelected: false, emptyLabel: "Choose project" });
  }

  // ── defaultToFirst true/false without All ───────────────────────────────────
  check("null+noAll+defaultToFirst=true", { value: null, allowNoProject: false, defaultToFirst: true, ...neither },
    { selected: A, noProjectSelected: false, emptyLabel: "Choose project" });

  check("null+noAll+defaultToFirst=false+allow", { value: null, allowNoProject: true, defaultToFirst: false, ...neither },
    { selected: null, noProjectSelected: true, emptyLabel: "No project" });

  check(
    "null+noAll+defaultToFirst=true+empty+allow",
    { value: null, allowNoProject: true, defaultToFirst: true, ...neither },
    { selected: null, noProjectSelected: true, emptyLabel: "No project" },
    [],
  );

  check(
    "null+noAll+defaultToFirst=true+empty+noallow",
    { value: null, allowNoProject: false, defaultToFirst: true, ...neither },
    { selected: null, noProjectSelected: false, emptyLabel: "Choose project" },
    [],
  );

  // ── allowNoProject true/false: NO_PROJECT_ID sentinel ───────────────────────
  check("noProjectId+noAll+allow", { value: NO, allowNoProject: true, defaultToFirst: false, ...neither },
    { selected: null, noProjectSelected: true, emptyLabel: "No project" });

  check("noProjectId+noAll+noallow", { value: NO, allowNoProject: false, defaultToFirst: false, ...neither },
    { selected: null, noProjectSelected: false, emptyLabel: "Choose project" });

  // ── Stale id without All props ───────────────────────────────────────────────
  check("stale+noAll+allow", { value: "gone", allowNoProject: true, defaultToFirst: true, ...neither },
    { selected: null, noProjectSelected: true, emptyLabel: "No project" });

  check("stale+noAll+noallow", { value: "gone", allowNoProject: false, defaultToFirst: true, ...neither },
    { selected: null, noProjectSelected: false, emptyLabel: "Choose project" });
}

// ── Disabled transition: popoverOpen gate ────────────────────────────────────
// When the trigger is disabled the popover must be gated closed. The button
// is already disabled, but deriving popoverOpen = open && !disabled ensures
// aria-expanded and the popover's own open prop also reflect the gated state.
// An effect clears stored open when disabled so the popover does not reappear
// the moment the control is re-enabled.
assert.match(
  src,
  /const popoverOpen = open && !disabled;/,
  "popoverOpen derives from open and disabled — never opens while disabled",
);
assert.match(
  src,
  /aria-expanded=\{popoverOpen\}/,
  "trigger aria-expanded reflects the gated popoverOpen, not raw open",
);
assert.match(
  src,
  /useEffect\([\s\S]*?if \(disabled\) setOpen\(false\);[\s\S]*?\[disabled\]/,
  "effect clears stored open when disabled so it does not reappear on re-enable",
);
// The onClick guard provides belt-and-suspenders protection (the button is
// already disabled, but the guard stops a programmatic or future path too).
assert.match(
  src,
  /if \(!disabled\) setOpen/,
  "onClick guard prevents open being set while disabled",
);

console.log("project-picker.test.ts OK");
