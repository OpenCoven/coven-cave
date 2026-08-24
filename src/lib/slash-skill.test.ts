// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  skillSlashOptions,
  resolveSkillArg,
  resolveSkillInvocation,
  buildSkillPrompt,
  skillCarryOverText,
  skillComposerInsertion,
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

// A skill is ADDED to the operator's message, never swapped in for it — the
// whole reason for the third parameter (picking a skill mid-sentence used to
// clear the composer and send only the directive).
assert.equal(
  buildSkillPrompt(SKILLS[1], "", "look at the token refresh path"),
  'Use the "code-review" skill.\n\nlook at the token refresh path',
  "composer text is carried into the invocation",
);
assert.equal(
  buildSkillPrompt(SKILLS[1], "src/foo.ts", "focus on the auth layer"),
  'Use the "code-review" skill with: src/foo.ts\n\nfocus on the auth layer',
  "arguments and the carried message both survive",
);
assert.equal(
  buildSkillPrompt(SKILLS[1], "line one\nline two"),
  'Use the "code-review" skill.\n\nline one\nline two',
  "multi-line arguments become the body instead of being mangled into the directive line",
);
assert.equal(
  buildSkillPrompt(SKILLS[0], "  ", "   "),
  'Use the "deep-research" skill.',
  "blank message → plain directive",
);

// ── skillCarryOverText: the operator's own words vs picker scaffolding ───────
assert.equal(skillCarryOverText("check the auth path"), "check the auth path", "plain prose carries");
assert.equal(skillCarryOverText("  padded  "), "padded", "carried text is trimmed");
assert.equal(skillCarryOverText(""), "", "empty draft carries nothing");
assert.equal(skillCarryOverText("/skill code-review "), "", "/skill scaffolding is not a message");
assert.equal(skillCarryOverText("/skills rev"), "", "/skills filter text is not a message");
assert.equal(skillCarryOverText("/revi"), "", "a command token still being typed is not a message");
assert.equal(
  skillCarryOverText("summarize this:\n\n/skill notes"),
  "summarize this:\n\n/skill notes",
  "prose that merely contains a slash line still carries",
);
assert.equal(
  skillCarryOverText("/skill code-review\n\nlook at the auth path"),
  "look at the auth path",
  "a multi-line /skill draft keeps the paragraph, dropping only the command and name",
);
assert.equal(
  skillCarryOverText("/skill code-review focus on auth"),
  "focus on auth",
  "typed arguments carry when a different skill is picked",
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

// ── skillComposerInsertion: the ＋ menu fills the command WITHOUT clobbering ─
assert.deepEqual(
  skillComposerInsertion("", SKILLS[1]),
  { text: "/skill code-review ", caret: 19 },
  "an empty composer just gets the command",
);
assert.deepEqual(
  skillComposerInsertion("check the token refresh path", SKILLS[1]),
  { text: "/skill code-review check the token refresh path", caret: 19 },
  "an existing draft survives and becomes the skill's arguments",
);
assert.deepEqual(
  skillComposerInsertion("/skill verify ", SKILLS[1]),
  { text: "/skill code-review ", caret: 19 },
  "re-picking replaces the previous command rather than nesting it",
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
// A newline between the skill name and the operator's paragraph used to leave
// the first " " deep inside the prose, so the head token was nonsense, nothing
// resolved, and the whole message was discarded as "unknown skill".
assert.deepEqual(
  resolveSkillInvocation("code-review\n\nplease focus on the auth path", SKILLS),
  { skill: SKILLS[1], args: "please focus on the auth path" },
  "a newline after the skill name splits the head, keeping the message",
);

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

// The inline-menu machinery (option memos, menuOpen union, skills fetch, the
// Skills command-menu rows) lives in the shared use-inline-slash-menus hook;
// what a pick DOES (send in-thread vs start-a-chat) stays per composer.
const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
const menusHook = await readFile(new URL("./use-inline-slash-menus.ts", import.meta.url), "utf8");
assert.match(menusHook, /skillSlashOptions\(activeInvocation\?\.input \?\? "", skills\)/, "the shared hook computes the caret-scoped inline /skill options");
assert.match(menusHook, /const menuOpen = modelMenuActive \|\| skillMenuActive \|\| promptMenuActive \|\| slashSuggestions\.length > 0 \|\| skillCommandRows\.length > 0;/, "menuOpen includes the skill picker and the Skills group");
assert.match(chatView, /command === "\/skill" \|\| command === "\/skills"/, "chat-view dispatches /skill and /skills");
assert.match(chatView, /sendRaw\(buildSkillPrompt\(skill, skillArgs\)\)/, "typed /skill arguments are forwarded into the invocation");
assert.match(chatView, /sendRaw\(buildSkillPrompt\(s, "", carried\)\)/, "picking a skill sends the invocation directive with the composer text carried");
assert.match(chatView, /const carried = skillCarryOverText\(input\);/, "chat-view reads the operator's own text out of the composer before invoking");
assert.match(chatView, /const invokeSkillOption = \(s: SkillOption\)/, "chat-view shares one skill-invoke helper across picker, menu and clicks");
assert.match(chatView, /onPickSkill: \(s\) => invokeSkillOption\(s\)/, "the hook's skill picks route through chat-view's invoke helper");
assert.match(chatView, /s\.argumentHint && !carried && input\.trim\(\)\.toLowerCase\(\) !== filled\.toLowerCase\(\)/, "a hinted skill autofills /skill <id> only over scaffolding, never over a typed message");
assert.match(menusHook, /skillCommandMatches\(activeInvocation\.commandToken, skills\)/, "the shared hook surfaces skills at the active slash token");
assert.match(chatView, /role="listbox" aria-label="Skills"/, "chat-view renders a Skills listbox");
assert.match(menusHook, /fetch\("\/api\/skills\/local"/, "the shared hook sources skills from the local skill scan");

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

// Every composer that can invoke a skill carries the draft instead of clearing
// it, and none of them wipes the composer on an unresolved skill name.
const quickChat = await readFile(new URL("../components/quick-chat-controls.tsx", import.meta.url), "utf8");
for (const [label, src, draftExpr] of [
  ["home-composer", homeComposer, "text"],
  ["quick-chat-controls", quickChat, "draft"],
]) {
  assert.match(
    src,
    new RegExp(`const carried = skillCarryOverText\\(${draftExpr}\\);`),
    `${label} reads the operator's own text before invoking a skill`,
  );
  assert.match(
    src,
    /buildSkillPrompt\(skill, args, carried\)/,
    `${label} sends the carried message with the skill directive`,
  );
  assert.match(
    src,
    /!args &&\s*!carried &&/,
    `${label} only autofills an argument-hint over scaffolding, never over a typed message`,
  );
}
for (const [label, src, clearExpr] of [
  ["chat-view", chatView, 'setInput("")'],
  ["home-composer", homeComposer, 'setText("")'],
  ["quick-chat-controls", quickChat, 'onDraftChange("")'],
]) {
  const unknownBranch = src.slice(src.indexOf("if (!invocation)"));
  assert.equal(
    unknownBranch.slice(0, unknownBranch.indexOf("return")).includes(clearExpr),
    false,
    `${label} keeps the draft when a skill name doesn't resolve`,
  );
}

// The SkillOption type carries the metadata the preview renders.
const lib = await readFile(new URL("./slash-skill.ts", import.meta.url), "utf8");
assert.match(lib, /version\?: string;[\s\S]*?tags\?: string\[\];[\s\S]*?path\?: string;/, "SkillOption carries preview metadata");

console.log("slash-skill.test.ts: ok");
