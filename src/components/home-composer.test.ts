// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const workspaceSource = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const destinations = await readFile(new URL("./home/home-destinations.ts", import.meta.url), "utf8");
const draftHook = await readFile(new URL("../lib/use-composer-draft.ts", import.meta.url), "utf8");
const attachHook = await readFile(new URL("../lib/use-attachment-staging.ts", import.meta.url), "utf8");
const menusHook = await readFile(new URL("../lib/use-inline-slash-menus.ts", import.meta.url), "utf8");
const modelStateHook = await readFile(new URL("./home/use-home-model-state.ts", import.meta.url), "utf8");
const chatSource = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const slashMenu = await readFile(new URL("./home/home-slash-menu.tsx", import.meta.url), "utf8");
const handleKeyDownBlock = source.match(/const handleKeyDown = useCallback\([\s\S]*?\n  \);/)?.[0] ?? "";

assert.match(source, /project: CaveProject \| null;/, "Home receives the shell project");
assert.match(source, /actingFamiliarId: string \| null;/, "Home receives the resolved actor");
assert.match(
  source,
  /onRequestActingFamiliar: \(\s*actionLabel: string,\s*authorityId: string,\s*requiresProjectAccess: boolean,\s*\) => Promise<string \| null>;/,
  "Home requests one actor before an aggregate mutation",
);
assert.match(
  source,
  /onValidateActingFamiliar: \(\s*familiarId: string,\s*authorityId: string,\s*\) => Promise<boolean>;/,
  "Home consumes the same shell authority immediately before mutation",
);
assert.doesNotMatch(
  source,
  /useProjects\(\{[\s\S]*familiarId: selectedFamiliarId/,
  "Home no longer creates a second familiar-scoped project authority",
);
assert.doesNotMatch(
  source,
  /const \[selectedProjectId, setSelectedProjectId\]/,
  "Home no longer persists an independent project selection",
);
assert.match(
  source,
  /const actionFamiliar = await resolveActionFamiliar\(actionLabel, !isOmnigentRun\);/,
  "aggregate Home launch asks the shared actor gate to resolve ownership",
);
assert.match(
  source,
  /<ComposerContextChips[\s\S]*showProject=\{false\}/,
  "Home does not duplicate the project-primary rail selector",
);
assert.match(
  source,
  /home-composer-familiar-context[\s\S]*?<FamiliarQuickSwitch[\s\S]*?activeFamiliarId=\{activeFamiliarId\}[\s\S]*?onSelectFamiliar=\{\(id\) => \{\s*if \(id\) onSetActiveFamiliar\(id\);\s*\}\}[\s\S]*?labeled[\s\S]*?singleRequired[\s\S]*?hc-dest-pills hc-dest-pills--inline/,
  "Home renders the shared familiar selector in a full-width context row above the Chat/Task destination tabs",
);
assert.match(
  source,
  /home-composer-toolbar__left[\s\S]*?<ComposerContextChips[\s\S]*?<\/div>/,
  "the footer context cluster still carries project/model and no longer owns familiar selection",
);
assert.doesNotMatch(source, /projectLaunchReady|projectLaunchMessage/, "shell owns launch eligibility");
assert.match(
  workspaceSource,
  /project=\{selectedWorkspaceProject\}[\s\S]*onRequestActingFamiliar=\{requestActingFamiliar\}[\s\S]*onValidateActingFamiliar=\{validateActingFamiliar\}/,
  "Workspace forwards its canonical project and actor gate",
);
assert.match(
  workspaceSource,
  /requiresProjectAccess\s*\? await resolveActorProjectAccess\(result\.familiarId, projectId\)\s*: true/,
  "non-project-bound Omnigent actions do not require unrelated project access",
);
assert.match(
  source,
  /resolveActionFamiliar\(actionLabel, !isOmnigentRun\)/,
  "Home marks only Omnigent runs as non-project-bound",
);
assert.match(
  workspaceSource,
  /const requestActingFamiliar = useCallback\([\s\S]*resolveActorProjectAccess[\s\S]*currentAccessGeneration !== accessGeneration/,
  "Home actor requests revalidate project access and reject stale access generations",
);
assert.match(
  workspaceSource,
  /authorityId: string;[\s\S]*homeActionRequestGenerationRef[\s\S]*authority\.authorityId !== authorityId/,
  "each Home action consumes only its own opaque, latest-generation lease",
);
assert.match(
  workspaceSource,
  /authority\.authorityId !== authorityId[\s\S]*return false;[\s\S]*homeActionAuthorityRef\.current = null;/,
  "a stale action cannot consume a newer action's lease",
);
assert.match(
  source,
  /if \(!isOmnigentRun && !project\)[\s\S]*Choose a project before starting a chat/,
  "All projects cannot become an implicit No-project chat launch",
);
assert.match(
  source,
  /Choose a project before creating a task/,
  "All projects cannot become an implicit No-project task mutation",
);
assert.match(
  workspaceSource,
  /pending\.projectRoot === undefined && selectedWorkspaceProjectId === null[\s\S]*Choose a project to continue the pending chat/,
  "cold-boot handoffs wait for an explicit project instead of launching unscoped",
);
assert.match(
  workspaceSource,
  /requestedProjectId === null && request\.projectRoot === undefined[\s\S]*setPendingAgentsNewChat\(request\)[\s\S]*Choose a project before starting a chat/,
  "live omitted-root launches remain pending until project selection",
);
assert.match(
  workspaceSource,
  /const startWorkspaceChat = useCallback[\s\S]*clearPendingAgentsNewChat\(\);\s*setPendingAgentsNewChat\(null\);[\s\S]*workspaceChatRequestGenerationRef/,
  "a newer live request supersedes any older retained handoff",
);
assert.match(
  source,
  /if \(!project\) \{[\s\S]*Choose a project before starting a voice call/,
  "Voice launch requires the shell's concrete project",
);
assert.match(
  workspaceSource,
  /const resolvedFamiliars = useResolvedFamiliars\(visibleFamiliars\)/,
  "the shell actor roster excludes archived familiars",
);

// Unaffected Home behavior remains covered while its authority moves to shell.
assert.match(destinations, /id: "chat"[\s\S]*label: "Chat"/);
assert.match(destinations, /id: "board"[\s\S]*label: "Task"/);
assert.doesNotMatch(destinations, /id: "(?:reminder|call|inbox)"/);
assert.match(source, /home-composer-headline">What are we casting today\?<\/h1>/);
assert.match(
  source,
  /const \[greeting, setGreeting\] = useState<string \| null>\(null\);[\s\S]*greetingForHour\(new Date\(\)\.getHours\(\)\)/,
  "the greeting remains client-clock derived",
);
assert.doesNotMatch(source, /\/api\/chat\/send/, "ChatView remains the only chat sender");
assert.match(
  source,
  /onStartChat\(prompt, actionFamiliarId, project\?\.root \?\? null, \{[\s\S]*initialAttachments: outgoing/,
  "chat handoff keeps shell actor, project, and attachments",
);
assert.match(
  source,
  /body: JSON\.stringify\(\{[\s\S]*title: prompt,[\s\S]*familiarId: actionFamiliarId,[\s\S]*cwd: project\?\.root \?\? null,[\s\S]*projectId: project\?\.id \?\? null/,
  "Board creation keeps shell actor and project attribution",
);
assert.match(
  source,
  /const initialModelOverride =[\s\S]*modelOverride: initialModelOverride, modelOverrideScope: "next-message"/,
  "the first-send handoff preserves explicit model intent",
);
assert.match(
  modelStateHook,
  /\/api\/chat\/model-state\?familiarId=/,
  "Home still loads model state for one resolved familiar",
);
assert.match(modelStateHook, /scope: "familiar-default"/);
assert.doesNotMatch(modelStateHook, /scope: "session"/);
assert.match(
  source,
  /if \(!selectedFamiliarId\) \{[\s\S]*Choose one familiar in the rail before changing models/,
  "aggregate model changes cannot claim success without one actor",
);
assert.match(
  source,
  /<ComposerOptionsMenu[\s\S]*disabled=\{sending \|\| !selectedFamiliar\}/,
  "model and runtime controls disable without one resolved actor",
);
assert.match(
  source,
  /onOpenModelTuning=\{\s*selectedFamiliar \? \(\) => setOptionsOpen\(true\) : undefined\s*\}/,
  "aggregate Home omits the external Model & tuning action",
);
assert.match(
  source,
  /if \(!selectedFamiliar\) setOptionsOpen\(false\)/,
  "an open model menu closes if the shell actor becomes unresolved",
);

assert.match(
  source,
  /const \[text, setText\] = useState\(""\);[\s\S]*useLayoutEffect\(\(\) => \{[\s\S]*readComposerDraft\(HOME_DRAFT_KEY\)/,
  "Home restores its persisted draft before interaction",
);
assert.match(source, /readOnly=\{!draftRestored\}/);
assert.match(
  source,
  /useDraftPersistence\(HOME_DRAFT_KEY, text, HOME_DRAFT_WRITE_DELAY_MS\)/,
  "Home keeps debounced draft persistence",
);
assert.match(
  draftHook,
  /if \(text\) window\.localStorage\.setItem\(key, text\);[\s\S]*window\.localStorage\.removeItem\(key\)/,
);
assert.match(source, /useComposerHistory\(HOME_HISTORY_KEY\)/);
assert.match(handleKeyDownBlock, /if \(handleArrowKey\(e, text, setText\)\) return;/);
assert.match(
  handleKeyDownBlock,
  /e\.key === "Enter" && !e\.shiftKey && !e\.nativeEvent\.isComposing/,
  "IME confirmation cannot submit a partial prompt",
);

assert.match(source, /type="file"[\s\S]*multiple[\s\S]*void addFiles\(e\.target\.files\)/);
assert.match(source, /initialAttachments: outgoing/);
assert.match(
  source,
  /attachments\.map\(\(att\) =>[\s\S]*attachmentIcon\(att\)[\s\S]*removeAttachment\(att\.id\)/,
);
assert.match(source, /onPaste=\{handlePaste\}/);
assert.match(
  attachHook,
  /onDrop: \(e: DragEvent\) => \{[\s\S]*hasDraggedFiles\(e\.dataTransfer\.types\)[\s\S]*addFiles\(e\.dataTransfer\.files\)/,
);
assert.match(source, /hc-attachments-clear[\s\S]*onClick=\{clearAttachments\}/);
assert.match(source, /isImage && att\.dataUrl \?[\s\S]*hc-attachment-thumb/);

assert.match(source, /import \{ usePromptEnhance \} from "@\/lib\/use-prompt-enhance"/);
assert.match(source, /mode: destination === "board" \? "task" : "chat"/);
assert.match(
  source,
  /selectedFiles: attachments\.map\(\(attachment\) => attachment\.name\)/,
);
assert.match(source, /<EnhanceStrip[\s\S]*state=\{promptEnhance\.state\}/);
assert.match(source, /const \{ announce \} = useAnnouncer\(\)/);
assert.match(source, /onAdded: \(count\) => announce\(`Attached \$\{count\} file/);

assert.match(slashMenu, /role="listbox" aria-label=\{ariaLabel\}/);
assert.match(slashMenu, /role="option"[\s\S]*aria-selected=\{active\}/);
for (const [name, composer] of [["HomeComposer", source], ["ChatView", chatSource]]) {
  assert.match(composer, /aria-autocomplete="list"/, `${name} exposes list autocomplete`);
  assert.match(composer, /aria-haspopup="listbox"/, `${name} advertises its listbox`);
  assert.match(composer, /aria-expanded=\{menuOpen\}/, `${name} exposes listbox state`);
  assert.doesNotMatch(composer, /<textarea[\s\S]*role="combobox"/);
}
assert.match(
  menusHook,
  /const menuOpen = modelMenuActive \|\| skillMenuActive \|\| promptMenuActive/,
);

// Cancellation must happen before any destructive draft or attachment mutation.
assert.match(
  source,
  /resolveActionFamiliar\("Run skill"\)[\s\S]*waitForRuntimeWrite\(\)[\s\S]*onValidateActingFamiliar\(actionFamiliarId, authorityId\)[\s\S]*setText\(""\)/,
);
assert.match(
  source,
  /resolveActionFamiliar\("Run command"\)[\s\S]*waitForRuntimeWrite\(\)[\s\S]*onValidateActingFamiliar\(actionFamiliarId, authorityId\)[\s\S]*setText\(""\)/,
);
assert.match(
  source,
  /if \(command === "\/new"\) \{[\s\S]*resolveActionFamiliar\("Start new chat"\)[\s\S]*onValidateActingFamiliar\(actionFamiliarId, authorityId\)[\s\S]{0,220}setText\(""\)/,
  "/new preserves the draft until the shell actor gate succeeds",
);
assert.match(
  source,
  /const actionFamiliar = await resolveActionFamiliar\(actionLabel, !isOmnigentRun\);[\s\S]*switch \(destination\)[\s\S]*onValidateActingFamiliar\(actionFamiliarId, authorityId\)/,
);

console.log("home-composer.test.ts: ok");
