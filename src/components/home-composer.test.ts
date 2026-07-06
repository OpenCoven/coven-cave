// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");
const destinations = source.match(/const DESTINATIONS:[\s\S]*?\n\];/)?.[0] ?? "";
const handleKeyDownBlock = source.match(/const handleKeyDown = useCallback\([\s\S]*?\n  \);/)?.[0] ?? "";

assert.match(
  destinations,
  /id: "chat"[\s\S]*label: "Chat"/,
  "HomeComposer should frame chat launch as a Chat destination",
);

assert.match(
  destinations,
  /id: "board"[\s\S]*label: "Task"/,
  "HomeComposer should keep Task as a launch destination",
);

assert.doesNotMatch(
  destinations,
  /id: "reminder"[\s\S]*label: "Reminder"/,
  "HomeComposer should not offer Reminder as a home launch destination",
);

assert.match(
  source,
  /useProjects\(\{ familiarId: selectedFamiliarId \|\| null \}\)/,
  "HomeComposer should load a familiar-scoped project list for the project selector",
);

assert.match(
  source,
  /home-composer-headline[\s\S]*?\{`What should we build in \$\{selectedProject\?\.name \?\? "Coven Cave"\}\?`\}/,
  "HomeComposer headline should reflect the selected project name",
);

// Project picker was moved out of the toolbar (no longer rendered inline in
// the composer card). Project context is preserved in the headline and enhancer.
assert.doesNotMatch(
  source,
  /className="hc-project-selector"/,
  "ProjectPicker selector is removed from the home composer toolbar",
);

assert.match(
  source,
  /selectedProjectId === NO_PROJECT_ID\s*\?\s*null/,
  "An explicit No-project selection should resolve to a null project (not fall back to projects[0])",
);

assert.match(
  source,
  /onStartChat\(prompt, selectedFamiliarId, selectedProject\?\.root \?\? null, \{\s*initialControls: \{ thinkingEffort, responseSpeed, \.\.\.\(runtimeHost \? \{ runtimeHost \} : \{\}\) \},[\s\S]*?\}\)/,
  "HomeComposer should hand the selected project root, initial command controls, and any host pick to chat start",
);

assert.match(
  source,
  /body: JSON\.stringify\(\{[\s\S]*?title: prompt,[\s\S]*?familiarId: selectedFamiliarId \|\| null,[\s\S]*?cwd: selectedProject\?\.root \?\? null,[\s\S]*?projectId: selectedProject\?\.id \?\? null,[\s\S]*?\}\)/,
  "HomeComposer should attach the selected project to task creation, crediting the selector's resolved familiar (not the raw active id)",
);

assert.doesNotMatch(
  source,
  /\bselectedResolved\b/,
  "HomeComposer should not reference the removed selectedResolved render local",
);

assert.match(
  source,
  /<HomeSelect[\s\S]*?value=\{selectedRuntimeModelValue\}[\s\S]*?ariaLabel="Choose runtime and model"/,
  "HomeComposer should expose one combined custom runtime/model selector for the selected familiar",
);

assert.match(
  source,
  /runtimeModelSelectGroups[\s\S]*?label: adapter\.label,[\s\S]*?models\.map/,
  "HomeComposer should group model choices under their runtime",
);

assert.match(
  source,
  /const runtimeModelOptionsFor = useCallback\(\s*\(runtime: string\) => catalogForRuntime\(runtime\)\?\.models \?\? \[\],\s*\[\],\s*\)/,
  "HomeComposer model options should be derived strictly from each runtime catalog",
);

assert.match(
  source,
  /runtimeModelOptions\.length === 0\s*\?\s*""[\s\S]*?runtimeModelOptions\.some/,
  "HomeComposer should keep runtime-managed runtimes selected when their catalog has no model options",
);

assert.doesNotMatch(
  source,
  /aria-label="Choose runtime"[\s\S]*value=\{selectedRuntime\}/,
  "HomeComposer should not render a separate runtime selector",
);

assert.doesNotMatch(
  source,
  /aria-label="Choose model"[\s\S]*value=\{selectedModelId\}/,
  "HomeComposer should not render a separate model selector",
);

assert.match(
  source,
  /body: JSON\.stringify\(\{[\s\S]*?\[selectedFamiliarId\]: \{ harness: runtime, model: nextModel \},[\s\S]*?\}\)/,
  "HomeComposer should persist runtime and model together when the combined selector changes runtime",
);

