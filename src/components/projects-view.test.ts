// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source contracts for the Chat → Projects "Project access" page: one
// familiar's access map over every registered project, cycled per row against
// /api/project-grants. Pure derivations (sections, cycle, counts, filter,
// bulk ops) are behaviorally tested in src/lib/projects/access-page.test.ts;
// these pins guard the React wiring and the page's cave-styled shell.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const view = read("./projects-view.tsx");
const css = read("../styles/projects.css");
const chatSurface = read("./chat-surface.tsx");

test("the surface keeps its mount contract with ChatSurface", () => {
  // Direct CSS import: the surface is reachable straight from the Chat →
  // Projects tab, before any other surface has ever mounted.
  assert.match(view, /import "@\/styles\/projects\.css"/, "styles are imported by the component itself");
  assert.match(view, /export function ProjectsView\(/, "keeps the ProjectsView export ChatSurface lazy-loads");
  // Props stay the full historical contract so ChatSurface compiles untouched.
  assert.match(view, /sessions\?: SessionRow\[\]/);
  assert.match(view, /familiars\?: Familiar\[\]/);
  assert.match(view, /onSessionsDeleted: \(sessionIds: readonly string\[\]\) => void/);
  assert.match(view, /activeFamiliarId\?: string \| null/);
  assert.match(chatSurface, /scope === "projects" \? \(/, "ChatSurface still branches to the Projects surface");
});

test("the header is the compact cave-typography access header", () => {
  assert.match(view, /className="projects-access-eyebrow">Familiars</, "eyebrow reads Familiars");
  assert.match(view, /className="projects-access-title">Project access</, "serif title");
  // The subtitle is now pane-aware: it explains the grant cycle on Access, the
  // union-max rule on Groups, and the provenance readout on Activity.
  assert.match(view, /may read and write\. Click a project’s pill to cycle — none, read, full\./, "the Access subtitle names the familiar and explains the cycle");
  assert.match(view, /most permissive of its own grants and its groups’/, "the Groups subtitle states the union-max rule");
  assert.match(view, /’s access came from — inherited groups, requests/, "the Activity subtitle explains provenance");
  assert.match(css, /\.projects-access-title \{[^}]*font-family: var\(--font-serif, ui-serif, serif\)/, "title uses the cave serif");
  assert.match(css, /\.projects-access-title \{[^}]*font-size: var\(--text-xl\)/, "title sits on the type scale, not a display hero");
  assert.match(css, /\.projects-access-eyebrow \{[^}]*font-family: var\(--font-mono, ui-monospace, monospace\)/, "eyebrow is mono");
  assert.match(css, /\.projects-access-eyebrow \{[^}]*text-transform: uppercase/, "eyebrow is uppercase");
  assert.match(css, /\.projects-access-eyebrow \{[^}]*color: var\(--accent-presence\)/, "eyebrow carries the accent");
});

test("the toolbar carries picker, search, tally, and reset", () => {
  assert.match(view, /<StandardSelect[\s\S]{0,200}label="Familiar"/, "familiar picker is the shared select");
  assert.match(view, /onChange=\{\(id\) => setPickedFamiliarId\(id\)\}/, "picking a familiar switches the matrix");
  assert.match(view, /if \(activeFamiliarId\) setPickedFamiliarId\(activeFamiliarId\)/, "follows the chat's active familiar");
  assert.match(view, /placeholder="Find a project…"/, "search placeholder matches the design");
  assert.match(view, /e\.key !== "\/"/, "the / shortcut jumps to search");
  assert.match(view, /accessCounts\(/, "tally uses the pure counts helper");
  assert.match(view, /accessLedger\(counts\)/, "the whole-map tally feeds the ledger");
  assert.match(view, />\s*Reset all\s*</, "offers Reset all");
  assert.match(view, /await confirm\(\{[\s\S]{0,200}title: `Reset \$\{familiarLabel\(familiar\)\}’s access\?`/, "reset is confirm-gated");
});

test("rows cycle a direct grant against /api/project-grants", () => {
  assert.match(view, /const \{ projects, loading: projectsLoading, error: projectsError, reload, createProject, createProjectOrThrow, updateRepoUrl, renameProject, deleteProject \} = useProjects\(\)/, "projects load unscoped — access is managed over every project");
  assert.match(view, /fetch\("\/api\/project-grants", \{ cache: "no-store" \}\)/, "grants snapshot comes from the console API");
  assert.match(view, /method: op\.op === "grant" \? "POST" : "DELETE"/, "grant/revoke map to POST/DELETE");
  assert.match(view, /targetFamiliarId: familiarId/, "mutations target the picked familiar");
  assert.match(view, /nextAccessState\(row\.state\)/, "click advances the none → read → full cycle");
  assert.match(view, /resolveEffectiveAccess\(\{/, "pills show the effective level (direct ∪ groups)");
  assert.match(view, /setOptimistic\(/, "mutations render optimistically");
  assert.match(view, /await loadGrants\(\)/, "server snapshot is re-fetched after a mutation");
  assert.match(view, /sectionModels\(filtered, true\)/, "the grid keeps the workspace/repository split; rows and tree impose their own order");
  assert.match(view, /setAllOps\(/, "bulk actions compute the minimal op set");
  assert.match(view, /keeps \$\{accessStateMeta\(row\.state\)\.label\} via/, "group-held access explains itself instead of firing a no-op revoke");
});

test("stale project permissions are visible and repaired only after an explicit human confirmation", () => {
  assert.match(view, /integrity:\s*\{/, "grant snapshots carry the server's read-only integrity report");
  assert.match(view, /orphanPermissionRecords/, "the surface derives a visible stale-record count");
  assert.match(view, /Repair stale project permissions\?/, "repair is explicitly confirmation-gated");
  assert.match(view, /This only revokes stale access; it never grants access\./, "the destructive scope is truthful");
  assert.match(view, /body: JSON\.stringify\(\{ repairOrphans: true \}\)/, "the explicit repair endpoint is used");
  assert.match(view, /Repair stale permissions/, "the actionable remediation is visible in the project-access surface");
  assert.match(view, /await loadGrants\(\)/, "repair rechecks the authoritative grant snapshot");
  assert.match(view, /Stale project permissions repaired\./, "repair completion is announced to assistive technology");
});

test("the supreme familiar renders locked at Full", () => {
  assert.match(view, /isSupreme\(familiar\.id, grantsData\?\.supremeFamiliarId \?\? null\)/, "supreme comes from the console API");
  assert.match(view, /state: "write", direct: "write", groupNames: \[\] \}/, "supreme rows pin to Full");
  assert.match(view, /supreme familiar — full access to everything, always\./, "explains the lock");
  assert.match(view, /disabled=\{pending \|\| supreme\}/, "supreme rows don't cycle");
});

test("command-palette focus scrolls and flashes the row", () => {
  assert.match(view, /CHAT_FOCUS_PROJECT_EVENT/, "keeps the palette Open-project listener");
  assert.match(view, /setFlashId\(match\.id\)/, "flashes the focused row");
  assert.match(view, /scrollIntoView\(\{ block: "center", behavior: smoothScrollBehavior\(\) \}\)/, "respects reduced motion");
});

test("a persisted three-view switcher replaces the old grouped/flat boolean", () => {
  assert.match(view, /const VIEW_STORAGE_KEY = "cave:projects:view"/, "preference key follows the cave:<surface>:<pref> convention");
  assert.match(view, /isViewMode\(stored\) \? stored : "grid"/, "grid stays the default, and an unknown stored value can't break the page");
  assert.match(view, /window\.localStorage\.setItem\(VIEW_STORAGE_KEY, next\)/, "picking a view persists it");
  assert.match(view, /icon: "ph:squares-four", label: "Grid"/, "Grid is the card view");
  assert.match(view, /icon: "ph:rows", label: "Rows"/, "Rows is the dense list — the old flat mode");
  assert.match(view, /icon: "ph:stack", label: "Tree"/, "Tree is the by-access-level audit");
  assert.match(view, /aria-pressed=\{view === option\.mode\}/, "the switcher reports its state");
  assert.match(view, /Projects grouped by access level\./, "mode changes are announced");
  assert.match(css, /\.projects-access-views \{/, "the switcher is styled into the toolbar");
  assert.match(css, /\.projects-access-view\.is-on \{/, "the active view is marked");
});

test("the header ledger is proportional, not three loose numbers", () => {
  assert.match(view, /accessLedger\(counts\)/, "the bar derives from the whole-map tally");
  assert.match(view, /style=\{\{ width: seg\.width \}\}/, "segment width is the computed percentage");
  assert.match(view, /\{seg\.count\} \{seg\.label\}/, "the key spells out each level");
  assert.match(css, /\.projects-access-ledger-bar \{/, "the bar is styled");
});

test("rows and tree views reorder the same map", () => {
  assert.match(view, /sortByAccessThenName\(viewRows\)/, "the dense list floats granted projects to the top");
  assert.match(view, /treeGroups\(viewRows\)/, "the tree groups by access level");
  assert.match(view, /className="projects-access-thead"/, "the dense list has a column header");
  assert.match(css, /\.projects-access-tree \{/, "the tree is styled");
});

test("cards disclose what a level actually permits", () => {
  assert.match(view, /grantChips\(row\.state\)/, "the expanded card lists every capability, on or off");
  assert.match(view, /aria-expanded=\{open\}/, "the disclosure reports its state");
  assert.match(view, /\{open \? renderDetail\(row\) : null\}/, "a collapsed card renders no detail");
  assert.match(view, /projectKind\(project\.root\)/, "the card glyph follows the workspace/repository split");
  assert.match(css, /\.projects-access-grants\.is-write li\.is-on \{/, "granted capabilities are marked");
});

test("bulk select sets several projects at once", () => {
  assert.match(view, /const \[bulk, setBulk\] = useState\(false\)/, "selection mode is off until asked for");
  assert.match(view, /setSelectedAccess\(target\)/, "the band applies one level to the checked set");
  assert.match(view, /setAllOps\(ids, directByProject, target\)/, "bulk writes compute the minimal op set");
  assert.match(view, /selectionLabel\(selected\.size\)/, "the band counts the selection");
  assert.match(view, /disabled=\{selected\.size === 0 \|\| controlsDisabled\}/, "an empty selection can't fire a write");
  assert.match(
    view,
    /setSelected\(new Set\(\)\);\s*setBulk\(false\);\s*\}, \[familiarId\]\)/,
    "switching familiars drops the selection — checkmarks must not carry onto another map",
  );
  assert.match(css, /\.projects-access-bulk \{/, "the band is styled");
});

test("collapsing a section still reports what is granted inside it", () => {
  assert.match(view, /sectionMix\(rows\.map\(\(row\) => row\.state\)\)/, "collapsed sections show their access mix");
  assert.match(view, /sectionPeek\(rows\.map\(\(row\) => row\.name\)\)/, "and a name peek");
  assert.match(view, /aria-expanded=\{!isCollapsed\}/, "the section toggle reports its state");
  assert.match(css, /\.projects-access-mix \{/, "the mix chips are styled");
});

test("a card renames in place", () => {
  assert.match(view, /onDoubleClick=\{\(\) => startRename\(row\.project\)\}/, "double-click starts the rename");
  assert.match(view, /if \(e\.key === "Escape"\) setRenamingId\(null\)/, "Escape abandons it");
  assert.match(view, /const ok = await renameProject\(id, name\);/, "rename goes through useProjects().renameProject");
});

test("secondary controls stay quiet until hover or keyboard focus", () => {
  assert.match(css, /\.projects-access-setall \{[^}]*opacity: 0/, "Set-all rests invisible");
  assert.match(css, /\.projects-access-section-head:hover \.projects-access-setall,\r?\n\.projects-access-section-head:focus-within \.projects-access-setall \{[^}]*opacity: 1/, "hover or focus reveals Set-all");
  assert.match(view, /className=\{`projects-access-setall-btn is-\$\{target\} focus-ring`\}/, "revealed Set-all buttons carry the level and the focus ring");
  assert.match(css, /\.projects-access-disclose,\r?\n\.projects-access-gear \{[^}]*opacity: 0/, "the card gear and disclosure rest invisible");
  assert.match(css, /\.projects-access-card:focus-within \.projects-access-gear,/, "card hover or focus reveals them");
  assert.match(css, /\.projects-access-disclose\[aria-expanded="true"\] \{[^}]*opacity: 1/, "an open disclosure stays visible after the pointer leaves");
  const hoverNoneBlocks = css.match(/@media \(hover: none\)/g) ?? [];
  assert.ok(hoverNoneBlocks.length >= 2, "touch devices keep both controls always visible");
});

test("access controls retain semantic headings and visible keyboard focus", () => {
  assert.doesNotMatch(
    view,
    /<h2 className="projects-access-section-title">/,
    "the section-toggle button contains phrasing content, not a nested heading",
  );
  assert.match(
    view,
    /<span className="projects-access-section-title">/,
    "the section label keeps its presentation class after leaving the heading element",
  );
  assert.match(
    view,
    /className=\{`projects-access-pill is-\$\{row\.state\}\$\{pending \? " is-pending" : ""\} focus-ring`\}/,
    "row access pills use the shared visible focus ring",
  );
  assert.match(
    view,
    /className=\{`projects-access-chip\$\{flashId === row\.id \? " is-flash" : ""\} focus-ring`\}/,
    "tree access pills use the shared visible focus ring",
  );
});

test("pills and states are token-driven for both themes", () => {
  assert.match(css, /\.projects-access-pill\.is-write \{[^}]*background: var\(--accent-presence\)/, "Full pill fills with the accent");
  assert.match(css, /\.projects-access-pill\.is-write \{[^}]*color: var\(--accent-presence-foreground\)/, "Full pill text uses the paired foreground token");
  assert.match(css, /\.projects-access-pill\.is-read \{[^}]*color-mix\(in oklch, var\(--accent-presence\) 12%, transparent\)/, "Read pill is an accent tint");
  assert.match(css, /\.projects-access-pill \{[^}]*color: var\(--text-muted\)/, "the resting (No access) pill is muted");
  assert.match(css, /\.projects-access-pill\.is-write \{[^}]*border-color: transparent/, "the Full pill drops its border — the filled state carries itself");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no hard-coded hex colors — theme tokens only");
  assert.match(css, /\.projects-access-card\.is-flash,/, "flash state is styled");
  assert.match(css, /\.projects-access-rule \{[^}]*background: var\(--border-hairline\)/, "section rules are hairlines");
});

test("empty projects offer New project and Ask Salem", () => {
  assert.match(view, /Create one here, or register a folder from the chat composer\./, "empty state points at both creation paths");
  assert.match(view, /Ask Salem/, "projects empty state offers Ask Salem");
  assert.match(view, /cave:salem-open/, "Ask Salem opens the Salem rail");
});

test("the toolbar creates projects through the one shared add flow", () => {
  assert.match(view, /import \{ useAddProjectFlow \} from "@\/components\/project-picker"/, "creation reuses the shared add-project flow (native dialog + web fallback + grant)");
  assert.match(view, /const addFlow = useAddProjectFlow\(\{[\s\S]{0,200}familiarId: familiar\?\.id \?\? null/, "the new project is granted to the picked familiar");
  assert.match(view, /createProject, createProjectOrThrow, updateRepoUrl, renameProject, deleteProject \} = useProjects\(\)/, "creation + repo-link + rename/remove mutations come from useProjects");
  assert.match(view, /useAddProjectFlow\(\{[\s\S]{0,260}createProjectOrThrow,/, "the shared add flow keeps the throwing creation error contract");
  assert.match(view, /onAdded: \(\) => \{[\s\S]{0,120}reload\(\);[\s\S]{0,120}void loadGrants\(\);/, "a successful add refreshes both the registry and the grants snapshot");
  assert.match(view, /className="projects-access-new"[\s\S]{0,220}onClick=\{addFlow\.beginAddProject\}/, "the toolbar exposes the New project button");
  assert.match(view, />\s*\{addFlow\.adding \? "Adding…" : "New project"\}\s*</, "the button reflects the in-flight add");
  assert.match(view, /\{addFlow\.addError && pane === "access" \? \([\s\S]{0,120}projects-access-error/, "add failures surface on the page, beside the pane that can add");
  assert.match(view, /\{addFlow\.addProjectModal\}/, "the web-fallback directory browser is mounted");
});

test("each row opens per-project settings with the GitHub repo link", () => {
  assert.match(view, /import \{ ProjectSettingsModal \} from "@\/components\/project-settings-modal"/, "settings live in the shared modal component");
  assert.match(view, /className="projects-access-gear focus-ring"/, "the card carries the settings trigger beside its pill");
  assert.match(view, /className="projects-access-gear focus-ring"[\s\S]{0,120}onClick=\{\(\) => setSettingsProjectId\(row\.id\)\}/, "the gear opens that project's settings");
  assert.match(view, /aria-label=\{`Project settings — \$\{row\.name\}`\}/, "the settings trigger is named per project");
  assert.match(view, /row\.kind === "workspace" \? "ph:folder" : "ph:github-logo"/, "the kind glyph distinguishes workspaces from repositories");
  assert.match(view, /<ProjectSettingsModal[\s\S]{0,160}project=\{settingsProject\}[\s\S]{0,160}onSaveRepoUrl=\{saveRepoUrl\}/, "the modal is wired to the derived project + save handler");
  assert.match(view, /const ok = await updateRepoUrl\(id, repoUrl\);/, "saves go through useProjects().updateRepoUrl");
  assert.match(css, /\.projects-access-card \{/, "the card is styled");
  assert.match(css, /\.projects-access-gear \{/, "settings trigger is styled");
  assert.match(css, /\.projects-access-kind \{/, "the kind glyph is styled");
});

// Kind is a category, so each gets its own treatment. Before, only workspaces
// were styled — a repository was encoded by the ABSENCE of the accent, which
// reads as "no kind" rather than "repository". Distinct hues aren't available:
// this system has one accent (--color-info aliases it) and a second hue would
// have to survive 21 palettes × 2 modes, so the split is fill vs ring.
test("workspaces and repositories each carry their own kind treatment", () => {
  assert.match(
    css,
    /\.projects-access-kind\.is-workspace \{[^}]*background:\s*color-mix\(in oklch, var\(--accent-presence\)/,
    "workspaces are the filled, accent-tinted kind",
  );
  assert.match(
    css,
    /\.projects-access-kind\.is-repo \{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--border-strong\)/,
    "repositories are ringed rather than filled",
  );
  assert.doesNotMatch(
    css,
    /\.projects-access-kind \{[^}]*background:\s*color-mix/,
    "the base glyph carries no kind colour of its own — each kind states itself",
  );
  // The dense rows view strips the tile, so neither treatment may leak there.
  assert.match(
    css,
    /\.projects-access-tr-name \.projects-access-kind \{[^}]*box-shadow:\s*none/,
    "the rows view drops the ring along with the fill",
  );
});

test("the settings modal also renames and removes from the registry (issue #3710)", () => {
  assert.match(view, /<ProjectSettingsModal[\s\S]{0,260}onRename=\{renameProjectAndAnnounce\}[\s\S]{0,60}onDelete=\{removeProject\}/, "the modal carries rename + remove handlers");
  assert.match(view, /const ok = await renameProject\(id, name\);/, "rename goes through useProjects().renameProject");
  assert.match(view, /const ok = await deleteProject\(id\);/, "remove goes through useProjects().deleteProject");
  // Removing a project must refresh the grant matrix — the DELETE cascade
  // revoked its grants server-side, so the stale rows have to drop out.
  assert.match(view, /await deleteProject\(id\);[\s\S]{0,160}void loadGrants\(\);/, "a removal reloads the grants snapshot");
});

// ── One surface for the whole permissions protocol (cave-2tmly) ──────────────
// Before this, the grant matrix existed TWICE — here and in Chat → Familiar →
// Settings → Projects — both writing the same /api/project-grants, while access
// groups (the only primitive that grants a set of projects to a set of
// familiars at once) were buried two levels inside that settings tab.
test("Access, Groups, and Activity are three peer panes", () => {
  assert.match(view, /type ProjectsPane = "access" \| "host" \| "groups" \| "activity"/, "the surface names its four panes");
  assert.match(view, /<Tabs<ProjectsPane>/, "the panes use the shared tabs primitive");
  assert.match(view, /id: "access", label: "Access"/, "Access is a named tab");
  assert.match(view, /id: "groups",\s*label: "Groups",/, "Groups is a named tab, not a section scrolled past");
  assert.match(view, /id: "activity",\s*label: "Activity",/, "Activity is a named tab");
  assert.match(view, /count: groupCount/, "the Groups tab carries a count so the primitive is visible at a glance");
  assert.match(view, /<AccessGroupsSection familiars=\{resolvedFamiliars\} \/>/, "the groups manager mounts here now");
  assert.match(
    view,
    /<FamiliarStudioProjectsTab[\s\S]{0,160}variant="activity"/,
    "the governance panels mount WITHOUT a second copy of the grant matrix",
  );
});

test("the pane preference survives a reload and rejects junk", () => {
  assert.match(view, /const PANE_STORAGE_KEY = "cave:projects:pane"/, "the pane is a persisted preference");
  assert.match(view, /isPane\(stored\) \? stored : "access"/, "an unrecognised stored value falls back to Access");
  // Storage failures (private mode) must lose the preference, never the pane.
  assert.match(view, /window\.localStorage\.setItem\(PANE_STORAGE_KEY, next\);\s*\} catch \{/, "a storage failure is swallowed");
});

test("one-familiar controls stay on the panes that have a familiar to act on", () => {
  // The ledger measures ONE familiar's grants. Beside a cross-familiar group
  // list it would read as a tally of the thing on screen, which it is not.
  assert.match(view, /\{pane === "access" \? \(\s*<div\s*className="projects-access-ledger"/, "the ledger belongs to Access alone");
  assert.match(view, /\{pane === "access" && bulk \? \(/, "bulk editing is an Access-pane affordance");
  assert.match(
    view,
    /pane === "activity" && familiars\.length > 0 && familiar \? \(/,
    "Activity keeps the familiar picker — it is per-familiar too",
  );
  assert.match(view, /orphanPermissionRecords > 0 && pane !== "groups"/, "the stale-permission repair hides on the cross-familiar pane");
});
