"use client";

/**
 * HomeComposer — universal intent surface; the Cave's cold-start view.
 *
 * Home can start chat directly, so it includes an agent selector next to the
 * destination controls instead of requiring a detour through the sidebar.
 */

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ComposerHostChip } from "@/components/composer-host-chip";
import { ProjectAvatar } from "@/components/project-avatar";
import { LOCAL_HOST_ID } from "@/lib/chat-hosts";
import type { Familiar, SessionRow } from "@/lib/types";
import { Icon, type IconName } from "@/lib/icon";
import { modelSlashOptions, resolveModelArg } from "@/lib/slash-model";
import {
  skillSlashOptions,
  resolveSkillArg,
  buildSkillPrompt,
  type SkillOption,
} from "@/lib/slash-skill";
import { SkillDetailPreview } from "@/components/skill-detail-preview";
import type { ChatModelState } from "@/lib/chat-model-state";
import { readComposerHistory, writeComposerHistory } from "@/lib/composer-history";
import { canonicalize, matchSlash, type SlashCommand } from "@/lib/slash-commands";
import { useArchivedFamiliars } from "@/lib/cave-familiar-archive";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useProjects } from "@/lib/use-projects";
import { NO_PROJECT_ID } from "@/lib/chat-projects";
import { ADD_PROJECT_ID, useAddProjectFlow } from "@/components/project-picker";
import { catalogForRuntime, defaultModelForRuntime } from "@/lib/runtime-models";
import { COMPATIBILITY_ADAPTERS } from "@/lib/harness-adapters";
import { HomeDigestCarousel } from "@/components/home/home-digest-carousel";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  attachmentIcon,
  fileToAttachment,
  hasDraggedFiles,
  type ChatAttachment,
  type ComposerAttachment,
} from "@/lib/chat-attachments";
import {
  COMMAND_CONTROL_DEFAULTS,
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "@/lib/command-controls";
import { buildPromptEnhancement } from "@/lib/prompt-enhancer";

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
  /** Resume a recent chat from the daily-summary carousel's session cards. */
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
};

// Persist the in-progress prompt so a page reload doesn't eat what you were
// typing on the home screen (mirrors the chat composer's draft persistence).
const HOME_DRAFT_KEY = "cave:home-composer-draft:v1";
const HOME_DRAFT_WRITE_DELAY_MS = 250;
// Persisted ↑/↓ prompt-history recall stack for the home composer.
const HOME_HISTORY_KEY = "cave:home-composer-history:v1";
const RUNTIME_MODEL_SEPARATOR = "::";