assert.doesNotMatch(
  source,
  /<option[^>]*value="openai\/gpt-5\.5"[\s\S]*?<option[^>]*value="anthropic\/claude/,
  "HomeComposer must not hard-code a mixed-provider model menu",
);

assert.doesNotMatch(
  destinations,
  /id: "inbox"[\s\S]*label: "Schedules"/,
  "HomeComposer should not offer Schedules as an original chat launch destination",
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
  /onStartChat\(prompt, selectedFamiliarId, selectedProject\?\.root \?\? null, \{\s*initialControls: \{ thinkingEffort, responseSpeed, \.\.\.\(runtimeHost \? \{ runtimeHost \} : \{\}\) \},[\s\S]*?\}\)/,
  "HomeComposer should hand the selected agent chat prompt, command controls, and any host pick to the workspace, which opens a new chat that auto-sends it",
);

assert.match(
  source,
  /fetch\("\/api\/board"[\s\S]*?attachments: attachments\.length \? attachments : undefined/,
  "HomeComposer should carry staged attachments onto the created board/Task card",
);

assert.match(
  source,
  /if \(json\.ok\) \{ setText\(""\); writeHomeDraft\(""\); setAttachments\(\[\]\); setEnhanceOriginal\(null\); onNavigateToBoard\(\); \}/,
  "HomeComposer should clear staged attachments (and the persisted draft) after a successful board card creation",
);

assert.match(
  source,
  /onSetActiveFamiliar: \(id: string\) => void/,
  "HomeComposer should accept an active familiar setter for its home-screen agent selector",
);

assert.match(
  source,
  /<HomeSelect[\s\S]*?value=\{selectedFamiliarId\}[\s\S]*?ariaLabel="Choose chat agent"/,
  "HomeComposer should include a custom agent selector when starting chat from home",
);

assert.doesNotMatch(
  source,
  /<select\b/,
  "HomeComposer toolbar dropdowns should be custom popovers, not native selects",
);

assert.match(
  source,
  /COMMAND_THINKING_OPTIONS/,
  "HomeComposer should use shared thinking effort options",
);

assert.match(
  source,
  /const \[thinkingEffort, setThinkingEffort\] = useState<CommandThinkingEffort>\(\s*COMMAND_CONTROL_DEFAULTS\.thinkingEffort,\s*\)/,
  "HomeComposer should initialise thinking effort from shared command control defaults",
);

assert.match(
  source,
  /const \[responseSpeed, setResponseSpeed\] = useState<CommandResponseSpeed>\(\s*COMMAND_CONTROL_DEFAULTS\.responseSpeed,\s*\)/,
  "HomeComposer should initialise response speed from shared command control defaults",
);

assert.match(
  source,
  /function HomeSelect\([\s\S]*?<StandardSelect[\s\S]*?label=\{ariaLabel\}[\s\S]*?popoverClassName="hc-home-select-popover"[\s\S]*?groupClassName="hc-home-select-group"[\s\S]*?renderValue=/,
  "HomeComposer compact command select should delegate option rendering to StandardSelect with the supplied aria label and selected value",
);

assert.match(
  source,
  /"Choose thinking effort"/,
  "HomeComposer should render a thinking effort select with an accessible label",
);

// Speed control removed from toolbar (response speed passed via initialControls default).

assert.match(
  css,
  /\.hc-control-group\b/,
  "HomeComposer CSS should define grouped command controls",
);

assert.match(
  css,
  /\.hc-control-group\s*\{[\s\S]*?flex-wrap: nowrap;[\s\S]*?gap: 6px;/,
  "HomeComposer command clusters should stay together with compact internal spacing",
);

assert.match(
  css,
  /\.hc-control-group--who\s*\{[\s\S]*?flex: 0 1 auto;[\s\S]*?\.hc-control-group--run\s*\{[\s\S]*?flex: 0 1 auto;[\s\S]*?margin-left: auto;/,
  "HomeComposer action bar should keep the who cluster content-sized and pin the run cluster to the right edge",
);

assert.match(
  css,
  /\.home-composer-card-wrap\s*\{[\s\S]*?container-type: inline-size;/,
  "HomeComposer card wrapper should establish an inline-size container",
);

assert.doesNotMatch(
  css,
  /\.home-composer-card[\s\S]{0,120}\.home-composer-card/,
  "HomeComposer CSS should not introduce nested home-composer-card styling",
);

assert.doesNotMatch(
  source,
  /native Cave chat only supports Codex, Claude Code, and Hermes right now/,
  "HomeComposer should allow OpenClaw familiars through native chat send",
);

assert.match(
  handleKeyDownBlock,
  /\[[\s\S]*handleSubmit[\s\S]*modelMenuActive[\s\S]*modelOptions[\s\S]*\]/,
  "HomeComposer Enter-submit keyboard handler should depend on the current submit callback and model menu state",
);

assert.doesNotMatch(
  handleKeyDownBlock,
  /eslint-disable-next-line react-hooks\/exhaustive-deps/,
  "HomeComposer keyboard handler should not suppress exhaustive deps and risk stale command controls",
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
    /aria-expanded=\{menuOpen\}/,
    `${name} composer textarea should track whether either inline menu (slash or /model) is open`,
  );
  assert.doesNotMatch(
    src,
    /<textarea[\s\S]*?role="combobox"/,
    `${name} composer textarea should keep its implicit textbox role; combobox is invalid on native textarea`,
  );
  assert.match(
    src,
    /aria-controls=\{menuOpen \? slashListboxId : undefined\}/,
    `${name} aria-controls should reference the listbox only while the menu is open`,
  );
  assert.match(
    src,
    /aria-activedescendant=\{\s*menuOpen \? `\$\{slashListboxId\}-opt-\$\{slashIdx\}` : undefined\s*\}/,
    `${name} aria-activedescendant should track the highlighted index and be absent when the menu is closed`,
  );
  // menuOpen unifies the slash-command and /model listboxes (both share the
  // listbox id), so the combobox ARIA covers the /model picker too — not just
  // the slash menu. Both composers must use it. (HomeComposer additionally gates
  // the slash term on its Escape-dismiss flag: `(!slashDismissed && …)`.)
  assert.match(
    src,
    /const menuOpen =\s*modelMenuActive \|\| skillMenuActive \|\|[\s\S]{0,40}slashSuggestions\.length > 0/,
    `${name} combobox ARIA must reflect every inline menu (slash, /model, /skill)`,
  );
}

// ── HomeComposer combobox ARIA covers the /model picker, not just slash ──────
// Both inline listboxes share the listbox id; menuOpen unifies them so the
// textarea announces the /model picker too (was: slash-only). The slash term is
// gated on the Escape-dismiss flag so a dismissed menu also drops the combobox
// ARIA.
assert.match(
  source,
  /const menuOpen =\s*modelMenuActive \|\| skillMenuActive \|\| \(!slashDismissed && slashSuggestions\.length > 0\);/,
  "HomeComposer combobox ARIA reflects every inline menu (slash, /model, /skill)",
);

// ── /skill + /skills inline picker (mirrors /model) ──────────────────────────
assert.match(source, /skillSlashOptions\(text, skills\)/, "HomeComposer offers inline /skill autocomplete");
assert.match(source, /command === "\/skill" \|\| command === "\/skills"/, "HomeComposer handles the /skill and /skills commands");
assert.match(source, /role="listbox" aria-label="Skills"/, "HomeComposer renders a Skills picker listbox");
assert.match(source, /buildSkillPrompt\(skill\)/, "HomeComposer invokes a skill by starting a chat with the skill prompt");

// ── Destination pills are an accessible single-select radiogroup ─────────────
assert.match(
  source,
  /className="hc-dest-pills"\s+role="radiogroup"\s+aria-label="Send to"\s+ref=\{destGroupRef\}\s+onKeyDown=\{handleDestKeyDown\}/,
  "Destination pills form a labelled radiogroup with keyboard navigation",
);
assert.match(
  source,
  /role="radio"\s+aria-checked=\{destination === d\.id\}\s+tabIndex=\{destination === d\.id \? 0 : -1\}/,
  "Each destination pill is a radio that announces its checked state and roves the tab stop",
);
assert.match(
  source,
  /const nav = \["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"\];/,
  "The radiogroup supports arrow/Home/End keyboard selection per the ARIA radio pattern",
);

// ── Single-row toolbar replaces mode strip + run rail ───────────────────────
// The top mode strip and the separate run rail were removed.
// Controls are now in one action bar: [+] [Chat/Task] [access chip] · [●] [model] [think] [mic] [send]
assert.doesNotMatch(
  source,
  /className="hc-mode-strip"/,
  "The mode strip is removed from the composer card",
);
assert.doesNotMatch(
  source,
  /className="hc-run-rail"/,
  "The secondary run-settings rail is removed from the composer card",
);
assert.match(
  source,
  /hc-control-group--who[\s\S]*?ph:plus-bold[\s\S]*?hc-dest-pills[\s\S]*?ph:warning-circle[\s\S]*?ariaLabel="Choose chat agent"[\s\S]*?hc-access-chip[\s\S]*?hc-control-group--run[\s\S]*?hc-status-dot[\s\S]*?ariaLabel="Choose runtime and model"[\s\S]*?ariaLabel="Choose thinking effort"[\s\S]*?hc-mic-btn[\s\S]*?aria-label="Send"/,
  "The action bar toolbar has: attach/destination/access-chip left, status/model/thinking/mic/send right",
);

// ── Model selection moved to the /model slash command ────────────────────────
assert.doesNotMatch(
  source,
  /ChatModelControl/,
  "HomeComposer no longer renders the model picker (moved into /model)",
);

assert.match(
  source,
  /\/api\/chat\/model-state\?familiarId=/,
  "HomeComposer still GETs model-state (for the current model + harness)",
);

assert.match(
  source,
  /scope: "familiar-default"/,
  "HomeComposer persists a /model pick as the familiar default",
);

assert.match(
  source,
  /modelSlashOptions\(text, modelHarness\)/,
  "HomeComposer offers inline /model autocomplete",
);

assert.match(
  source,
  /command === "\/model"/,
  "HomeComposer handles the /model command",
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
  /useEffect\(\(\) => \{\s*const timer = window\.setTimeout\(\(\) => \{\s*writeHomeDraft\(text\);\s*\}, HOME_DRAFT_WRITE_DELAY_MS\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[text\]\)/,
  "the home draft is debounced so mobile typing does not write localStorage on every keystroke",
);
// A send unmounts the composer (mode switches to chat/board), which cancels the
// debounced draft-write before it can flush the cleared text — so the submit
// path must clear the persisted draft synchronously, or the sent prompt
// resurrects on the next Home visit.
assert.match(
  source,
  /setText\(""\);\s*(?:\/\/[^\n]*\n\s*)*writeHomeDraft\(""\);/,
  "the chat send path clears the persisted draft synchronously (not only via the debounced effect)",
);
assert.match(
  source,
  /if \(text\) window\.localStorage\.setItem\(HOME_DRAFT_KEY, text\);\s*else window\.localStorage\.removeItem\(HOME_DRAFT_KEY\)/,
  "an emptied home draft removes the key (sent prompts don't reappear on reload)",
);

// The ↑/↓ prompt-history also survives a reload.
assert.match(
  source,
  /const \[history, setHistory\] = useState<string\[\]>\(\(\) => readComposerHistory\(HOME_HISTORY_KEY\)\)/,
  "home prompt history initialises from the persisted recall stack",
);
assert.match(
  source,
  /writeComposerHistory\(HOME_HISTORY_KEY, history\)/,
  "home prompt history is persisted when it changes",
);

// ── Attachments ─────────────────────────────────────────────────────────────
assert.match(
  source,
  /className="hc-add-btn"[\s\S]*?onClick=\{\(\) => fileInputRef\.current\?\.click\(\)\}[\s\S]*?ph:plus-bold/,
  "the + launcher uses a plus-bold icon that opens the file picker",
);
assert.match(
  source,
  /<input[\s\S]*?type="file"[\s\S]*?multiple[\s\S]*?onChange=\{\(e\) => \{ void addFiles\(e\.target\.files\)/,
  "a hidden multi-file input feeds addFiles",
);
assert.match(
  source,
  /attachments\.map\(\(att\) =>[\s\S]*?attachmentIcon\(att\)[\s\S]*?removeAttachment\(att\.id\)/,
  "staged attachments render as removable chips",
);
assert.doesNotMatch(source, /const openCommands =/, "the old slash-launcher click handler is retired (slash still opens on typing '/')");
assert.match(
  source,
  /initialAttachments: outgoing/,
  "staged attachments are threaded into the started chat",
);
// Enhance button removed from toolbar; logic stays for potential future use.
assert.match(
  source,
  /import \{ buildPromptEnhancement \} from "@\/lib\/prompt-enhancer"/,
  "Enhance uses the shared pure prompt enhancer",
);
assert.doesNotMatch(
  source,
  /fetch\("\/api\/prompt\/enhance"/,
  "Enhance should not round-trip through the prompt-enhance API route",
);
assert.match(
  source,
  /mode: destination === "board" \? "task" : "chat"/,
  "Enhance should optimize the prompt for the active Chat or Task destination",
);
assert.match(
  source,
  /selectedFiles: attachments\.map\(\(attachment\) => attachment\.name\)/,
  "Enhance should include staged attachment names as file context",
);
// Enhance undo UI removed from toolbar; revertEnhance callback remains in code.

// ── Drag-and-drop attachments ───────────────────────────────────────────────
assert.match(
  source,
  /onDrop=\{\(e\) => \{[\s\S]*?hasDraggedFiles\(e\.dataTransfer\.types\)[\s\S]*?void addFiles\(e\.dataTransfer\.files\)/,
  "dropping files onto the composer card routes through addFiles",
);
assert.match(
  source,
  /onDragEnter=\{\(e\) => \{[\s\S]*?setDropActive\(true\)/,
  "a file drag arms the drop overlay",
);
assert.match(
  source,
  /dropActive \? \([\s\S]*?hc-drop-overlay[\s\S]*?Drop files to attach/,
  "an overlay prompts to drop files while dragging",
);

// ── Paste-to-attach ─────────────────────────────────────────────────────────
assert.match(
  source,
  /onPaste=\{\(e\) => \{[\s\S]*?e\.clipboardData\.items[\s\S]*?item\.kind === "file"[\s\S]*?void addFiles\(pastedFiles\)/,
  "pasting files into the composer stages them as attachments",
);

// ── Image attachment thumbnails ─────────────────────────────────────────────
assert.match(
  source,
  /const isImage = \(att\.mimeType \?\? att\.type\)\?\.startsWith\("image\/"\)/,
  "image attachments are detected for a preview thumbnail",
);
assert.match(
  source,
  /isImage && att\.dataUrl \?[\s\S]*?<img src=\{att\.dataUrl\}[\s\S]*?className="hc-attachment-thumb"/,
  "image chips render a preview thumbnail instead of the generic icon",
);

// ── Attachment count + clear-all ────────────────────────────────────────────
assert.match(
  source,
  /hc-attachments-count[\s\S]*?\{attachments\.length\}\/10 attached/,
  "the attachments header shows a count out of the 10 cap",
);
assert.match(
  source,
  /hc-attachments-clear[\s\S]*?onClick=\{\(\) => setAttachments\(\[\]\)\}[\s\S]*?Clear all/,
  "a Clear all control empties the staged attachments",
);

// ─── a11y: Escape dismisses the inline menus; enhance/attach announce ─────────
// The slash/model/skill menu footers advertise "Esc cancel", but nothing wired
// Escape — the menus re-open purely as a function of the text. A dismissed flag
// (reset on text change) closes them; and the genuinely-silent state changes
// (enhance success, attachment add — neither raises a toast) announce to the
// shared live region so screen-reader users aren't left guessing.
assert.match(
  source,
  /const \[slashDismissed, setSlashDismissed\] = useState\(false\)/,
  "a slashDismissed flag backs Escape-to-dismiss for the inline menus",
);
assert.match(
  source,
  /if \(e\.key === "Escape" && menuOpen\) \{[\s\S]{0,120}setSlashDismissed\(true\);[\s\S]{0,40}return;/,
  "Escape closes any open inline menu (the footers advertise Esc cancel)",
);
assert.match(
  source,
  /setSlashIdx\(0\);\s*setSlashDismissed\(false\);/,
  "the dismissed flag resets when the text changes so a fresh token re-opens the menu",
);
assert.match(
  source,
  /const modelMenuActive = !slashDismissed &&/,
  "the model menu respects the dismissed flag",
);
assert.match(
  source,
  /const skillMenuActive = !slashDismissed &&/,
  "the skill menu respects the dismissed flag",
);
assert.match(
  source,
  /const \{ announce \} = useAnnouncer\(\)/,
  "HomeComposer wires the shared live-region announcer",
);
assert.match(
  source,
  /setText\(result\.enhanced\);\s*announce\("Prompt enhanced", "polite"\)/,
  "a successful enhance is announced (the textarea swap is otherwise silent to AT)",
);
assert.match(
  source,
  /Attached \$\{next\.length\} file/,
  "adding attachments is announced (there is no toast on the success path)",
);
