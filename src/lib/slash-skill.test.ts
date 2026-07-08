// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  skillSlashOptions,
  resolveSkillArg,
  resolveSkillInvocation,
  buildSkillPrompt,
  skillCommandMatches,
  formatSkillList,
} from "./slash-skill.ts";

const SKILLS = [
  { id: "deep-research", name: "deep-research", description: "Fan-out web research" },
  { id: "code-review", name: "code-review", description: "Review the current diff" },
  { id: "verify", name: "verify", description: "Run the app and check a change" },
];

// ── skillSlashOptions: null outside picker position, list/filter inside ───────
assert.equal(skillSlashOptions("hello", SKILLS), null, "plain text → null (command menu)");
assert.equal(skillSlashOptions("/skill", SKILLS), null, "bare /skill (no space) → null so both commands show in the menu");
assert.deepEqual(skillSlashOptions("/skill ", SKILLS), SKILLS, "/skill <space> → full list");
assert.deepEqual(skillSlashOptions("/skills", SKILLS), SKILLS, "/skills → full list (show all)");
assert.deepEqual(skillSlashOptions("/skills ", SKILLS), SKILLS, "/skills <space> → full list");
const filtered = skillSlashOptions("/skill rev", SKILLS);
assert.equal(filtered.length, 1, "/skill rev filters to one");
assert.equal(filtered[0].id, "code-review", "filter matches description/name");
assert.equal(skillSlashOptions("/skills verify", SKILLS).length, 1, "/skills also accepts a trailing filter");
assert.equal(skillSlashOptions("/skill nomatch", SKILLS).length, 0, "no match → empty (not null)");
assert.equal(skillSlashOptions("/model gpt", SKILLS), null, "a different command → null");

// The scan returns the same skill from several roots (~/.claude/skills +
// ~/.agents/skills copies). The picker must render one row per id — composers
// key list items by s.id, so a duplicate here is a duplicate React key AND a
// doubled menu row (seen live: two `brainstorming` entries).
const MULTI_ROOT = [
  { id: "brainstorming", name: "brainstorming", familiar: "user", path: "/u/.claude/skills/brainstorming/SKILL.md" },
  { id: "code-review", name: "code-review", familiar: "user" },
  { id: "brainstorming", name: "brainstorming", familiar: "agents-user", path: "/u/.agents/skills/brainstorming/SKILL.md" },
];
const dedupedPick = skillSlashOptions("/skill ", MULTI_ROOT);
assert.deepEqual(dedupedPick.map((s) => s.id), ["brainstorming", "code-review"], "one row per skill id");
assert.equal(dedupedPick[0].familiar, "user", "first scan root (scope precedence) wins");
assert.equal(skillSlashOptions("/skill brains", MULTI_ROOT).length, 1, "filtering operates on the deduped list");

// ── resolveSkillArg: exact then substring ────────────────────────────────────
assert.equal(resolveSkillArg("verify", SKILLS)?.id, "verify", "exact name");
assert.equal(resolveSkillArg("CODE-REVIEW", SKILLS)?.id, "code-review", "case-insensitive exact");
assert.equal(resolveSkillArg("research", SKILLS)?.id, "deep-research", "substring");
assert.equal(resolveSkillArg("", SKILLS), null, "empty → null");
assert.equal(resolveSkillArg("zzz", SKILLS), null, "unknown → null");

// ── buildSkillPrompt / formatSkillList ───────────────────────────────────────
assert.equal(buildSkillPrompt(SKILLS[0]), 'Use the "deep-research" skill.', "invocation prompt names the skill");
assert.equal(buildSkillPrompt(SKILLS[0], "  "), 'Use the "deep-research" skill.', "blank args → plain directive");
assert.equal(
  buildSkillPrompt(SKILLS[1], "src/foo.ts"),
  'Use the "code-review" skill with: src/foo.ts',
  "typed arguments ride along after the directive",
);
const list = formatSkillList(SKILLS);
assert.match(list, /Available skills/, "list has a header");
assert.match(list, /deep-research/, "list includes each skill");
assert.match(formatSkillList([]), /No skills found/, "empty list is explained");
assert.equal(
  formatSkillList([
    { id: "brainstorming", name: "brainstorming" },
    { id: "brainstorming", name: "brainstorming" },
  ]).match(/brainstorming/g).length,
  2, // once in "name — `id`" form on a single line
  "the bare /skills system message lists a multi-root skill once",
);

// ── resolveSkillInvocation: whole name first, then first-token + args ────────
assert.deepEqual(
  resolveSkillInvocation("code-review", SKILLS),
  { skill: SKILLS[1], args: "" },
  "bare name resolves with empty args",
);
assert.deepEqual(
  resolveSkillInvocation("code-review src/foo.ts please", SKILLS),
  { skill: SKILLS[1], args: "src/foo.ts please" },
  "first token resolves, remainder becomes the skill's arguments",
);
assert.equal(resolveSkillInvocation("nope at-all", SKILLS), null, "unknown head → null");
assert.equal(resolveSkillInvocation("zzz", SKILLS), null, "unknown single token → null");

