// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  skillSlashOptions,
  resolveSkillArg,
  buildSkillPrompt,
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

// ── resolveSkillArg: exact then substring ────────────────────────────────────
assert.equal(resolveSkillArg("verify", SKILLS)?.id, "verify", "exact name");
assert.equal(resolveSkillArg("CODE-REVIEW", SKILLS)?.id, "code-review", "case-insensitive exact");
assert.equal(resolveSkillArg("research", SKILLS)?.id, "deep-research", "substring");
assert.equal(resolveSkillArg("", SKILLS), null, "empty → null");
assert.equal(resolveSkillArg("zzz", SKILLS), null, "unknown → null");

// ── buildSkillPrompt / formatSkillList ───────────────────────────────────────
assert.equal(buildSkillPrompt(SKILLS[0]), 'Use the "deep-research" skill.', "invocation prompt names the skill");
const list = formatSkillList(SKILLS);
assert.match(list, /Available skills/, "list has a header");
assert.match(list, /deep-research/, "list includes each skill");
assert.match(formatSkillList([]), /No skills found/, "empty list is explained");

// ── Catalog + composer wiring (source-text) ──────────────────────────────────
const slashCmds = await readFile(new URL("./slash-commands.ts", import.meta.url), "utf8");
assert.match(slashCmds, /name: "\/skill",[\s\S]*?argPlaceholder: "name"/, "/skill is registered with an arg placeholder");
assert.match(slashCmds, /name: "\/skills"/, "/skills is registered");

const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
assert.match(chatView, /skillSlashOptions\(input, skills\)/, "chat-view computes the inline /skill options");
assert.match(chatView, /const menuOpen = modelMenuActive \|\| skillMenuActive \|\| slashSuggestions\.length > 0;/, "chat-view menuOpen includes the skill picker");
assert.match(chatView, /command === "\/skill" \|\| command === "\/skills"/, "chat-view dispatches /skill and /skills");
assert.match(chatView, /sendRaw\(buildSkillPrompt\(skill\)\)/, "chat-view invokes a skill by sending the skill prompt");
assert.match(chatView, /role="listbox" aria-label="Skills"/, "chat-view renders a Skills listbox");
assert.match(chatView, /fetch\("\/api\/skills\/local"/, "chat-view sources skills from the local skill scan");

// ── Skill detail preview in the picker ───────────────────────────────────────
const preview = await readFile(new URL("../components/skill-detail-preview.tsx", import.meta.url), "utf8");
assert.match(preview, /export function SkillDetailPreview\(\{ skill \}/, "exports a SkillDetailPreview component");
assert.match(preview, /skill\.description/, "preview shows the full description");
assert.match(preview, /skill\.tags\?\.length/, "preview shows tags when present");
assert.match(preview, /skill\.path/, "preview shows the skill path");
assert.match(preview, /skill\.familiar/, "preview shows the skill scope");

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
