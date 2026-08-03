// @ts-nocheck
// Guards the rule that #4203, #4208 and this change all land on: a surface may
// not pick WHICH familiar does the work. Familiars are the user's own roster —
// `familiars[0]` is whichever one happens to sort first, so defaulting to it
// silently assigns work, spends the wrong model's tokens, or (worst) changes
// the active familiar out from under the user.
//
// A default IS fine when it seeds a control the user can see and change. What
// this file pins is the consequential paths, where the answer must come from
// the user's own choice or from an explicit picker.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
// Assert against CODE, not prose: these files explain the rule in comments that
// necessarily quote the anti-pattern, and a blunt source match would trip on
// its own documentation.
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
const chatList = code("./chat-list.tsx");
const chatListSource = read("./chat-list.tsx");
const chatRouter = code("./chat-router.tsx");
const skillBuilder = code("./marketplace/skill-builder.tsx");
const marketplace = read("./marketplace-view.tsx");

// ── Starting a chat ──────────────────────────────────────────────────────────
// Scoped to one familiar, that choice carries. Unscoped, hand null down so
// chat-router falls through to NewChatLaunch instead of adopting a default.
assert.match(
  chatListSource,
  /const scopedFamiliarId = familiar\?\.id \?\? null;/,
  "chat-list does not invent a familiar when unscoped",
);
assert.doesNotMatch(
  chatList,
  /familiar\?\.id \?\? familiars\[0\]/,
  "chat-list's new-chat default is not familiars[0]",
);
// The control must stay usable — the fix is "ask downstream", not "disable".
assert.match(
  chatList,
  /const canStartChat = familiars\.length > 0;/,
  "New chat stays enabled whenever any chat can start",
);
assert.doesNotMatch(chatList, /disabled=\{!fallbackFamiliarId\}/, "the button no longer gates on a guessed familiar");

// chat-router must not substitute one either — selectFamiliarForChat(null)
// falls back to visibleFamiliars[0] AND calls onSetActiveFamiliar, so calling
// it with nothing is what changed the active familiar as a side effect.
assert.match(
  chatRouter,
  /const next = familiarId \? selectFamiliarForChat\(familiarId\) : null;/,
  "the sidebar new-chat path leaves the familiar unset when none was chosen",
);
assert.match(
  chatRouter,
  /const nextFamiliarId = group\?\.defaultFamiliarId \?\? familiar\?\.id \?\? null;/,
  "the project-grouped new-chat path asks rather than defaulting",
);
assert.doesNotMatch(
  chatRouter,
  /group\?\.defaultFamiliarId \?\? fallbackFamiliarId/,
  "the retired fallback is not reachable from a new chat",
);

// Booting into chat is the same decision at startup: a first run, or a cleared
// or deleted active familiar, used to land on a composer silently bound to
// visibleFamiliars[0] — and the user's FIRST message went to it.
assert.match(
  chatRouter,
  /familiarId: familiar\?\.id \?\? null \}/,
  "boot-compose opens the composer unbound when no familiar is active",
);
assert.match(
  chatRouter,
  /if \(visibleFamiliars\.length === 0\) return;/,
  "boot-compose waits for the roster instead of adopting its first entry",
);

// ── Running an LLM call ──────────────────────────────────────────────────────
// Enhance runs through a familiar's model, so it takes the ACTIVE one and
// tolerates null (usePromptEnhance has a hosted fallback for exactly this).
assert.match(skillBuilder, /familiarId: activeFamiliarId,/, "Enhance uses the active familiar");
assert.doesNotMatch(skillBuilder, /familiars\[0\]/, "Enhance does not borrow the first familiar");
assert.match(marketplace, /activeFamiliarId=\{activeFamiliarId\}/, "the surface threads the active familiar through");

// ── Reporting state ──────────────────────────────────────────────────────────
// The eval loop is per-familiar. Rendering familiars[0]'s status unlabelled, in
// a panel whose own copy says every familiar can load the skill, was showing
// one arbitrary familiar's state as if it were the skill's.
// The skill drawer's version of this bug (it queried familiars[0] for an
// eval-loop status and rendered it unattributed) is gone by a stronger route:
// the component was orphaned — nothing imported it — and has been deleted
// outright, along with the adapter that fed it. Assert the file's absence
// rather than its contents.
assert.throws(
  () => readFileSync(new URL("./skill-detail-drawer.tsx", import.meta.url)),
  "the orphaned skill drawer is deleted, not merely corrected",
);

console.log("familiar-no-silent-default.test.ts OK");
