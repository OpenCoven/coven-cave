// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const draftHook = await readFile(new URL("../lib/use-composer-draft.ts", import.meta.url), "utf8");
const attachHook = await readFile(new URL("../lib/use-attachment-staging.ts", import.meta.url), "utf8");
const homeSelect = await readFile(new URL("./home/home-select.tsx", import.meta.url), "utf8");
const modelStateHook = await readFile(new URL("./home/use-home-model-state.ts", import.meta.url), "utf8");
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
  /home-composer-headline[\s\S]*?\{"What should we build in "\}[\s\S]*?home-composer-headline-project[\s\S]*?\{selectedProject\?\.name \?\? "Coven Cave"\}/,
  "HomeComposer headline should reflect the selected project name (accent-tinted project span)",
);

// ── Hero presence eyebrow ────────────────────────────────────────────────────
// The greeting samples the client clock AFTER mount (SSR markup must stay
// deterministic), fades in via .is-ready, and derives from the pure
// greetingForHour helper so the boundaries unit-test exactly.
assert.match(
  source,
  /import \{ greetingForHour \} from "@\/lib\/home-greeting"/,
  "the hero greeting derives from the pure home-greeting helper",
);
assert.match(
  source,
  /const \[greeting, setGreeting\] = useState<string \| null>\(null\);[\s\S]*?useEffect\(\(\) => \{\s*setGreeting\(greetingForHour\(new Date\(\)\.getHours\(\)\)\);\s*\}, \[\]\)/,
  "the greeting is sampled after mount so SSR/client markup can't drift",
);
assert.match(
  source,
  /home-composer-eyebrow\$\{greeting \? " is-ready" : ""\}/,
  "the eyebrow fades in via .is-ready once the client greeting lands",
);
assert.match(
  source,
  /className="home-halo" aria-hidden/,
  "the hearth-glow halo renders behind the composer card and is hidden from AT",
);

// Project selector lives in the composer toolbar so the user can choose which
// project a new chat runs in (mirrors the chat composer). It's a standalone
// ProjectPicker — its own search popover, so it can't nest in the ⚙ menu.
assert.match(
  source,
  /<ProjectPicker[\s\S]*value=\{selectedProjectId \|\| null\}[\s\S]*onChange=\{setSelectedProjectId\}[\s\S]*className="hc-project-selector"/,
  "ProjectPicker is rendered in the home composer toolbar, wired to selectedProjectId",
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
  /<ComposerOptionsMenu[\s\S]*?hostValue=\{runtimeHost \?\? LOCAL_HOST_ID\}[\s\S]*?onHostPick=\{setRuntimeHost\}/,
  "HomeComposer collapses response controls into the chat composer's Options menu, with the Host picker wired to runtimeHost",
);

assert.match(
  source,
  /id: "runtime",[\s\S]*?value: selectedRuntime,[\s\S]*?options: runtimeSectionOptions,[\s\S]*?handleSelectRuntime\(id\)/,
  "the Options menu exposes a Runtime section that persists runtime picks",
);