// ── skillCommandMatches: top-level menu discovery ────────────────────────────
assert.deepEqual(skillCommandMatches("/revi", SKILLS).map((s) => s.id), ["code-review"], "3+ chars matches by substring");
assert.deepEqual(skillCommandMatches("/re", SKILLS), [], "under 3 typed chars stays out of the menu");
assert.deepEqual(skillCommandMatches("revi", SKILLS), [], "non-slash text never matches");
const MANY = Array.from({ length: 9 }, (_, i) => ({ id: `review-${i}`, name: `review-${i}` }));
assert.equal(skillCommandMatches("/review", MANY).length, 5, "capped at 5 rows");
const DUPED = [
  { id: "code-review", name: "code-review", familiar: "user" },
  { id: "code-review", name: "code-review", familiar: "agents-user" },
];
assert.equal(skillCommandMatches("/review", DUPED).length, 1, "same skill from two scan roots renders once");

// ── Catalog + composer wiring (source-text) ──────────────────────────────────
const slashCmds = await readFile(new URL("./slash-commands.ts", import.meta.url), "utf8");
assert.match(slashCmds, /name: "\/skill",[\s\S]*?argPlaceholder: "name"/, "/skill is registered with an arg placeholder");
assert.match(slashCmds, /name: "\/skills"/, "/skills is registered");

const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
assert.match(chatView, /skillSlashOptions\(input, skills\)/, "chat-view computes the inline /skill options");
assert.match(chatView, /const menuOpen = modelMenuActive \|\| skillMenuActive \|\| promptMenuActive \|\| slashSuggestions\.length > 0 \|\| skillCommandRows\.length > 0;/, "chat-view menuOpen includes the skill picker and the Skills group");
assert.match(chatView, /command === "\/skill" \|\| command === "\/skills"/, "chat-view dispatches /skill and /skills");
assert.match(chatView, /sendRaw\(buildSkillPrompt\(skill, skillArgs\)\)/, "typed /skill arguments are forwarded into the invocation");
assert.match(chatView, /sendRaw\(buildSkillPrompt\(s\)\)/, "picking a skill sends the invocation directive");
assert.match(chatView, /const invokeSkillOption = \(s: SkillOption\)/, "chat-view shares one skill-invoke helper across picker, menu and clicks");
assert.match(chatView, /s\.argumentHint && input\.trim\(\)\.toLowerCase\(\) !== filled\.toLowerCase\(\)/, "a hinted skill autofills /skill <id> for argument editing instead of sending");
assert.match(chatView, /skillCommandMatches\(firstWord, skills\)/, "chat-view surfaces skills in the top-level command menu");
assert.match(chatView, /role="listbox" aria-label="Skills"/, "chat-view renders a Skills listbox");
assert.match(chatView, /fetch\("\/api\/skills\/local"/, "chat-view sources skills from the local skill scan");

// argument-hint flows from SKILL.md frontmatter to the picker metadata.
const scan = await readFile(new URL("./server/skill-scan.ts", import.meta.url), "utf8");
assert.match(scan, /argumentHint: fm\["argument-hint"\]/, "skill-scan maps the argument-hint frontmatter key");

// ── Skill detail preview in the picker ───────────────────────────────────────
const preview = await readFile(new URL("../components/skill-detail-preview.tsx", import.meta.url), "utf8");
assert.match(preview, /export function SkillDetailPreview\(\{ skill \}/, "exports a SkillDetailPreview component");
assert.match(preview, /skill\.description/, "preview shows the full description");
assert.match(preview, /skill\.tags\?\.length/, "preview shows tags when present");
assert.match(preview, /skill\.path/, "preview shows the skill path");
assert.match(preview, /skill\.familiar/, "preview shows the skill scope");
assert.match(preview, /skill\.argumentHint/, "preview shows the argument hint when present");

const homeComposer = await readFile(new URL("../components/home-composer.tsx", import.meta.url), "utf8");
for (const [label, src] of [["chat-view", chatView], ["home-composer", homeComposer]]) {
  assert.match(
    src,
    /<SkillDetailPreview skill=\{skillOptions\[slashIdx\] \?\? skillOptions\[0\] \?\? null\}/,
    `${label} renders the detail preview for the highlighted skill`,
  );
}

// The SkillOption type carries the metadata the preview renders.
const lib = await readFile(new URL("./slash-skill.ts", import.meta.url), "utf8");
assert.match(lib, /version\?: string;[\s\S]*?tags\?: string\[\];[\s\S]*?path\?: string;/, "SkillOption carries preview metadata");

console.log("slash-skill.test.ts: ok");
