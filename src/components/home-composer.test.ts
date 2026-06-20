// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const destinations = source.match(/const DESTINATIONS:[\s\S]*?\n\];/)?.[0] ?? "";

assert.match(
  destinations,
  /id: "chat"[\s\S]*label: "Familiar"/,
  "HomeComposer should frame chat launch as a Familiar destination",
);

assert.match(
  destinations,
  /id: "board"[\s\S]*label: "Tasks"/,
  "HomeComposer should keep Tasks as a launch destination",
);

assert.match(
  destinations,
  /id: "reminder"[\s\S]*label: "Reminder"/,
  "HomeComposer should keep Reminder as a launch destination",
);

assert.doesNotMatch(
  destinations,
  /id: "inbox"[\s\S]*label: "Automations"/,
  "HomeComposer should not offer Automations as an original chat launch destination",
);

assert.doesNotMatch(
  destinations,
  /id: "call"[\s\S]*label: "Call"/,
  "HomeComposer should not offer Call as an original chat launch destination",
);

assert.doesNotMatch(
  source,
  /\/api\/chat\/send/,
  "HomeComposer must not send chats itself — its cancel-after-session-event pattern aborted the request, killed the harness, and lost the transcript. Chat sends belong to ChatView.",
);

assert.match(
  source,
  /onStartChat\(prompt, selectedFamiliarId\)/,
  "HomeComposer should hand the selected agent chat prompt to the workspace, which opens a new chat that auto-sends it",
);

assert.match(
  source,
  /onSetActiveFamiliar: \(id: string\) => void/,
  "HomeComposer should accept an active familiar setter for its home-screen agent selector",
);

assert.match(
  source,
  /aria-label="Choose chat agent"[\s\S]*value=\{selectedFamiliarId\}/,
  "HomeComposer should include an agent selector when starting chat from home",
);

assert.doesNotMatch(
  source,
  /native Cave chat only supports Codex, Claude Code, and Hermes right now/,
  "HomeComposer should allow OpenClaw familiars through native chat send",
);

// ─── CHAT-D2-04: textarea/listbox ARIA on both slash menus ───────────────────
// The slash menus were plain ul/li/button with a visual-only active class —
// screen readers announced nothing about the menu or the highlighted command.
// Both composers keep native textarea semantics while exposing their popup:
// menu = listbox, rows = options, aria-haspopup points at the popup kind, and
// aria-activedescendant conveys the highlight while focus stays in the textarea.

const chatSource = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

for (const [name, src] of [
  ["HomeComposer", source],
  ["ChatView", chatSource],
]) {
  assert.match(
    src,
    /id=\{slashListboxId\} role="listbox" aria-label="Slash commands"/,
    `${name} slash menu should be a labelled listbox with a stable id`,
  );
  assert.match(
    src,
    /role="option"\s+id=\{`\$\{slashListboxId\}-opt-\$\{i\}`\}\s+aria-selected=\{active\}/,
    `${name} slash rows should be options with stable ids and aria-selected on the highlighted row`,
  );
  assert.match(
    src,
    /role="option"[\s\S]{0,200}?<button\s+type="button"\s+tabIndex=\{-1\}/,
    `${name} option buttons must be out of the tab order — focus stays in the textarea, aria-activedescendant conveys selection`,
  );
  assert.match(src, /aria-autocomplete="list"/, `${name} composer textarea should expose list autocomplete`);
  assert.match(src, /aria-haspopup="listbox"/, `${name} composer textarea should advertise the listbox popup`);
  assert.match(
    src,
    /aria-expanded=\{slashSuggestions\.length > 0\}/,
    `${name} composer textarea should track whether the slash menu is open`,
  );
  assert.doesNotMatch(
    src,
    /<textarea[\s\S]*?role="combobox"/,
    `${name} composer textarea should keep its implicit textbox role; combobox is invalid on native textarea`,
  );
  assert.match(
    src,
    /aria-controls=\{slashSuggestions\.length > 0 \? slashListboxId : undefined\}/,
    `${name} aria-controls should reference the listbox only while the menu is open`,
  );
  assert.match(
    src,
    /aria-activedescendant=\{\s*slashSuggestions\.length > 0 \? `\$\{slashListboxId\}-opt-\$\{slashIdx\}` : undefined\s*\}/,
    `${name} aria-activedescendant should track the highlighted index and be absent when the menu is closed`,
  );
}

// ── Model picker (home composer) ──────────────────────────────────────────────
assert.match(
  source,
  /import \{ ChatModelControl \} from "@\/components\/chat-model-control"/,
  "HomeComposer should import the shared ChatModelControl",
);

assert.match(
  source,
  /\/api\/chat\/model-state\?familiarId=/,
  "HomeComposer should GET model-state for the selected familiar",
);

assert.match(
  source,
  /scope: "familiar-default"/,
  "HomeComposer should persist a model pick as the familiar default",
);

assert.match(
  source,
  /destination === "chat" && selectedFamiliarId[\s\S]{0,120}<ChatModelControl/,
  "HomeComposer should render the model picker only for the chat destination with a familiar selected",
);

assert.match(
  source,
  /<ChatModelControl[\s\S]{0,120}state=\{modelState\}[\s\S]{0,120}onSelectModel=\{handleSelectModel\}/,
  "HomeComposer model picker should be wired to modelState + handleSelectModel",
);

assert.doesNotMatch(
  source,
  /scope: "session"/,
  "HomeComposer must not use session scope — there is no session at home",
);

// The home prompt draft survives a reload: text initialises from localStorage,
// is written back on change, and is removed when emptied (e.g. after a send).
assert.match(
  source,
  /const \[text, setText\] = useState\(\(\) => readHomeDraft\(\)\)/,
  "home composer text initialises from the persisted draft",
);
assert.match(
  source,
  /useEffect\(\(\) => \{\s*writeHomeDraft\(text\);\s*\}, \[text\]\)/,
  "the home draft is persisted whenever the prompt changes",
);
assert.match(
  source,
  /if \(text\) window\.localStorage\.setItem\(HOME_DRAFT_KEY, text\);\s*else window\.localStorage\.removeItem\(HOME_DRAFT_KEY\)/,
  "an emptied home draft removes the key (sent prompts don't reappear on reload)",
);
