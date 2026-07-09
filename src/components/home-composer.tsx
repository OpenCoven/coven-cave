"use client";

/**
 * HomeComposer — universal intent surface; the Cave's cold-start view.
 *
 * Home can start chat directly, so it includes an agent selector next to the
 * destination controls instead of requiring a detour through the sidebar.
 */

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { Icon, type IconName } from "@/lib/icon";
import { resolveModelArg } from "@/lib/slash-model";
import {
  resolveSkillInvocation,
  buildSkillPrompt,
  type SkillOption,
} from "@/lib/slash-skill";
import {
  resolvePromptArg,
  promptInsertion,
  type PromptOption,
} from "@/lib/slash-prompt";
import { SkillDetailPreview } from "@/components/skill-detail-preview";
import { useAutogrowTextarea } from "@/lib/use-autogrow-textarea";
import { readComposerDraft, useDraftPersistence } from "@/lib/use-composer-draft";
import { useComposerHistory } from "@/lib/use-composer-history";
import { useAttachmentStaging } from "@/lib/use-attachment-staging";
import { useInlineSlashMenus } from "@/lib/use-inline-slash-menus";
import { canonicalize } from "@/lib/slash-commands";
import { useArchivedFamiliars } from "@/lib/cave-familiar-archive";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useProjects } from "@/lib/use-projects";
import { NO_PROJECT_ID } from "@/lib/chat-projects";
import { ProjectPicker } from "@/components/project-picker";
import { ComposerOptionsMenu, type ComposerOptionSection } from "@/components/composer-options-menu";
import { ComposerRuntimeChip } from "@/components/composer-runtime-chip";
import { LOCAL_HOST_ID } from "@/lib/chat-hosts";
import { useKeySymbols } from "@/lib/platform-keys";
import { catalogForRuntime } from "@/lib/runtime-models";
import { COMPATIBILITY_ADAPTERS } from "@/lib/harness-adapters";
import { HomeDigestCarousel } from "@/components/home/home-digest-carousel";
import { HomeSuggestions } from "@/components/home/home-suggestions";
import { HomeSelect, type HomeSelectGroup } from "@/components/home/home-select";
import { HomeSlashMenu } from "@/components/home/home-slash-menu";
import { useHomeModelState } from "@/components/home/use-home-model-state";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  attachmentIcon,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import {
  COMMAND_CONTROL_DEFAULTS,
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "@/lib/command-controls";
import { buildPromptEnhancement } from "@/lib/prompt-enhancer";
import { greetingForHour } from "@/lib/home-greeting";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Destination = "chat" | "board";

const DESTINATIONS: { id: Destination; label: string; icon: IconName }[] = [
  { id: "chat",  label: "Chat", icon: "ph:chat-circle-dots" },
  { id: "board", label: "Task", icon: "ph:kanban" },
];

const PLACEHOLDERS: Record<Destination, string> = {
  chat: "Summon something magical",
  board: "Describe a new task…",
};

type Props = {
  familiars: Familiar[];
  activeFamiliarId: string | null;
  sessions: SessionRow[];
  onSetActiveFamiliar: (id: string) => void;
  /** Open a new chat that sends `prompt` through ChatView's streaming path.
   *  Home never talks to the chat API itself — a fire-and-cancel send here
   *  aborts the request, which kills the harness before the transcript saves. */
  onStartChat: (
    prompt: string,
    familiarId: string,
    projectRoot: string | null,
    opts?: {
      initialControls?: { thinkingEffort: CommandThinkingEffort; responseSpeed: CommandResponseSpeed; runtimeHost?: string };
      /** Files staged in the home composer; the opened chat auto-sends with them. */
      initialAttachments?: ChatAttachment[];
    },
  ) => void;
  onNavigateToBoard: () => void;
  onToast: (msg: string) => void;
  /** Submit a slash command. Mirrors the chat composer's escape hatch so
   *  `/inbox`, `/board`, `/remind …` etc. work from the home screen too. */
  onSlash?: (command: string, args: string) => void;
  /** Resume a recent chat from the Continue column's session cards. */
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
};

// Persist the in-progress prompt so a page reload doesn't eat what you were
// typing on the home screen (mirrors the chat composer's draft persistence).
const HOME_DRAFT_KEY = "cave:home-composer-draft:v1";
const HOME_DRAFT_WRITE_DELAY_MS = 250;
// Persisted ↑/↓ prompt-history recall stack for the home composer.
const HOME_HISTORY_KEY = "cave:home-composer-history:v1";
// Composer textarea growth cap — mirrors the chat composer (13 lines + padding).
const HOME_COMPOSER_MAX_HEIGHT = 332;

// ─── HomeComposer ─────────────────────────────────────────────────────────────

export function HomeComposer({
  familiars,
  activeFamiliarId,
  sessions,
  onSetActiveFamiliar,
  onStartChat,
  onNavigateToBoard,
  onToast,
  onSlash,
  onOpenSession,
}: Props) {
  const [text, setText] = useState(() => readComposerDraft(HOME_DRAFT_KEY));
  const [destination, setDestination] = useState<Destination>("chat");
  const [sending, setSending] = useState(false);
  // Persisted ↑/↓ prompt-history recall — shared hook (use-composer-history);
  // home records slash commands in history too, so pushes stay at call sites.
  const { push: pushHistory, handleArrowKey } = useComposerHistory(HOME_HISTORY_KEY);
  // Time-of-day greeting for the hero eyebrow. Sampled after mount (client
  // clock) so SSR markup stays deterministic — the eyebrow fades in once set.
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);
  const { announce } = useAnnouncer();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Attachments staged in the composer (cap 10, mirroring the chat composer);
  // handed to the opened chat on submit. Shared hook — home adds the limit
  // toast + SR announce and defers refocus a tick (the chat composer is silent).
  const {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    handlePaste,
    dropActive,
    dropHandlers,
  } = useAttachmentStaging({
    onLimit: () => onToast("Attachment limit reached (10)."),
    onAdded: (count) => announce(`Attached ${count} file${count === 1 ? "" : "s"}`, "polite"),
    focus: () => setTimeout(() => textareaRef.current?.focus(), 0),
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Prompt enhancement (mirrors the chat composer's Enhance): the pre-enhance
  // text is kept so the user can revert in one tap.
  const [enhanceStatus, setEnhanceStatus] = useState<"idle" | "loading" | "error">("idle");
  const [enhanceOriginal, setEnhanceOriginal] = useState<string | null>(null);
  const archivedFamiliars = useArchivedFamiliars();
  // Hide archived familiars from the "new session" picker. Starting a new
  // chat against an archived agent is a footgun — the user can't tell from
  // the dropdown that the agent is archived, and the session lands in a
  // confusing state. Archived familiars stay reachable from Familiar Studio
  // Lifecycle (unarchive there) but should never appear in fresh-session
  // surfaces.
  const visibleFamiliars = useMemo(
    () => familiars.filter((familiar) => !(familiar.id in archivedFamiliars)),
    [familiars, archivedFamiliars],
  );
  // If the user's previously-active familiar is now archived, fall through to
  // the first visible one so the picker value matches an actual option and
  // the new-session flow stays usable.
  const activeIsArchived =
    activeFamiliarId != null && activeFamiliarId in archivedFamiliars;
  const selectedFamiliarId =
    activeFamiliarId && !activeIsArchived
      ? activeFamiliarId
      : visibleFamiliars[0]?.id ?? "";
  const selectedFamiliar = useMemo(
    () => familiars.find((familiar) => familiar.id === selectedFamiliarId) ?? null,
    [familiars, selectedFamiliarId],
  );
  // Resolve avatars so the selector chip shows the selected familiar's actual
  // avatar image (falling back to its glyph) instead of a static sparkle icon.
  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const resolvedFamiliarById = useMemo(
    () => new Map(resolvedFamiliars.map((familiar) => [familiar.id, familiar])),
    [resolvedFamiliars],
  );
  const { modelState, selectModel: handleSelectModel, selectRuntime: handleSelectRuntime } =
    useHomeModelState(selectedFamiliarId);
  const { projects, createProject } = useProjects({ familiarId: selectedFamiliarId || null });
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [thinkingEffort, setThinkingEffort] = useState<CommandThinkingEffort>(
    COMMAND_CONTROL_DEFAULTS.thinkingEffort,
  );
  const [responseSpeed, setResponseSpeed] = useState<CommandResponseSpeed>(
    COMMAND_CONTROL_DEFAULTS.responseSpeed,
  );
  // Host chip: where the opened chat should execute. Per-composer state, not a
  // sticky pref — mirrors the chat composer's Host chip (#2337/#2340).
  const [runtimeHost, setRuntimeHost] = useState<string | null>(null);
  const selectedProject = useMemo(
    () =>
      selectedProjectId === NO_PROJECT_ID
        ? null
        : projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );
  const selectedRuntime =
    modelState?.harness ?? selectedFamiliar?.harness ?? selectedFamiliar?.defaultHarness ?? "claude";
  const runtimeModelOptionsFor = useCallback(
    (runtime: string) => catalogForRuntime(runtime)?.models ?? [],
    [],
  );
  const runtimeModelOptions = runtimeModelOptionsFor(selectedRuntime);
  const selectedModelId =
    runtimeModelOptions.length === 0
      ? ""
      : runtimeModelOptions.some((model) => model.id === modelState?.effectiveModel)
        ? modelState!.effectiveModel
        : runtimeModelOptions[0]?.id ?? "";
  const keys = useKeySymbols();
  const familiarSelectGroups = useMemo<HomeSelectGroup[]>(
    () => [
      {
        options:
          visibleFamiliars.length === 0
            ? [{ value: "", label: "No agents", icon: "ph:sparkle", disabled: true }]
            : visibleFamiliars.map((familiar) => {
                const resolved = resolvedFamiliarById.get(familiar.id);
                return {
                  value: familiar.id,
                  label: familiar.display_name,
                  leading: resolved ? (
                    <FamiliarAvatar
                      familiar={resolved}
                      size="sm"
                      className="hc-familiar-glyph hc-familiar-avatar"
                    />
                  ) : (
                    <Icon name="ph:sparkle" width={13} aria-hidden />
                  ),
                };
              }),
      },
    ],
    [resolvedFamiliarById, visibleFamiliars],
  );
  const runtimeSectionOptions = useMemo(
    () =>
      COMPATIBILITY_ADAPTERS.filter((adapter) => adapter.chatSupported).map((adapter) => ({
        value: adapter.id,
        label: adapter.label,
      })),
    [],
  );

  useEffect(() => {
    if (selectedProjectId === NO_PROJECT_ID) return; // an explicit No-project choice is valid
    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) return;
    setSelectedProjectId(projects[0]?.id ?? "");
  }, [projects, selectedProjectId]);

  // Inline slash menus (/command listbox + Skills group, /model, /skill,
  // /prompt pickers) — shared hook (use-inline-slash-menus). What a pick DOES
  // stays home's: model picks toast + clear, skill picks start a new chat
  // (invokeSkill), prompts insert-for-editing, and Enter on a command (or
  // nothing highlighted) falls through to handleSubmit — home dispatches the
  // typed text, so slash commands also land in the ↑ history.
  const modelHarness =
    modelState?.harness ?? selectedFamiliar?.harness ?? "claude";
  const {
    skills,
    prompts,
    slashSuggestions,
    skillCommandRows,
    modelOptions,
    skillOptions,
    promptOptions,
    modelMenuActive,
    skillMenuActive,
    promptMenuActive,
    menuOpen,
    slashIdx,
    setSlashIdx,
    slashListboxId,
    handleKeyDown: handleMenuKey,
  } = useInlineSlashMenus({
    text,
    setText,
    modelHarness,
    onPickModel: (id) => { handleSelectModel(id); onToast(`Model set to ${id}.`); setText(""); },
    onPickSkill: (s) => invokeSkill(s),
    onInsertPrompt: (p) => insertPromptTemplate(p),
    onRunCommand: () => { void handleSubmit(); },
    onNoMatchEnter: () => { void handleSubmit(); },
  });

  // Invoke a skill from home = open a new chat that asks the familiar to run
  // it. A skill with an argument-hint autofills `/skill <id> ` for argument
  // editing instead of starting immediately; picking again on the filled text
  // (or a hint-less skill) starts the chat. Mirrors chat-view's
  // invokeSkillOption.
  const invokeSkill = useCallback(
    (skill: SkillOption, args = "") => {
      const filled = `/skill ${skill.id}`;
      if (skill.argumentHint && !args && text.trim().toLowerCase() !== filled.toLowerCase()) {
        setText(`${filled} `);
        textareaRef.current?.focus();
        return;
      }
      if (!selectedFamiliarId) {
        onToast("No familiar selected — add one in Settings.");
        return;
      }
      setText("");
      onStartChat(buildSkillPrompt(skill, args), selectedFamiliarId, selectedProject?.root ?? null, {
        initialControls: { thinkingEffort, responseSpeed, ...(runtimeHost ? { runtimeHost } : {}) },
      });
    },
    [selectedFamiliarId, selectedProject, thinkingEffort, responseSpeed, runtimeHost, onStartChat, onToast, text],
  );

  // Drop a prompt template into the composer for editing — never a start.
  // When the body carries a {{placeholder}}, select the first one so typing
  // replaces it; otherwise park the caret at the end. Mirrors chat-view.
  // (Distinct from insertPrompt below — the suggestion pills' plain-string
  // insert.)
  const insertPromptTemplate = useCallback(
    (p: PromptOption) => {
      const ins = promptInsertion(p);
      setText(ins.text);
      setSlashIdx(0);
      announce("Prompt inserted — edit and send.");
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        if (ins.selectStart !== undefined && ins.selectEnd !== undefined) {
          el.setSelectionRange(ins.selectStart, ins.selectEnd);
        } else {
          el.setSelectionRange(ins.text.length, ins.text.length);
        }
      });
    },
    [announce],
  );

  // Persist the draft so a reload restores it; cleared when the input empties
  // (e.g. after a send), so sent prompts don't reappear. Shared hook —
  // debounce + remove-on-empty semantics live in use-composer-draft.
  const { clearNow: clearDraft } = useDraftPersistence(HOME_DRAFT_KEY, text, HOME_DRAFT_WRITE_DELAY_MS);


  // Focus on mount — unless a modal dialog (e.g. the onboarding wizard) is
  // open. The 80ms delay means this fires AFTER a dialog's focus trap has
  // placed focus, so an unconditional focus() would steal it out of the
  // modal and strand keyboard users in a composer they can't even see.
  useEffect(() => {
    setTimeout(() => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      textareaRef.current?.focus();
    }, 80);
  }, []);

  // Maps a familiar id to its display name for the Continue column.
  const familiarNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of familiars) m.set(f.id, f.display_name);
    return m;
  }, [familiars]);

  // Auto-grow textarea — chat-composer sizing, shared hook (use-autogrow-textarea).
  const { resize: autoGrow } = useAutogrowTextarea(textareaRef, text, {
    fallbackMaxHeight: HOME_COMPOSER_MAX_HEIGHT,
  });

  // ── Enhance ──────────────────────────────────────────────────────────────
  // Rewrite the draft through the shared pure enhancer (mirrors the chat
  // composer), stashing the original for a one-tap revert.
  const enhancePrompt = useCallback(() => {
    const draft = text.trim();
    if (!draft || sending || enhanceStatus === "loading") return;
    setEnhanceStatus("loading");
    const result = buildPromptEnhancement({
      draft,
      mode: destination === "board" ? "task" : "chat",
      context: {
        activeProject: selectedProject
          ? { name: selectedProject.name, root: selectedProject.root }
          : null,
        selectedFiles: attachments.map((attachment) => attachment.name),
      },
    });
    if (!result.ok || !result.enhanced.trim()) {
      setEnhanceStatus("error");
      onToast("Couldn't enhance the prompt.");
      return;
    }
    setEnhanceOriginal(text);
    setText(result.enhanced);
    announce("Prompt enhanced", "polite");
    setEnhanceStatus("idle");
    setTimeout(() => { textareaRef.current?.focus(); autoGrow(); }, 0);
  }, [text, destination, selectedProject, attachments, sending, enhanceStatus, onToast, autoGrow, announce]);
  const revertEnhance = useCallback(() => {
    setEnhanceOriginal((original) => {
      if (original == null) return null;
      setText(original);
      setTimeout(() => { textareaRef.current?.focus(); autoGrow(); }, 0);
      return null;
    });
  }, [autoGrow]);

  // A suggestion pill inserts its prompt (never auto-sends) and returns focus
  // so the user can edit before sending.
  const insertPrompt = useCallback((prompt: string) => {
    setText(prompt);
    setEnhanceOriginal(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  // Destination pills behave as a single-select radiogroup: arrow/Home/End
  // move the selection and the roving focus, matching the ARIA radio pattern.
  const destGroupRef = useRef<HTMLDivElement>(null);
  const handleDestKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const nav = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
      if (!nav.includes(e.key)) return;
      e.preventDefault();
      const last = DESTINATIONS.length - 1;
      const cur = DESTINATIONS.findIndex((d) => d.id === destination);
      let next = cur < 0 ? 0 : cur;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = cur >= last ? 0 : cur + 1;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = cur <= 0 ? last : cur - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = last;
      const target = DESTINATIONS[next];
      if (!target) return;
      setDestination(target.id);
      destGroupRef.current
        ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
        [next]?.focus();
    },
    [destination],
  );

  const handleSubmit = useCallback(async () => {
    const prompt = text.trim();
    // Allow an attachments-only send (chat can carry files with no text); every
    // other path still needs a prompt and is guarded per-destination below.
    if ((!prompt && attachments.length === 0) || sending) return;

    // Slash commands bypass the destination model entirely — same contract
    // as the chat composer's slash dispatch.
    if (prompt.startsWith("/")) {
      const [rawCmd, ...rest] = prompt.split(/\s+/);
      const command = canonicalize(rawCmd) ?? rawCmd;
      const args = rest.join(" ");
      if (command === "/model") {
        pushHistory(prompt);
        setText("");
        if (!args.trim()) {
          const current =
            modelState?.effectiveModel && modelState.effectiveModel !== "unknown"
              ? modelState.effectiveModel
              : null;
          onToast(current ? `Model: ${current}` : "Type /model <id> to pick a model.");
          return;
        }
        const id = resolveModelArg(args, modelHarness);
        if (!id) {
          onToast(`Unknown model "${args.trim()}".`);
          return;
        }
        handleSelectModel(id);
        onToast(`Model set to ${id}.`);
        return;
      }
      if (command === "/skill" || command === "/skills") {
        pushHistory(prompt);
        if (!args.trim()) {
          setText("");
          onToast("Type /skill <name>, or pick one from the menu.");
          return;
        }
        const invocation = resolveSkillInvocation(args, skills);
        if (!invocation) {
          setText("");
          onToast(`Unknown skill "${args.trim()}".`);
          return;
        }
        invokeSkill(invocation.skill, invocation.args);
        return;
      }
      if (command === "/prompt" || command === "/prompts") {
        pushHistory(prompt);
        if (!args.trim()) {
          setText("");
          onToast("Type /prompt <name>, or pick one from the menu.");
          return;
        }
        const template = resolvePromptArg(args, prompts);
        if (!template) {
          setText("");
          onToast(`Unknown prompt "${args.trim()}".`);
          return;
        }
        insertPromptTemplate(template);
        return;
      }
      if (onSlash) {
        pushHistory(prompt);
        setText("");
        onSlash(command, args);
      } else {
        onToast(`Slash commands aren't wired up here yet — try ${command} from a chat.`);
      }
      return;
    }

    pushHistory(prompt);
    setSending(true);
    try {
      switch (destination) {
        case "chat": {
          if (!selectedFamiliarId) { onToast("No familiar selected — add one in Settings."); break; }
          // Hand the prompt to ChatView, which owns the streaming send. Doing
          // the send here and canceling on the session event aborts the
          // request server-side — the harness is killed mid-run and the
          // transcript never saves, so the opened chat 404s.
          // ComposerAttachment carries a local `id` (extra vs ChatAttachment);
          // it's harmless downstream (normalized away before persistence).
          const outgoing: ChatAttachment[] | undefined = attachments.length ? attachments : undefined;
          setText("");
          // Clear the persisted draft synchronously: onStartChat unmounts this
          // composer, which cancels the debounced draft-write effect before it
          // can flush the empty text — otherwise the sent prompt resurrects on
          // the next Home visit.
          clearDraft();
          clearAttachments();
          setEnhanceOriginal(null);
          onStartChat(prompt, selectedFamiliarId, selectedProject?.root ?? null, {
            initialControls: { thinkingEffort, responseSpeed, ...(runtimeHost ? { runtimeHost } : {}) },
            initialAttachments: outgoing,
          });
          break;
        }
        case "board": {
          if (!prompt) { onToast("Add a task title."); break; }
          const res = await fetch("/api/board", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: prompt,
              // Attribute the card to the familiar the selector actually shows
              // (selectedFamiliarId falls through to the first visible familiar
              // when the active one is unset or archived) — not the raw active
              // id, which could be null or point at the hidden/archived one.
              familiarId: selectedFamiliarId || null,
              cwd: selectedProject?.root ?? null,
              projectId: selectedProject?.id ?? null,
              // Files staged on the composer ride onto the task card. The route
              // stores them lean (metadata + text; image data URLs stripped).
              attachments: attachments.length ? attachments : undefined,
            }),
          });
          const json = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
          if (json.ok) { setText(""); clearDraft(); clearAttachments(); setEnhanceOriginal(null); onNavigateToBoard(); }
          else onToast("Board card creation failed.");
          break;
        }
      }
    } finally {
      setSending(false);
    }
  }, [
    text,
    destination,
    activeFamiliarId,
    selectedFamiliarId,
    selectedProject,
    modelState,
    modelHarness,
    thinkingEffort,
    responseSpeed,
    sending,
    attachments,
    clearDraft,
    pushHistory,
    handleSelectModel,
    onSlash,
    onStartChat,
    onNavigateToBoard,
    onToast,
    skills,
    invokeSkill,
    prompts,
    insertPromptTemplate,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // The inline menus (Esc-dismiss, ↑↓/Tab/Enter across all four pickers)
      // take priority over history/submit while one is open — shared hook.
      if (handleMenuKey(e)) return;
      // plain Enter sends; Shift+Enter inserts newline. `isComposing` is true
      // for the Enter that confirms an IME candidate (CJK/pinyin/kana) —
      // treating it as "send" would fire a half-composed prompt and destroy
      // the candidate selection, so let the IME keep it (mirrors chat-view).
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void handleSubmit();
        return;
      }
      if (handleArrowKey(e, text, setText)) return;
    },
    [handleMenuKey, handleSubmit, handleArrowKey, text],
  );

  return (
    <div className="home-composer-root">

      {/* Headline — mono presence eyebrow over the display face; the project
          name carries the accent tint (presence lives in the place you're
          working). */}
      <div className="home-composer-hero">
        <p className={`home-composer-eyebrow${greeting ? " is-ready" : ""}`}>
          <span className="home-composer-eyebrow-dot" aria-hidden />
          {greeting ?? "\u00A0"}
        </p>
        <h1 className="home-composer-headline">
          {"What should we build in "}
          <span className="home-composer-headline-project">
            {selectedProject?.name ?? "Coven Cave"}
          </span>
          ?
        </h1>
      </div>

      {/* Composer card — wrapped so the slash menu can render above the
          card without being clipped by the card's `overflow: hidden`. */}
      <div className="home-composer-card-wrap">

        {/* Hearth glow — the ambient presence halo behind the composer. It
            breathes slowly and brightens while the composer holds focus
            (static under prefers-reduced-motion). */}
        <div className="home-halo" aria-hidden />

        {/* Slash suggestion popover — anchored above the card so it doesn't
            push the rest of the layout when it opens. */}
        {modelMenuActive && modelOptions ? (
          <HomeSlashMenu
            listboxId={slashListboxId}
            ariaLabel="Models"
            items={modelOptions.map((m) => ({ key: m.id, name: m.label, desc: m.id }))}
            activeIndex={slashIdx}
            footer="↑↓ navigate · Enter switch · Esc cancel"
            onHover={setSlashIdx}
            onPick={(i) => {
              const m = modelOptions[i];
              if (!m) return;
              handleSelectModel(m.id);
              onToast(`Model set to ${m.id}.`);
              setText("");
              textareaRef.current?.focus();
            }}
          />
        ) : skillMenuActive && skillOptions ? (
          <HomeSlashMenu
            listboxId={slashListboxId}
            ariaLabel="Skills"
            items={skillOptions.map((s) => ({ key: s.id, name: s.name, desc: s.description || s.id }))}
            activeIndex={slashIdx}
            footer="↑↓ navigate · Enter run · Tab complete · Esc cancel"
            onHover={setSlashIdx}
            onPick={(i) => {
              const s = skillOptions[i];
              if (s) invokeSkill(s);
            }}
            preview={<SkillDetailPreview skill={skillOptions[slashIdx] ?? skillOptions[0] ?? null} />}
          />
        ) : promptMenuActive && promptOptions ? (
          <HomeSlashMenu
            listboxId={slashListboxId}
            ariaLabel="Prompts"
            items={promptOptions.map((p) => ({ key: p.id, name: p.name, desc: p.description || p.id }))}
            activeIndex={slashIdx}
            footer="↑↓ navigate · Enter insert · Tab complete · Esc cancel"
            onHover={setSlashIdx}
            onPick={(i) => {
              const p = promptOptions[i];
              if (p) insertPromptTemplate(p);
            }}
          />
        ) : slashSuggestions.length > 0 || skillCommandRows.length > 0 ? (
          <HomeSlashMenu
            listboxId={slashListboxId}
            ariaLabel="Slash commands"
            items={[
              ...slashSuggestions.map((cmd) => ({
                key: cmd.name,
                name: cmd.name,
                desc: cmd.description,
                arg: cmd.argPlaceholder || undefined,
              })),
              // Matching skills ride under the commands — one list, one index.
              ...skillCommandRows.map((s) => ({
                key: `skill-${s.id}`,
                name: s.name,
                desc: `Skill · ${s.description || s.id}`,
                arg: s.argumentHint || undefined,
              })),
            ]}
            activeIndex={slashIdx}
            footer="↑↓ navigate · Enter run · Tab complete · type space to dismiss"
            onHover={setSlashIdx}
            onPick={(i) => {
              const cmd = slashSuggestions[i];
              const s = skillCommandRows[i - slashSuggestions.length];
              if (cmd) {
                setText(cmd.name + (cmd.argPlaceholder ? " " : ""));
                textareaRef.current?.focus();
              } else if (s) {
                invokeSkill(s);
              }
            }}
          />
        ) : null}

        {/* Composer card — reference layout: the input leads; the mode pills,
            attach, model chip, and mic all live INSIDE the card's control row,
            with a darker attached footer band beneath for context pickers. */}
        <div
          className={`home-composer-card cave-composer-panel${dropActive ? " is-drop-active" : ""}`}
          {...dropHandlers}
        >
          {dropActive ? (
            <div className="hc-drop-overlay" aria-hidden="true">
              <div className="hc-drop-overlay-inner">
                <Icon name="ph:paperclip" width={16} aria-hidden />
                <span>Drop files to attach</span>
              </div>
            </div>
          ) : null}

        {/* Staged attachments — chat-style strip above the textarea, plus a
            count + clear-all header (each chip has its own remove control). */}
        {attachments.length > 0 && (
          <div className="hc-attachments-wrap">
            <div className="hc-attachments-head">
              <span className="hc-attachments-count">{attachments.length}/10 attached</span>
              <button
                type="button"
                className="hc-attachments-clear"
                onClick={clearAttachments}
                disabled={sending}
              >
                Clear all
              </button>
            </div>
          <ul className="hc-attachments" aria-label="Attachments">
            {attachments.map((att) => {
              const isImage = (att.mimeType ?? att.type)?.startsWith("image/");
              return (
              <li key={att.id} className="hc-attachment">
                {isImage && att.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={att.dataUrl} alt="" aria-hidden className="hc-attachment-thumb" />
                ) : (
                  <Icon name={attachmentIcon(att)} width={12} className="hc-attachment-icon" aria-hidden />
                )}
                <span className="hc-attachment-name" title={att.name}>{att.name}</span>
                <button
                  type="button"
                  className="hc-attachment-remove"
                  onClick={() => removeAttachment(att.id)}
                  aria-label={`Remove ${att.name}`}
                  title="Remove"
                >
                  <Icon name="ph:x" width={10} aria-hidden />
                </button>
              </li>
              );
            })}
          </ul>
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="hc-textarea cave-composer-input w-full resize-none bg-transparent px-4 pt-3 pb-2 leading-6 text-[var(--text-primary)] outline-none placeholder:text-[color-mix(in_oklch,var(--foreground)_85%,transparent)] md:text-sm"
          placeholder={PLACEHOLDERS[destination]}
          rows={1}
          value={text}
          onChange={(e) => { setText(e.target.value); if (enhanceOriginal != null) setEnhanceOriginal(null); }}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          disabled={sending}
          aria-label="Ask anything"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? slashListboxId : undefined}
          aria-activedescendant={
            menuOpen ? `${slashListboxId}-opt-${slashIdx}` : undefined
          }
          inputMode="text"
          enterKeyHint="send"
        />

        {/* Enhance revert strip — mirrors the chat composer's post-enhance
            status row: confirms the swap and offers a one-tap revert. */}
        {enhanceOriginal !== null ? (
          <div className="flex items-center gap-2 border-t border-[var(--border-hairline)]/60 px-3 py-1.5 text-[11px] text-[var(--text-muted)]" role="status">
            <Icon name="ph:check" width={12} aria-hidden />
            <span className="min-w-0 flex-1 truncate">Prompt improved</span>
            <button
              type="button"
              onClick={revertEnhance}
              className="focus-ring rounded px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
              aria-label="Revert prompt enhancement"
              title="Revert prompt enhancement"
            >
              Revert
            </button>
          </div>
        ) : null}

        {/* Controls — reference layout: `+` attach and the Chat/Task pills sit
            bottom-left inside the card; the model chip, voice, enhance, and
            send hug the right. Context pickers move to the footer band. */}
        <div className="cave-composer-controls">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hc-file-input"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
            tabIndex={-1}
            aria-hidden
          />
          <div className="cave-composer-control-row">
            <div className="cave-composer-utility-row">
              <button
                type="button"
                className="cave-composer-icon-button focus-ring grid h-[30px] w-[30px] place-items-center rounded-full border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)] disabled:opacity-40"
                title="Attach images, videos, or files"
                aria-label="Attach images, videos, or files"
                disabled={sending || attachments.length >= 10}
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon name="ph:plus" width={15} aria-hidden />
              </button>
              <div
                className="hc-dest-pills hc-dest-pills--inline"
                role="radiogroup"
                aria-label="Send to"
                ref={destGroupRef}
                onKeyDown={handleDestKeyDown}
              >
                {DESTINATIONS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`hc-dest-pill${destination === d.id ? " active" : ""}`}
                    role="radio"
                    aria-checked={destination === d.id}
                    tabIndex={destination === d.id ? 0 : -1}
                    onClick={() => setDestination(d.id)}
                    disabled={sending}
                  >
                    <Icon name={d.icon} width={14} aria-hidden />
                    <span className="hc-dest-label">{d.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="cave-composer-submit-row">
              {/* Always-visible runtime mark + model, one click to switch —
                  parity with the chat composer's chip (cave-yq5l). */}
              <ComposerRuntimeChip
                runtime={selectedRuntime}
                modelValue={selectedModelId}
                modelOptions={runtimeModelOptions}
                onPickRuntime={handleSelectRuntime}
                onPickModel={handleSelectModel}
                disabled={sending}
              />
              <button
                type="button"
                className="cave-composer-icon-button focus-ring grid h-[30px] w-[30px] place-items-center rounded-full border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)] disabled:opacity-40"
                title="Voice input (coming soon)"
                aria-label="Voice input"
                disabled
              >
                <Icon name="ph:microphone" width={15} aria-hidden />
              </button>
              <button
                type="button"
                className="cave-composer-icon-button focus-ring grid h-[30px] w-[30px] place-items-center rounded-full border border-[var(--border-hairline)] hover:bg-[var(--bg-raised)] disabled:opacity-40"
                title="Enhance prompt"
                aria-label="Enhance prompt"
                disabled={sending || enhanceStatus === "loading" || !text.trim()}
                onClick={() => enhancePrompt()}
              >
                <Icon name="ph:sparkle" width={13} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={(!text.trim() && attachments.length === 0) || sending}
                className="cave-composer-icon-button focus-ring grid h-[30px] w-[30px] place-items-center rounded-full bg-[var(--accent-presence)] text-[var(--accent-presence-foreground)] transition-colors hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-40"
                title={`Send message (${keys.enter})`}
                aria-label="Send"
              >
                {sending ? (
                  <span className="hc-spinner" />
                ) : (
                  <Icon name="ph:arrow-up-bold" width={13} aria-hidden />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer band — the darker strip attached to the card's underside
            (reference layout): where the message runs (project) and who runs
            it (agent) on the left, run settings (Options) on the right. */}
        <div className="hc-footer-band">
          <div className="hc-footer-band-left">
            {/* Project selector — picks which project the new chat runs in
                (mirrors the chat composer). */}
            <ProjectPicker
              projects={projects}
              value={selectedProjectId || null}
              onChange={setSelectedProjectId}
              allowNoProject
              familiarId={selectedFamiliarId || null}
              createProject={createProject}
              disabled={sending}
              ariaLabel="Choose project"
              className="hc-project-selector"
            />
            <HomeSelect
              icon="ph:warning-circle"
              value={selectedFamiliarId}
              onChange={(value) => {
                if (value) onSetActiveFamiliar(value);
              }}
              groups={familiarSelectGroups}
              ariaLabel="Choose chat agent"
              disabled={visibleFamiliars.length === 0 || sending}
              className="hc-access-chip"
            />
          </div>
          <ComposerOptionsMenu
            hostValue={runtimeHost ?? LOCAL_HOST_ID}
            onHostPick={setRuntimeHost}
            disabled={sending}
            indicator={
              thinkingEffort !== COMMAND_CONTROL_DEFAULTS.thinkingEffort ||
              responseSpeed !== COMMAND_CONTROL_DEFAULTS.responseSpeed
            }
            sections={[
              {
                id: "runtime",
                label: "Runtime",
                value: selectedRuntime,
                options: runtimeSectionOptions,
                onChange: (id: string) => handleSelectRuntime(id),
              } satisfies ComposerOptionSection,
              ...(runtimeModelOptions.length > 0
                ? [{
                    id: "model",
                    label: "Model",
                    value: selectedModelId,
                    options: runtimeModelOptions.map((m) => ({ value: m.id, label: m.label })),
                    onChange: (id: string) => handleSelectModel(id),
                  } satisfies ComposerOptionSection]
                : []),
              {
                id: "thinking",
                label: "Thinking",
                value: thinkingEffort,
                options: COMMAND_THINKING_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                onChange: (v: string) => setThinkingEffort(v as CommandThinkingEffort),
              } satisfies ComposerOptionSection,
              {
                id: "speed",
                label: "Speed",
                value: responseSpeed,
                options: COMMAND_RESPONSE_SPEED_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                onChange: (v: string) => setResponseSpeed(v as CommandResponseSpeed),
              } satisfies ComposerOptionSection,
            ]}
          />
        </div>
        </div>
      </div>

      <HomeSuggestions
        projectName={selectedProject?.name ?? null}
        onPick={insertPrompt}
      />

      {/* Continue + News as an auto-scrolling digest carousel (restored): two
          horizontal tracks — resume-first recent chats + freshest headlines —
          that pause on hover and fall back to a manual scroll under
          prefers-reduced-motion. Width matches the composer above it. */}
      <HomeDigestCarousel
        sessions={sessions}
        familiarNameById={familiarNameById}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}
