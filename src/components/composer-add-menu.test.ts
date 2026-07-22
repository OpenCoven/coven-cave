import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ComposerAddMenu — the shared hierarchical "+" cascade used by both
// composers (reference design: Claude-desktop-style flyout submenus).
// Source pins for the React wiring; the pure pieces (submenu positioning,
// lazy data hooks) have behavioral tests in src/lib.

const read = (relativePath: string) => {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  assert.ok(existsSync(path), `${relativePath} should exist`);
  return readFileSync(path, "utf8");
};

const menu = read("./composer-add-menu.tsx");
const plusMenu = read("./composer-plus-menu.tsx");
const home = read("./home-composer.tsx");
const events = read("../lib/chat-tab-events.ts");
const styles = read("../styles/cave-composer.css");

// ── Root structure: attach → project › → github → skills ›/connectors › ────
assert.match(menu, /export function ComposerAddMenu\(/, "shared cascade component exported");
assert.match(menu, /export function AddMenuRow\(/, "shared row primitive exported for host footers");
assert.match(
  menu,
  /label="Add files or photos"[\s\S]*?label="Add to project"[\s\S]*?label="Add from GitHub"[\s\S]*?label="Skills"[\s\S]*?label="Connectors"/,
  "root order matches the reference: attach · project · github · skills · connectors",
);
assert.match(
  menu,
  /<PopoverSubmenu icon="ph:archive" label="Add to project"/,
  "Add to project is a cascade flyout",
);
assert.match(
  menu,
  /role="menuitemradio"\s*\n\s*checked=\{projects\.selectedId === p\.id\}/,
  "project rows are radio items checked against the current selection",
);
assert.match(
  menu,
  /label="Start a new project"/,
  "the project flyout offers Start a new project",
);
assert.match(
  menu,
  /\{skills \|\| connectors \? <PopoverSeparator \/> : null\}/,
  "skills/connectors group is separated from the add group",
);

// ── Skills flyout: lazy list, insert-for-editing, manage/browse links ───────
assert.match(
  menu,
  /useComposerSkills\(open && Boolean\(skills\)\)/,
  "skills fetch lazily on first open, only when the section renders",
);
assert.match(
  menu,
  /useComposerConnectors\(open && Boolean\(connectors\)\)/,
  "connectors fetch lazily on first open, only when the section renders",
);
assert.match(
  menu,
  /skills\.onPickSkill\(s\)/,
  "picking a skill hands the option to the host (insert `/skill <id> ` for arg editing)",
);
assert.match(
  menu,
  /label="Manage skills"[\s\S]*?openSkillsTab\(\)/,
  "Manage skills routes to Chat's Skills tab",
);
assert.match(
  menu,
  /label="Browse skills"[\s\S]*?openMarketplace\(\)/,
  "Browse skills routes to the Marketplace",
);
assert.match(
  menu,
  /markSkillsTabPending\(\);[\s\S]*?cave:navigate-mode[\s\S]*?mode: "chat"[\s\S]*?CHAT_OPEN_SKILLS_EVENT/,
  "the Skills-tab handoff latches before navigating, then fires the open event (mount-race safe)",
);
assert.match(
  events,
  /export const CHAT_OPEN_SKILLS_EVENT = "cave:chat-open-skills"/,
  "the skills-tab event is a first-class chat-tab event",
);
assert.match(
  menu,
  /label="Manage connectors"[\s\S]*?openMarketplace\(\)/,
  "Manage connectors routes to the Marketplace",
);
assert.match(menu, /No skills installed yet\./, "skills flyout has an empty state");
assert.match(menu, /No connectors configured yet\./, "connectors flyout has an empty state");

// ── Legacy utilities keep their gates through the relocation ────────────────
assert.match(
  menu,
  /role="menuitemcheckbox"\s*\n\s*checked=\{legacy\.dictation\.listening\}/,
  "dictation stays a checked toggle row",
);
assert.match(
  menu,
  /live=\{legacy\.dictation\.listening\}/,
  "live dictation keeps the pulsing icon affordance",
);
assert.match(
  menu,
  /label=\{legacy\.enhance\.loading \? "Enhancing…" : "Enhance prompt"\}/,
  "enhance keeps its loading label swap",
);
assert.match(
  menu,
  /<PopoverSubmenu[\s\S]{0,200}?label="Enhance options"[\s\S]*?ENHANCE_INTENTS\.map/,
  "enhance intents are a true cascade submenu (view-swap retired)",
);
assert.doesNotMatch(menu, /setView|"root" \| "enhance"/, "no in-place view swap remains");

// ── Home wrapper: thin shell over the shared cascade ────────────────────────
assert.match(plusMenu, /<ComposerAddMenu/, "ComposerPlusMenu delegates to the shared cascade");
assert.doesNotMatch(plusMenu, /ENHANCE_INTENTS/, "the wrapper carries no menu content of its own");
assert.match(
  plusMenu,
  /triggerRef\?: RefObject<HTMLButtonElement \| null>/,
  "the wrapper keeps the shared anchor ref for the chained options popover",
);
assert.match(
  home,
  /projects=\{\{\s*\n\s*projects: plusMenuProjects,[\s\S]*?noProjectId: NO_PROJECT_ID,[\s\S]*?onStartNewProject: plusAddProject\.beginAddProject,/,
  "home wires the project flyout to its selection state and the shared add-project flow",
);
assert.match(
  home,
  /onPickSkill: \(skill\) => \{\s*\n\s*setText\(`\/skill \$\{skill\.id\} `\);\s*\n\s*textareaRef\.current\?\.focus\(\);/,
  "home inserts `/skill <id> ` and refocuses the textarea on skill pick",
);
assert.match(
  home,
  /\{plusAddProject\.addProjectModal\}/,
  "home mounts the add-project modal for Start a new project",
);

// ── Styles ──────────────────────────────────────────────────────────────────
assert.match(styles, /\.composer-add__note/, "flyout note styling exists");

console.log("composer-add-menu.test.ts: ok");