function readHomeDraft(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(HOME_DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeHomeDraft(text: string) {
  if (typeof window === "undefined") return;
  try {
    if (text) window.localStorage.setItem(HOME_DRAFT_KEY, text);
    else window.localStorage.removeItem(HOME_DRAFT_KEY);
  } catch {
    /* best effort */
  }
}

function runtimeModelValue(runtime: string, model: string): string {
  return `${runtime}${RUNTIME_MODEL_SEPARATOR}${model}`;
}

function parseRuntimeModelValue(value: string): { runtime: string; model: string } {
  const [runtime = "", model = ""] = value.split(RUNTIME_MODEL_SEPARATOR);
  return { runtime, model };
}

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
  const [text, setText] = useState(() => readHomeDraft());
  const [destination, setDestination] = useState<Destination>("chat");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<string[]>(() => readComposerHistory(HOME_HISTORY_KEY));
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [slashIdx, setSlashIdx] = useState(0);
  // Escape dismisses the inline slash/model/skill menus (they otherwise stay
  // open purely as a function of the text). Reset whenever the text changes so
  // typing a fresh command token re-opens them.
  const [slashDismissed, setSlashDismissed] = useState(false);
  const { announce } = useAnnouncer();
  // Stable per-mount listbox id — the chat composer mounts its own slash menu,
  // so ids must be unique across simultaneously mounted composers.
  const slashListboxId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Attachments staged in the composer; handed to the opened chat on submit.
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Drag-and-drop onto the composer card. dragDepthRef counts enter/leave pairs
  // so moving across child elements doesn't flicker the overlay.
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);
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
  // the first visible one so the <select>'s value matches an actual option and
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
  const selectedResolved = useMemo(
    () => resolvedFamiliars.find((familiar) => familiar.id === selectedFamiliarId) ?? null,
    [resolvedFamiliars, selectedFamiliarId],
  );
  const [modelState, setModelState] = useState<ChatModelState | null>(null);
  const { projects, createProject } = useProjects({ familiarId: selectedFamiliarId || null });
  const [selectedProjectId, setSelectedProjectId] = useState("");
  // Shared register+grant flow behind the select's "Add project…" option —
  // the composer no longer dead-ends when the wanted root isn't registered.
  const addProjectFlow = useAddProjectFlow({
    familiarId: selectedFamiliarId || null,
    createProject,
    projects,
    onAdded: setSelectedProjectId,
  });
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
  const selectedRuntimeModelValue = runtimeModelValue(selectedRuntime, selectedModelId);

  useEffect(() => {
    if (selectedProjectId === NO_PROJECT_ID) return; // an explicit No-project choice is valid
    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) return;
    setSelectedProjectId(projects[0]?.id ?? "");
  }, [projects, selectedProjectId]);

  // Show the selected familiar's effective model on the home composer. No session
  // exists here, so GET keys on familiarId only. The `cancelled` flag drops any
  // out-of-order response when the selection changes mid-flight.
  useEffect(() => {
    if (!selectedFamiliarId) {
      setModelState(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/chat/model-state?familiarId=${encodeURIComponent(selectedFamiliarId)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
        if (cancelled) return;
        setModelState(json.ok && json.state ? json.state : null);
      } catch {
        if (!cancelled) setModelState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedFamiliarId]);

  // A pick at home is sticky per familiar: PATCH familiar-default (the in-chat
  // picker's no-session path). The new chat inherits it at send time.
  const handleSelectModel = useCallback(
    (modelId: string) => {
      if (!selectedFamiliarId) return;
      void (async () => {
        try {
          const res = await fetch("/api/chat/model-state", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              familiarId: selectedFamiliarId,
              model: modelId,
              scope: "familiar-default",
            }),
          });
          const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
          if (json.ok && json.state) setModelState(json.state);
        } catch {
          /* keep prior state; the effect refetches when the familiar changes */
        }
      })();
    },
    [selectedFamiliarId],
  );

  const refetchModelState = useCallback(() => {
    if (!selectedFamiliarId) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/chat/model-state?familiarId=${encodeURIComponent(selectedFamiliarId)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
        if (json.ok && json.state) setModelState(json.state);
      } catch {
        /* keep the optimistic value */
      }
    })();
  }, [selectedFamiliarId]);

  const handleSelectRuntime = useCallback(
    (runtime: string, selectedModel?: string) => {
      if (!selectedFamiliarId) return;
      const nextModel = selectedModel || defaultModelForRuntime(runtime);
      setModelState((current) => ({
        familiarId: selectedFamiliarId,
        runtime: current?.runtime ?? null,
        harness: runtime,
        effectiveModel: nextModel,
        source: "familiar-default",
        applicationState: "saved",
        reason: "Selected from the home composer.",
      }));
      void (async () => {
        try {
          const res = await fetch("/api/config", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              familiars: {
                [selectedFamiliarId]: { harness: runtime, model: nextModel },
              },
            }),
          });
          const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean };
          if (json.ok) refetchModelState();
        } catch {
          refetchModelState();
        }
      })();
    },
    [refetchModelState, selectedFamiliarId],
  );

  const handleSelectRuntimeModel = useCallback(
    (value: string) => {
      const { runtime, model } = parseRuntimeModelValue(value);
      if (!runtime) return;
      if (runtime === selectedRuntime) {
        handleSelectModel(model || defaultModelForRuntime(runtime));
        return;
      }
      handleSelectRuntime(runtime, model);
    },
    [handleSelectModel, handleSelectRuntime, selectedRuntime],
  );

  // Mirror the chat composer's matching rule: surface only while the user is
  // still typing the command token (no whitespace yet).
  const slashSuggestions: SlashCommand[] = useMemo(() => {
    const firstWord = text.trimStart().split(/\s/)[0] ?? "";
    if (!firstWord.startsWith("/") || text.trimStart().includes(" ")) return [];
    return matchSlash(firstWord);
  }, [text]);

  // Inline model picker: typing "/model <partial>" shows model options.
  const modelHarness =
    modelState?.harness ?? selectedFamiliar?.harness ?? "claude";
  const modelOptions = useMemo(() => modelSlashOptions(text, modelHarness), [text, modelHarness]);
  const modelMenuActive = !slashDismissed && (modelOptions?.length ?? 0) > 0;
  // Inline skill picker: "/skill <partial>" / "/skills" shows skill options.
  const [skills, setSkills] = useState<SkillOption[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/skills/local", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j?.ok && Array.isArray(j.skills)) setSkills(j.skills as SkillOption[]);
      })
      .catch(() => {
        /* offline → no inline skill picker */
      });
    return () => {
      alive = false;
    };
  }, []);
  const skillOptions = useMemo(() => skillSlashOptions(text, skills), [text, skills]);
  const skillMenuActive = !slashDismissed && (skillOptions?.length ?? 0) > 0;
  // The inline listboxes (slash commands, /model, /skill) share the same listbox
  // id, so the textarea's combobox ARIA tracks whichever is open.
  const menuOpen =
    modelMenuActive || skillMenuActive || (!slashDismissed && slashSuggestions.length > 0);

  // Invoke a skill from home = open a new chat that asks the familiar to run it.
  const invokeSkill = useCallback(
    (skill: SkillOption) => {
      if (!selectedFamiliarId) {
        onToast("No familiar selected — add one in Settings.");
        return;
      }
      setText("");
      onStartChat(buildSkillPrompt(skill), selectedFamiliarId, selectedProject?.root ?? null, {
        initialControls: { thinkingEffort, responseSpeed, ...(runtimeHost ? { runtimeHost } : {}) },
      });
    },
    [selectedFamiliarId, selectedProject, thinkingEffort, responseSpeed, runtimeHost, onStartChat, onToast],
  );

  useEffect(() => {
    setSlashIdx(0);
    setSlashDismissed(false);
  }, [text]);

  // Persist the draft so a reload restores it; cleared when the input empties
  // (e.g. after a send), so sent prompts don't reappear.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeHomeDraft(text);
    }, HOME_DRAFT_WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  // Persist the ↑/↓ prompt-history so past prompts survive a reload.
  useEffect(() => {
    writeComposerHistory(HOME_HISTORY_KEY, history);
  }, [history]);

  // Focus on mount
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 80);
  }, []);

  // Maps a familiar id to its display name for the daily-summary carousel.
  const familiarNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of familiars) m.set(f.id, f.display_name);
    return m;
  }, [familiars]);

  // Auto-grow textarea
  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  // ── Attachments ──────────────────────────────────────────────────────────
  // Paperclip stages picked files (cap 10, mirroring the chat composer); they
  // ride along to the opened chat on submit. Slash commands still open by
  // typing "/" in the composer, so the retired "+" launcher loses nothing.
  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const room = Math.max(0, 10 - attachments.length);
    const selected = Array.from(files).slice(0, room);
    if (selected.length === 0) {
      onToast("Attachment limit reached (10).");
      return;
    }
    const next = await Promise.all(selected.map(fileToAttachment));
    setAttachments((prev) => [...prev, ...next]);
    announce(`Attached ${next.length} file${next.length === 1 ? "" : "s"}`, "polite");
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [attachments.length, onToast, announce]);
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

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
        setHistory((prev) => [...prev, prompt]);
        setHistoryIdx(-1);
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
        setHistory((prev) => [...prev, prompt]);
        setHistoryIdx(-1);
        if (!args.trim()) {
          setText("");
          onToast("Type /skill <name>, or pick one from the menu.");
          return;
        }
        const skill = resolveSkillArg(args, skills);
        if (!skill) {
          setText("");
          onToast(`Unknown skill "${args.trim()}".`);
          return;
        }
        invokeSkill(skill);
        return;
      }
      if (onSlash) {
        setHistory((prev) => [...prev, prompt]);
        setHistoryIdx(-1);
        setText("");
        onSlash(command, args);
      } else {
        onToast(`Slash commands aren't wired up here yet — try ${command} from a chat.`);
      }
      return;
    }

    setHistory((prev) => [...prev, prompt]);
    setHistoryIdx(-1);
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
          writeHomeDraft("");
          setAttachments([]);
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
          if (json.ok) { setText(""); writeHomeDraft(""); setAttachments([]); setEnhanceOriginal(null); onNavigateToBoard(); }
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
    handleSelectModel,
    onSlash,
    onStartChat,
    onNavigateToBoard,
    onToast,
    skills,
    invokeSkill,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Escape closes any open inline menu — the menu footers advertise
      // "Esc cancel", and typing re-opens it (slashDismissed resets on text).
      if (e.key === "Escape" && menuOpen) {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
      // Inline model picker takes priority when "/model <partial>" is open.
      if (modelMenuActive && modelOptions) {
        const opts = modelOptions;
        if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, opts.length - 1)); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return; }
        if (e.key === "Tab") { e.preventDefault(); const m = opts[slashIdx]; if (m) setText(`/model ${m.id}`); return; }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const m = opts[slashIdx];
          if (m) { handleSelectModel(m.id); onToast(`Model set to ${m.id}.`); setText(""); }
          return;
        }
      }
      // Inline skill picker ("/skill <partial>" or "/skills").
      if (skillMenuActive && skillOptions) {
        const opts = skillOptions;
        if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, opts.length - 1)); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return; }
        if (e.key === "Tab") { e.preventDefault(); const s = opts[slashIdx]; if (s) setText(`/skill ${s.id}`); return; }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const s = opts[slashIdx];
          if (s) invokeSkill(s);
          return;
        }
      }
      // Slash menu hotkeys take priority over history/submit when it's open
      if (!slashDismissed && slashSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashIdx((i) => Math.min(i + 1, slashSuggestions.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashIdx((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const cmd = slashSuggestions[slashIdx];
          if (cmd) setText(cmd.name + (cmd.argPlaceholder ? " " : ""));
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const cmd = slashSuggestions[slashIdx];
          // If the input is an exact command (no args yet), run it directly;
          // otherwise autocomplete first so the user can fill in args.
          if (cmd && cmd.argPlaceholder && canonicalize(text.trim()) !== cmd.name) {
            setText(cmd.name + " ");
          } else {
            void handleSubmit();
          }
          return;
        }
      }
      // plain Enter sends; Shift+Enter inserts newline
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
        return;
      }
      if (e.key === "ArrowUp" && text === "" && history.length > 0) {
        e.preventDefault();
        const idx = historyIdx < history.length - 1 ? historyIdx + 1 : historyIdx;
        setHistoryIdx(idx);
        setText(history[history.length - 1 - idx] ?? "");
        return;
      }
      if (e.key === "ArrowDown" && historyIdx > 0) {
        e.preventDefault();
        const idx = historyIdx - 1;
        setHistoryIdx(idx);
        setText(history[history.length - 1 - idx] ?? "");
        return;
      }
      if (e.key === "ArrowDown" && historyIdx === 0) {
        e.preventDefault();
        setHistoryIdx(-1);
        setText("");
      }
    },
    [
      handleSubmit,
      handleSelectModel,
      history,
      historyIdx,
      modelMenuActive,
      modelOptions,
      skillMenuActive,
      skillOptions,
      invokeSkill,
      onToast,
      menuOpen,
      slashDismissed,
      slashIdx,
      slashSuggestions,
      text,
    ],
  );

  const renderCompactSelect = (
    label: string,
    icon: IconName,
    value: string,
    onChange: (value: string) => void,
    options: Array<{ value: string; label: string }>,
    ariaLabel: string,
  ) => (
    <label className="hc-familiar-selector hc-command-select">
      <Icon name={icon} width={13} className="hc-familiar-glyph" aria-hidden />
      <span className="hc-command-select-label">{label}</span>
      <select
        aria-label={ariaLabel}
        className="hc-familiar-select"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        disabled={sending}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="ph:caret-up-down-bold" width={10} className="hc-select-caret" aria-hidden />
    </label>
  );

  return (
    <div className="home-composer-root">

      {/* Headline */}
      <div className="home-composer-hero">
        <h1 className="home-composer-headline">
          {`What should we build in ${selectedProject?.name ?? "Coven Cave"}?`}
        </h1>
      </div>

      {/* Composer card — wrapped so the slash menu can render above the
          card without being clipped by the card's `overflow: hidden`. */}
      <div className="home-composer-card-wrap">

        {/* Slash suggestion popover — anchored above the card so it doesn't
            push the rest of the layout when it opens. */}
        {modelMenuActive && modelOptions ? (
          <div className="hc-slash-menu">
            <ul className="hc-slash-list" id={slashListboxId} role="listbox" aria-label="Models">
              {modelOptions.map((m, i) => {
                const active = i === slashIdx;
                return (
                  <li key={m.id} role="option" id={`${slashListboxId}-opt-${i}`} aria-selected={active}>
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseEnter={() => setSlashIdx(i)}
                      onClick={() => {
                        handleSelectModel(m.id);
                        onToast(`Model set to ${m.id}.`);
                        setText("");
                        textareaRef.current?.focus();
                      }}
                      className={`hc-slash-row${active ? " active" : ""}`}
                    >
                      <span className="hc-slash-name">{m.label}</span>
                      <span className="hc-slash-desc">{m.id}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="hc-slash-footer">↑↓ navigate · Enter switch · Esc cancel</div>
          </div>
        ) : skillMenuActive && skillOptions ? (
          <div className="hc-slash-menu">
            <div className="hc-slash-body">
              <ul className="hc-slash-list" id={slashListboxId} role="listbox" aria-label="Skills">
                {skillOptions.map((s, i) => {
                  const active = i === slashIdx;
                  return (
                    <li key={s.id} role="option" id={`${slashListboxId}-opt-${i}`} aria-selected={active}>
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseEnter={() => setSlashIdx(i)}
                        onClick={() => invokeSkill(s)}
                        className={`hc-slash-row${active ? " active" : ""}`}
                      >
                        <span className="hc-slash-name">{s.name}</span>
                        <span className="hc-slash-desc">{s.description || s.id}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <SkillDetailPreview skill={skillOptions[slashIdx] ?? skillOptions[0] ?? null} />
            </div>
            <div className="hc-slash-footer">↑↓ navigate · Enter run · Tab complete · Esc cancel</div>
          </div>
        ) : !slashDismissed && slashSuggestions.length > 0 ? (
          <div className="hc-slash-menu">
            <ul className="hc-slash-list" id={slashListboxId} role="listbox" aria-label="Slash commands">
              {slashSuggestions.map((cmd, i) => {
                const active = i === slashIdx;
                return (
                  <li
                    key={cmd.name}
                    role="option"
                    id={`${slashListboxId}-opt-${i}`}
                    aria-selected={active}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseEnter={() => setSlashIdx(i)}
                      onClick={() => {
                        setText(cmd.name + (cmd.argPlaceholder ? " " : ""));
                        textareaRef.current?.focus();
                      }}
                      className={`hc-slash-row${active ? " active" : ""}`}
                    >
                      <span className="hc-slash-name">{cmd.name}</span>
                      <span className="hc-slash-desc">{cmd.description}</span>
                      {cmd.argPlaceholder ? (
                        <span className="hc-slash-arg">{cmd.argPlaceholder}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="hc-slash-footer">
              ↑↓ navigate · Enter run · Tab complete · type space to dismiss
            </div>
          </div>
        ) : null}

        <div
          className={`home-composer-card${dropActive ? " is-drop-active" : ""}`}
          onDragEnter={(e) => {
            if (!hasDraggedFiles(e.dataTransfer.types)) return;
            e.preventDefault();
            dragDepthRef.current += 1;
            setDropActive(true);
          }}
          onDragOver={(e) => {
            if (!hasDraggedFiles(e.dataTransfer.types)) return;
            e.preventDefault();
          }}
          onDragLeave={(e) => {
            if (!hasDraggedFiles(e.dataTransfer.types)) return;
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setDropActive(false);
          }}
          onDrop={(e) => {
            dragDepthRef.current = 0;
            setDropActive(false);
            if (!hasDraggedFiles(e.dataTransfer.types)) return;
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
        >
          {dropActive ? (
            <div className="hc-drop-overlay" aria-hidden="true">
              <div className="hc-drop-overlay-inner">
                <Icon name="ph:paperclip" width={16} aria-hidden />
                <span>Drop files to attach</span>
              </div>
            </div>
          ) : null}

        {/* Mode strip — the composer's primary intent switch (Chat vs Task)
            leads the card, above the textarea, so it reads as the top-level
            mode rather than one control buried among the per-send config. */}
        <div className="hc-mode-strip">
          <div
            className="hc-dest-pills"
            role="radiogroup"
            aria-label="Send to"
            ref={destGroupRef}
            onKeyDown={handleDestKeyDown}
          >
            {DESTINATIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={destination === d.id}
                tabIndex={destination === d.id ? 0 : -1}
                className={`hc-dest-pill${destination === d.id ? " active" : ""}`}
                onClick={() => setDestination(d.id)}
                title={d.label}
              >
                <Icon name={d.icon} width={12} aria-hidden />
                <span className="hc-dest-label">{d.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="hc-textarea"
          placeholder={PLACEHOLDERS[destination]}
          rows={3}
          value={text}
          onChange={(e) => { setText(e.target.value); autoGrow(); if (enhanceOriginal != null) setEnhanceOriginal(null); }}
          onPaste={(e) => {
            // Paste-to-attach: clipboard files (screenshots, copied files) stage
            // as attachments. Only preventDefault when files were consumed so a
            // plain-text paste is untouched.
            const pastedFiles = Array.from(e.clipboardData.items)
              .filter((item) => item.kind === "file")
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null);
            if (pastedFiles.length > 0) {
              e.preventDefault();
              void addFiles(pastedFiles);
            }
          }}
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

        {/* Staged attachments — a count + clear-all header over the chips
            (each chip has its own remove control; mirrors chat). */}
        {attachments.length > 0 && (
          <div className="hc-attachments-wrap">
            <div className="hc-attachments-head">
              <span className="hc-attachments-count">{attachments.length}/10 attached</span>
              <button
                type="button"
                className="hc-attachments-clear"
                onClick={() => setAttachments([])}
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

        {/* Action bar */}
        <div className="hc-action-bar">
          <div className="hc-control-group hc-control-group--tools">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hc-file-input"
              onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
              tabIndex={-1}
              aria-hidden
            />
            <button
              type="button"
              className="hc-add-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              aria-label="Attach files"
              title="Attach files"
            >
              <Icon name="ph:paperclip" width={15} aria-hidden />
            </button>

            {enhanceOriginal != null && (
              <button
                type="button"
                className="hc-enhance-undo"
                onClick={revertEnhance}
                disabled={sending}
                title="Undo enhance"
              >
                Undo
              </button>
            )}
            <button
              type="button"
              className={`hc-enhance-btn${enhanceStatus === "loading" ? " loading" : ""}`}
              onClick={() => void enhancePrompt()}
              disabled={!text.trim() || sending || enhanceStatus === "loading"}
              aria-label="Enhance prompt"
              title="Enhance prompt"
            >
              {enhanceStatus === "loading" ? (
                <span className="hc-spinner" />
              ) : (
                <Icon name="ph:sparkle" width={13} aria-hidden />
              )}
              <span className="hc-enhance-label">Enhance</span>
            </button>
          </div>

          <div className="hc-control-group hc-control-group--identity">
            <label className="hc-familiar-selector">
              {selectedResolved ? (
                <FamiliarAvatar familiar={selectedResolved} size="sm" className="hc-familiar-glyph hc-familiar-avatar" />
              ) : (
                <Icon name="ph:sparkle" width={13} className="hc-familiar-glyph" aria-hidden />
              )}
              <select
                aria-label="Choose chat agent"
                className="hc-familiar-select"
                value={selectedFamiliarId}
                onChange={(e) => {
                  if (e.currentTarget.value) onSetActiveFamiliar(e.currentTarget.value);
                }}
                disabled={visibleFamiliars.length === 0 || sending}
              >
                {visibleFamiliars.length === 0 ? (
                  <option value="">No agents</option>
                ) : (
                  visibleFamiliars.map((familiar) => (
                    <option key={familiar.id} value={familiar.id}>
                      {familiar.display_name}
                    </option>
                  ))
                )}
              </select>
              <Icon name="ph:caret-up-down-bold" width={10} className="hc-select-caret" aria-hidden />
            </label>

            <label className="hc-familiar-selector hc-project-selector">
              {selectedProject && selectedProjectId !== NO_PROJECT_ID ? (
                <ProjectAvatar
                  name={selectedProject.name}
                  root={selectedProject.root}
                  color={selectedProject.color}
                  size="sm"
                />
              ) : (
                <Icon name="ph:folder" width={13} className="hc-familiar-glyph" aria-hidden />
              )}
              <select
                aria-label="Choose project"
                className="hc-familiar-select"
                value={selectedProjectId}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  // The add row is an action, not a selection — keep the
                  // current value and open the shared register+grant flow.
                  if (value === ADD_PROJECT_ID) {
                    addProjectFlow.beginAddProject();
                    return;
                  }
                  setSelectedProjectId(value);
                }}
                disabled={sending}
              >
                {projects.length === 0 ? (
                  <option value="">No projects yet</option>
                ) : (
                  <>
                    <option value={NO_PROJECT_ID}>No project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </>
                )}
                <option value={ADD_PROJECT_ID}>＋ Add project…</option>
              </select>
              <Icon name="ph:caret-up-down-bold" width={10} className="hc-select-caret" aria-hidden />
            </label>
            {addProjectFlow.addProjectModal}
          </div>

          {/* Runtime/model, Think, and Speed configure a chat send — they're
              meaningless for creating a board task, so they collapse out when
              the Task mode is selected, leaving just the submit affordance. */}
          {destination === "chat" ? (
            <div className="hc-control-group hc-control-group--settings">
              <label className="hc-familiar-selector hc-runtime-model-selector">
                <Icon name="ph:terminal-window" width={13} className="hc-familiar-glyph" aria-hidden />
                <select
                  aria-label="Choose runtime and model"
                  className="hc-familiar-select"
                  value={selectedRuntimeModelValue}
                  onChange={(e) => handleSelectRuntimeModel(e.currentTarget.value)}
                  disabled={!selectedFamiliarId || sending}
                >
                  {COMPATIBILITY_ADAPTERS.filter((adapter) => adapter.chatSupported).map((adapter) => (
                    <optgroup key={adapter.id} label={adapter.label}>
                      {runtimeModelOptionsFor(adapter.id).length === 0 ? (
                        <option value={runtimeModelValue(adapter.id, "")}>
                          Runtime managed
                        </option>
                      ) : (
                        runtimeModelOptionsFor(adapter.id).map((model) => (
                          <option key={model.id} value={runtimeModelValue(adapter.id, model.id)}>
                            {model.label}
                          </option>
                        ))
                      )}
                    </optgroup>
                  ))}
                </select>
                <Icon name="ph:caret-up-down-bold" width={10} className="hc-select-caret" aria-hidden />
              </label>

              {renderCompactSelect(
                "Think",
                "ph:sparkle-bold",
                thinkingEffort,
                (value) => setThinkingEffort(value as CommandThinkingEffort),
                COMMAND_THINKING_OPTIONS,
                "Choose thinking effort",
              )}

              {renderCompactSelect(
                "Speed",
                "ph:lightning-bold",
                responseSpeed,
                (value) => setResponseSpeed(value as CommandResponseSpeed),
                COMMAND_RESPONSE_SPEED_OPTIONS,
                "Choose response speed",
              )}

              <ComposerHostChip
                value={runtimeHost ?? LOCAL_HOST_ID}
                disabled={sending}
                onPick={(id) => setRuntimeHost(id === LOCAL_HOST_ID ? null : id)}
              />
            </div>
          ) : null}

          <div className="hc-control-group hc-control-group--submit">
            <button
              type="button"
              className={`hc-send-btn${sending ? " sending" : ""}${!text.trim() && attachments.length === 0 ? " empty" : ""}`}
              onClick={() => void handleSubmit()}
              disabled={(!text.trim() && attachments.length === 0) || sending}
              aria-label="Send"
            >
              {sending ? (
                <span className="hc-spinner" />
              ) : (
                <Icon name="ph:arrow-up-bold" width={14} aria-hidden />
              )}
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Daily summary — an ambient auto-scrolling digest of today's activity
          and the freshest headlines; pauses on hover so a card can be read. */}
      <HomeDigestCarousel
        sessions={sessions}
        familiarNameById={familiarNameById}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}