assert.match(
  source,
  /\.\.\.\(runtimeModelOptions\.length > 0[\s\S]*?id: "model",[\s\S]*?options: runtimeModelOptions\.map\(\(m\) => \(\{ value: m\.id, label: m\.label \}\)\),[\s\S]*?handleSelectModel\(id\)/,
  "the Options menu Model section lists the selected runtime's catalog and is omitted for runtime-managed runtimes",
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
  modelStateHook,
  /body: JSON\.stringify\(\{[\s\S]*?\[selectedFamiliarId\]: \{ harness: runtime, model: nextModel \},[\s\S]*?\}\)/,
  "useHomeModelState should persist runtime and model together when the combined selector changes runtime",
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
  /if \(json\.ok\) \{ setText\(""\); clearDraft\(\); clearAttachments\(\); setEnhanceOriginal\(null\); onNavigateToBoard\(\); \}/,
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
  homeSelect,
  /function HomeSelect\([\s\S]*?<StandardSelect[\s\S]*?label=\{ariaLabel\}[\s\S]*?popoverClassName="hc-home-select-popover"[\s\S]*?groupClassName="hc-home-select-group"[\s\S]*?renderValue=/,
  "HomeComposer compact command select should delegate option rendering to StandardSelect with the supplied aria label and selected value",
);

assert.match(
  source,
  /id: "thinking",[\s\S]*?label: "Thinking",[\s\S]*?COMMAND_THINKING_OPTIONS/,
  "the Options menu exposes the shared thinking-effort options",
);

assert.match(
  source,
  /id: "speed",[\s\S]*?label: "Speed",[\s\S]*?COMMAND_RESPONSE_SPEED_OPTIONS/,
  "the Options menu exposes the shared response-speed options",
);

// Speed control removed from toolbar (response speed passed via initialControls default).

assert.match(
  source,
  /className="cave-composer-controls"[\s\S]*?className="cave-composer-control-row"[\s\S]*?className="cave-composer-utility-row"[\s\S]*?className="cave-composer-submit-row"/,
  "HomeComposer reuses the chat composer's footer row structure",
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
// HomeComposer delegates its popover JSX to the shared HomeSlashMenu component
// (Task 6: collapse the three near-duplicate popovers into one); ChatView still
// inlines its own menus, so the ARIA/JSX assertions below check each in its
// own source file rather than looping over a single `src`.
const slashMenu = await readFile(new URL("./home/home-slash-menu.tsx", import.meta.url), "utf8");

assert.match(
  slashMenu,
  /id=\{listboxId\} role="listbox" aria-label=\{ariaLabel\}/,
  "HomeSlashMenu should render a labelled listbox with a stable id",
);
assert.match(
  slashMenu,
  /role="option"\s+id=\{`\$\{listboxId\}-opt-\$\{i\}`\}\s+aria-selected=\{active\}/,
  "HomeSlashMenu rows should be options with stable ids and aria-selected on the highlighted row",
);
assert.match(
  slashMenu,
  /role="option"[\s\S]{0,200}?<button\s+type="button"\s+tabIndex=\{-1\}/,
  "HomeSlashMenu option buttons must be out of the tab order — focus stays in the textarea, aria-activedescendant conveys selection",
);
assert.match(
  source,
  /<HomeSlashMenu[\s\S]*?listboxId=\{slashListboxId\}[\s\S]*?ariaLabel="Slash commands"/,
  "HomeComposer should render its slash-command menu through HomeSlashMenu with the shared listbox id and a 'Slash commands' label",
);

assert.match(
  chatSource,
  /id=\{slashListboxId\} role="listbox" aria-label="Slash commands"/,
  "ChatView slash menu should be a labelled listbox with a stable id",
);
assert.match(
  chatSource,
  /role="option"\s+id=\{`\$\{slashListboxId\}-opt-\$\{i\}`\}\s+aria-selected=\{active\}/,
  "ChatView slash rows should be options with stable ids and aria-selected on the highlighted row",
);
assert.match(
  chatSource,
  /role="option"[\s\S]{0,200}?<button\s+type="button"\s+tabIndex=\{-1\}/,
  "ChatView option buttons must be out of the tab order — focus stays in the textarea, aria-activedescendant conveys selection",
);

for (const [name, src] of [
  ["HomeComposer", source],
  ["ChatView", chatSource],
]) {
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
    /const menuOpen =\s*modelMenuActive \|\| skillMenuActive \|\|[\s\S]{0,80}slashSuggestions\.length > 0/,
    `${name} combobox ARIA must reflect every inline menu (slash, /model, /skill, /prompt)`,
  );
}

// ── HomeComposer combobox ARIA covers the /model picker, not just slash ──────
// Both inline listboxes share the listbox id; menuOpen unifies them so the
// textarea announces the /model picker too (was: slash-only). The slash term is
// gated on the Escape-dismiss flag so a dismissed menu also drops the combobox
// ARIA.
assert.match(
  source,
  /const menuOpen =\s*modelMenuActive \|\| skillMenuActive \|\| promptMenuActive \|\|\s*\(!slashDismissed && \(slashSuggestions\.length > 0 \|\| skillCommandRows\.length > 0\)\);/,
  "HomeComposer combobox ARIA reflects every inline menu (slash, /model, /skill, /prompt, Skills group)",
);

// ── /skill + /skills inline picker (mirrors /model) ──────────────────────────
assert.match(source, /skillSlashOptions\(text, skills\)/, "HomeComposer offers inline /skill autocomplete");
assert.match(source, /command === "\/skill" \|\| command === "\/skills"/, "HomeComposer handles the /skill and /skills commands");
assert.match(
  source,
  /<HomeSlashMenu[\s\S]*?ariaLabel="Skills"[\s\S]*?preview=\{<SkillDetailPreview/,
  "HomeComposer renders a Skills picker listbox (via HomeSlashMenu) with the skill detail preview",
);
assert.match(source, /buildSkillPrompt\(skill, args\)/, "HomeComposer invokes a skill by starting a chat with the skill prompt (typed arguments ride along)");
assert.match(
  source,
  /skill\.argumentHint && !args && text\.trim\(\)\.toLowerCase\(\) !== filled\.toLowerCase\(\)/,
  "A hinted skill autofills /skill <id> for argument editing instead of starting a chat",
);

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
// The top mode strip and the separate run rail were removed. The footer is the
// chat composer's: attach/voice/Options + Chat-Task pills + agent chip on the
// left, enhance + send on the right.
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
  /cave-composer-utility-row[\s\S]*?ph:paperclip[\s\S]*?ph:microphone[\s\S]*?<ComposerOptionsMenu[\s\S]*?hc-dest-pills[\s\S]*?ariaLabel="Choose chat agent"[\s\S]*?hc-access-chip[\s\S]*?cave-composer-submit-row[\s\S]*?ph:sparkle[\s\S]*?aria-label="Send"/,
  "The footer has attach/voice/Options + Chat/Task destination + access chip left; enhance + send right",
);

// ── Model selection moved to the /model slash command ────────────────────────
assert.doesNotMatch(
  source,
  /ChatModelControl/,
  "HomeComposer no longer renders the model picker (moved into /model)",
);

assert.match(
  modelStateHook,
  /\/api\/chat\/model-state\?familiarId=/,
  "useHomeModelState still GETs model-state (for the current model + harness)",
);

assert.match(
  modelStateHook,
  /scope: "familiar-default"/,
  "useHomeModelState persists a /model pick as the familiar default",
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
  modelStateHook,
  /scope: "session"/,
  "useHomeModelState must not use session scope — there is no session at home",
);

// The home prompt draft survives a reload: text initialises from localStorage,
// is written back on change, and is removed when emptied (e.g. after a send).
// The plumbing lives in the shared use-composer-draft hook (parity with chat);
// these pins hold the call sites, the hook test holds the semantics.
assert.match(
  source,
  /const \[text, setText\] = useState\(\(\) => readComposerDraft\(HOME_DRAFT_KEY\)\)/,
  "home composer text initialises from the persisted draft",
);
assert.match(
  source,
  /const \{ clearNow: clearDraft \} = useDraftPersistence\(HOME_DRAFT_KEY, text, HOME_DRAFT_WRITE_DELAY_MS\)/,
  "the home draft persists through the shared debounced hook (no per-keystroke localStorage writes)",
);
// A send unmounts the composer (mode switches to chat/board), which cancels the
// debounced draft-write before it can flush the cleared text — so the submit
// path must clear the persisted draft synchronously, or the sent prompt
// resurrects on the next Home visit.
assert.match(
  source,
  /setText\(""\);\s*(?:\/\/[^\n]*\n\s*)*clearDraft\(\);/,
  "the chat send path clears the persisted draft synchronously (not only via the debounced effect)",
);
assert.match(
  draftHook,
  /if \(text\) window\.localStorage\.setItem\(key, text\);\s*else window\.localStorage\.removeItem\(key\)/,
  "an emptied draft removes the key (sent prompts don't reappear on reload)",
);

// The ↑/↓ prompt-history also survives a reload — shared hook; the pin holds
// the keyed call site, the hook test holds the recall/persist semantics.
assert.match(
  source,
  /const \{ push: pushHistory, handleArrowKey \} = useComposerHistory\(HOME_HISTORY_KEY\)/,
  "home prompt history rides the shared persisted recall stack",
);
assert.match(
  source,
  /if \(handleArrowKey\(e, text, setText\)\) return;/,
  "↑/↓ recall is delegated to the shared hook from the home keyboard handler",
);

// ── Attachments ─────────────────────────────────────────────────────────────
assert.match(
  source,
  /aria-label="Attach images, videos, or files"[\s\S]*?onClick=\{\(\) => fileInputRef\.current\?\.click\(\)\}[\s\S]*?ph:paperclip/,
  "the paperclip button opens the file picker (chat-composer parity)",
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
// The staging state machine (cap, dragDepth-counted overlay, files-win paste)
// lives in the shared use-attachment-staging hook; these pins hold home's
// wiring, the hook test holds the semantics.
assert.match(
  source,
  /home-composer-card cave-composer-panel\$\{dropActive \? " is-drop-active" : ""\}`\}\s*\{\.\.\.dropHandlers\}/,
  "the composer card is the drop target (drag handlers attach to the card, not the page)",
);
assert.match(
  attachHook,
  /onDrop: \(e: DragEvent\) => \{[\s\S]*?hasDraggedFiles\(e\.dataTransfer\.types\)[\s\S]*?void addFiles\(e\.dataTransfer\.files\)/,
  "dropping files routes through addFiles",
);
assert.match(
  attachHook,
  /onDragEnter: \(e: DragEvent\) => \{[\s\S]*?setDropActive\(true\)/,
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
  /onPaste=\{handlePaste\}/,
  "pasting into the composer routes through the shared files-win-over-text handler",
);
assert.match(
  source,
  /onLimit: \(\) => onToast\("Attachment limit reached \(10\)\."\)/,
  "home surfaces the attachment cap as a toast (chat stays silent — deliberate asymmetry)",
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
  /hc-attachments-clear[\s\S]*?onClick=\{clearAttachments\}[\s\S]*?Clear all/,
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
  /onAdded: \(count\) => announce\(`Attached \$\{count\} file/,
  "adding attachments is announced (there is no toast on the success path)",
);
