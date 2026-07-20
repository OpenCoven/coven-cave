"use client";

import "@/styles/cave-composer.css";

import { useCallback, useRef, useState } from "react";
// The slash menu popover reuses the home composer's .hc-slash-* affordance —
// this stylesheet is global-scoped, so importing it here makes the menu render
// identically in the tray window (which never mounts the home composer).
import "@/styles/home-composer.css";
import {
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "@/lib/command-controls";
import type { CaveProject } from "@/lib/cave-projects-types";
import { Icon, type IconName } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import { StandardSelect } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { usePromptEnhance } from "@/lib/use-prompt-enhance";
import { useReplyRecommendation, type ReplyRecommendationState } from "@/lib/use-reply-recommendation";
import { EnhanceControl, EnhanceStrip } from "@/components/composer-enhance";
import { IconButton } from "@/components/ui/icon-button";
import { attachmentIcon, type ChatAttachment } from "@/lib/chat-attachments";
import { useAttachmentStaging } from "@/lib/use-attachment-staging";
import type { QueuedQuickChatMessage, QuickChatMessage } from "@/lib/use-quick-chat";
import { useInlineSlashMenus } from "@/lib/use-inline-slash-menus";
import { HomeSlashMenu } from "@/components/home/home-slash-menu";
import { SLASH_COMMANDS, canonicalize } from "@/lib/slash-commands";
import { formatModelList, resolveModelArg } from "@/lib/slash-model";
import {
  buildSkillPrompt,
  formatSkillList,
  resolveSkillInvocation,
  type SkillOption,
} from "@/lib/slash-skill";
import {
  formatPromptList,
  promptInsertion,
  resolvePromptArg,
  type PromptOption,
} from "@/lib/slash-prompt";
import { recordPromptRecent } from "@/lib/prompt-prefs";
import {
  FamiliarMark,
  QuickChatIdentity,
  QuickChatSelect,
  type QuickChatSelectOption,
} from "./quick-chat-primitives";

export {
  FamiliarMark,
  QuickChatIdentity,
  QuickChatSelect,
  type QuickChatSelectOption,
} from "./quick-chat-primitives";
export { QuickChatThread } from "./quick-chat-thread";

export { QUICK_CHAT_SUGGESTIONS } from "./quick-chat-primitives";

// Stable empty reference so QuickChatComposer can pass `messages ?? EMPTY` to
// the recommendation hook without spawning a fresh array (and effect churn)
// every render.
const EMPTY_MESSAGES: QuickChatMessage[] = [];

// ── Controls row ─────────────────────────────────────────────────────────────
// Familiar picker + thinking-effort + response-speed selects — identical in the
// in-app dropdown and the tray window.

const CONTROL_SELECT_CLASS =
  "min-w-0 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 text-xs outline-none";

export function QuickChatControlsRow({
  loading,
  familiars,
  selectedFamiliarId,
  onPickFamiliar,
  projects,
  projectsLoading,
  selectedProjectRoot,
  onPickProjectRoot,
  thinkingEffort,
  onThinkingEffortChange,
  responseSpeed,
  onResponseSpeedChange,
  sending,
  showFamiliarPicker = false,
}: {
  loading: boolean;
  familiars: Familiar[];
  selectedFamiliarId: string | null;
  onPickFamiliar: (id: string | null) => void;
  projects: CaveProject[];
  projectsLoading: boolean;
  selectedProjectRoot: string | null;
  onPickProjectRoot: (root: string | null) => void;
  thinkingEffort: CommandThinkingEffort;
  onThinkingEffortChange: (value: CommandThinkingEffort) => void;
  responseSpeed: CommandResponseSpeed;
  onResponseSpeedChange: (value: CommandResponseSpeed) => void;
  sending: boolean;
  showFamiliarPicker?: boolean;
}) {
  // Once a project is picked the thread is locked to that context (switching
  // would reset the conversation), so the menu collapses into a read-only
  // badge that names the selection instead of offering a pointless re-pick.
  const selectedProject = selectedProjectRoot
    ? projects.find((project) => project.root === selectedProjectRoot) ?? null
    : null;
  const selectedProjectName =
    selectedProject?.name ?? selectedProjectRoot?.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return (
    <div className="quick-chat-overlay__controls">
      {showFamiliarPicker ? (
        <QuickChatSelect
          label="Familiar"
          value={selectedFamiliarId ?? ""}
          onChange={(next) => onPickFamiliar(next || null)}
          disabled={loading || familiars.length === 0}
          className="flex-1"
          options={
            loading && familiars.length === 0
              ? [{ value: "", label: "Loading…", disabled: true }]
              : familiars.map((familiar) => ({
                  value: familiar.id,
                  label: familiar.display_name,
                  leading: <FamiliarMark familiar={familiar} size="sm" />,
                }))
          }
        />
      ) : null}
      {selectedProjectRoot ? (
        <span
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 text-xs"
          title={selectedProjectRoot}
          aria-label={`Project: ${selectedProjectName} (locked for this chat)`}
        >
          <Icon name="ph:folder" width={13} aria-hidden className="shrink-0 text-[var(--fg-muted)]" />
          <span className="min-w-0 truncate">{selectedProjectName}</span>
          <Icon
            name="ph:lock-simple"
            width={11}
            aria-hidden
            className="ml-auto shrink-0 text-[var(--fg-muted)]"
          />
        </span>
      ) : (
        <QuickChatSelect
          label="Project"
          value={selectedProjectRoot ?? "__none__"}
          onChange={(next) => onPickProjectRoot(next === "__none__" ? null : next)}
          disabled={projectsLoading && projects.length === 0}
          className="flex-1"
          options={
            projectsLoading && projects.length === 0
              ? [{ value: "__none__", label: "Loading projects…", disabled: true }]
              : [
                  { value: "__none__", label: "No project", icon: "ph:folder-simple-dashed" as IconName },
                  ...projects.map((project) => ({
                    value: project.root,
                    label: project.name,
                    icon: "ph:folder" as IconName,
                  })),
                ]
          }
        />
      )}
      <StandardSelect
        label="Choose thinking effort"
        value={thinkingEffort}
        onChange={(next) => onThinkingEffortChange(next as CommandThinkingEffort)}
        disabled={sending}
        className={CONTROL_SELECT_CLASS}
        options={COMMAND_THINKING_OPTIONS}
      />
      <StandardSelect
        label="Choose response speed"
        value={responseSpeed}
        onChange={(next) => onResponseSpeedChange(next as CommandResponseSpeed)}
        disabled={sending}
        className={CONTROL_SELECT_CLASS}
        options={COMMAND_RESPONSE_SPEED_OPTIONS}
      />
    </div>
  );
}

// ── Slash commands ───────────────────────────────────────────────────────────
// Quick chat supports the subset of the shared catalog that makes sense in a
// compact tray thread. Everything else gets a pointer to the full app.

const QUICK_SLASH_SUPPORTED = new Set([
  "/help",
  "/clear",
  "/new",
  "/model",
  "/skill",
  "/skills",
  "/prompt",
  "/prompts",
]);

/** The /help note for quick chat — only the commands that work here, sourced
 *  from the shared catalog so names/aliases/descriptions never drift. */
export function quickChatSlashHelp(): string {
  const lines = SLASH_COMMANDS.filter((c) => QUICK_SLASH_SUPPORTED.has(c.name)).map((c) => {
    const names = [c.name, ...(c.aliases ?? [])].join(", ");
    const arg = c.argPlaceholder ? ` <${c.argPlaceholder}>` : "";
    return `  ${names}${arg} — ${c.description}`;
  });
  return [
    "Quick chat commands:",
    ...lines,
    "",
    "@name switches familiar · Enter sends · other /commands live in the full CovenCave chat.",
  ].join("\n");
}

// ── Composer ─────────────────────────────────────────────────────────────────
// Error slot + textarea + actions row, shared by both surfaces. Enter sends;
// Shift+Enter inserts a newline; ⌘/Ctrl+Enter always sends; IME composition is
// left alone. When the slash handlers are wired (tray), a leading `/` opens
// the shared command menu (with /model, /skill and /prompt pickers).

export function QuickChatComposer({
  error,
  draft,
  onDraftChange,
  onSend,
  onCancel,
  sending,
  disabled,
  familiar,
  inputId,
  composerRef,
  autoFocus,
  leading,
  messages,
  active = true,
  onNewThread,
  onLocalNote,
  onSendText,
  modelOverride,
  onModelOverrideChange,
  queued,
  onRemoveQueued,
  onSteerQueued,
}: {
  error: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  /** Send the trimmed draft with the staged files (already id-stripped). */
  onSend: (attachments: ChatAttachment[]) => void;
  onCancel: () => void;
  sending: boolean;
  /** Blocks sending while true (e.g. the roster is still loading). */
  disabled?: boolean;
  familiar: Familiar | null;
  inputId: string;
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  /** Left slot of the actions row — a hint in the tray, Open-in-full-chat in the overlay. */
  leading?: React.ReactNode;
  /** The conversation so far. When provided, a recommended next reply is
   *  generated after each familiar turn and offered for Tab-to-autofill. */
  messages?: QuickChatMessage[];
  /** Whether this composer's pane is the foreground tab — gates recommendation
   *  generation so background tabs don't burn model calls. */
  active?: boolean;
  // Slash commands (all three of onNewThread/onLocalNote/onSendText must be
  // wired to enable them — the tray passes the useQuickChat methods through).
  /** /clear · /new — reset the thread. */
  onNewThread?: () => void;
  /** Append a local assistant-styled note (slash output like /help). */
  onLocalNote?: (text: string) => void;
  /** Send an explicit text through the quick-chat pipeline (skill runs). */
  onSendText?: (text: string) => void;
  /** Current /model override (for the bare `/model` listing). */
  modelOverride?: string | null;
  /** /model pick — set the thread's model override. */
  onModelOverrideChange?: (id: string | null) => void;
  /** Messages parked behind the in-flight turn (chips above the actions row). */
  queued?: QueuedQuickChatMessage[];
  onRemoveQueued?: (id: string) => void;
  onSteerQueued?: (id: string) => void;
}) {
  // Prompt enhancement (cave-b6c2): the shared model-backed hook, mounted
  // internally so every quick-chat surface (dropdown, tray tab, standalone
  // window) gets Enhance with zero consumer wiring.
  const promptEnhance = usePromptEnhance({
    draft,
    setDraft: onDraftChange,
    familiarId: familiar?.id ?? null,
    mode: "chat",
    disabled: sending,
  });
  // Reply recommendation (cave reply-reco): after a familiar turn settles, the
  // shared hook proposes the user's most useful next message. Mounted here so
  // every quick-chat surface gets Tab-to-autofill with zero consumer wiring —
  // exactly like Enhance above.
  const recommendation = useReplyRecommendation({
    messages: messages ?? EMPTY_MESSAGES,
    familiarId: familiar?.id ?? null,
    familiarName: familiar?.display_name ?? null,
    draft,
    enabled: messages != null && active && !sending && !disabled,
  });
  const acceptRecommendation = useCallback(() => {
    const text = recommendation.accept();
    if (text == null) return;
    onDraftChange(text);
    requestAnimationFrame(() => composerRef?.current?.focus());
  }, [recommendation.accept, onDraftChange, composerRef]);

  // Attachment staging (shared hook — same capture behavior as the home/chat
  // composers): drag-and-drop anywhere on the composer footer, paste-to-attach
  // on the textarea, paperclip-free (drop/paste only) at 10 files max.
  const {
    attachments,
    removeAttachment,
    clearAttachments,
    handlePaste,
    dropActive,
    dropHandlers,
  } = useAttachmentStaging({
    focus: () => composerRef?.current?.focus(),
  });

  // Slash commands are live only when the host wires all three handlers (the
  // tray does); otherwise a leading "/" just sends as plain text, as before.
  const slashEnabled = Boolean(onNewThread && onLocalNote && onSendText);
  const modelHarness = familiar?.harness ?? "claude";
  // Shared inline menus (/command listbox + Skills group, /model, /skill,
  // /prompt pickers) — same hook as the home/chat composers so the keyboard
  // grammar transfers. The pick callbacks reference the helpers declared just
  // below; the hook latest-refs its opts, so the late binding is safe (same
  // pattern as home-composer's invokeSkill).
  const menu = useInlineSlashMenus({
    text: draft,
    setText: onDraftChange,
    modelHarness,
    onPickModel: (id) => {
      onModelOverrideChange?.(id);
      onLocalNote?.(`Model set to \`${id}\` for this thread.`);
      onDraftChange("");
    },
    onPickSkill: (s) => invokeSkillOption(s),
    onInsertPrompt: (p) => insertPromptTemplate(p),
    onRunCommand: (cmd) => runSlash(cmd.name),
    onNoMatchEnter: () => {
      if (!disabled && draft.trim()) send();
    },
  });

  // Drop a prompt template into the composer for editing — never a send.
  // Selects the first {{placeholder}} so typing replaces it (mirrors home).
  const insertPromptTemplate = useCallback(
    (p: PromptOption) => {
      const ins = promptInsertion(p);
      recordPromptRecent(p.id);
      onDraftChange(ins.text);
      requestAnimationFrame(() => {
        const el = composerRef?.current;
        if (!el) return;
        el.focus();
        if (ins.selectStart !== undefined && ins.selectEnd !== undefined) {
          el.setSelectionRange(ins.selectStart, ins.selectEnd);
        } else {
          el.setSelectionRange(ins.text.length, ins.text.length);
        }
      });
    },
    [onDraftChange, composerRef],
  );

  // Invoke a skill in-thread: the harness owns Skill execution, so this sends
  // the shared invocation prompt through the quick-chat pipeline. A skill with
  // an argument-hint autofills `/skill <id> ` for argument editing first —
  // picking again (or a hint-less skill) sends (mirrors home's invokeSkill).
  const invokeSkillOption = useCallback(
    (skill: SkillOption, args = "") => {
      const filled = `/skill ${skill.id}`;
      if (skill.argumentHint && !args && draft.trim().toLowerCase() !== filled.toLowerCase()) {
        onDraftChange(`${filled} `);
        composerRef?.current?.focus();
        return;
      }
      onDraftChange("");
      onSendText?.(buildSkillPrompt(skill, args));
    },
    [draft, onDraftChange, composerRef, onSendText],
  );

  // Slash dispatch — the quick-chat subset. Supported commands act locally or
  // send through the pipeline; recognized-but-unsupported commands (e.g.
  // /board) get a pointer to the full app; typos keep the draft for fixing.
  const runSlash = useCallback(
    (prompt: string) => {
      const [rawCmd = "", ...rest] = prompt.split(/\s+/);
      const command = canonicalize(rawCmd) ?? rawCmd;
      const args = rest.join(" ").trim();
      switch (command) {
        case "/help":
          onDraftChange("");
          onLocalNote?.(quickChatSlashHelp());
          return;
        case "/clear":
        case "/new":
          onDraftChange("");
          onNewThread?.();
          return;
        case "/model": {
          onDraftChange("");
          if (!args) {
            onLocalNote?.(formatModelList(modelHarness, modelOverride ?? null));
            return;
          }
          const id = resolveModelArg(args, modelHarness);
          if (!id) {
            onLocalNote?.(`Unknown model "${args}".`);
            return;
          }
          onModelOverrideChange?.(id);
          onLocalNote?.(`Model set to \`${id}\` for this thread.`);
          return;
        }
        case "/skill":
        case "/skills": {
          if (!args) {
            onDraftChange("");
            onLocalNote?.(formatSkillList(menu.skills));
            return;
          }
          const invocation = resolveSkillInvocation(args, menu.skills);
          if (!invocation) {
            onDraftChange("");
            onLocalNote?.(`Unknown skill "${args}".`);
            return;
          }
          invokeSkillOption(invocation.skill, invocation.args);
          return;
        }
        case "/prompt":
        case "/prompts": {
          if (!args) {
            onDraftChange("");
            onLocalNote?.(formatPromptList(menu.prompts));
            return;
          }
          const template = resolvePromptArg(args, menu.prompts);
          if (!template) {
            onDraftChange("");
            onLocalNote?.(`Unknown prompt "${args}".`);
            return;
          }
          insertPromptTemplate(template);
          return;
        }
        default:
          if (canonicalize(rawCmd)) {
            onDraftChange("");
            onLocalNote?.(`${command} isn't available in quick chat — open CovenCave for it. Type /help for what works here.`);
          } else {
            // Keep the draft — likely a typo the user wants to fix in place.
            onLocalNote?.(`Unknown command ${rawCmd}. Type /help for quick-chat commands.`);
          }
      }
    },
    [
      onDraftChange,
      onLocalNote,
      onNewThread,
      onModelOverrideChange,
      modelHarness,
      modelOverride,
      menu.skills,
      menu.prompts,
      invokeSkillOption,
      insertPromptTemplate,
    ],
  );

  const send = useCallback(() => {
    // A leading slash is a command, never a message — same contract as the
    // home/chat composers (only when the host wired the slash handlers).
    // Staged files stay staged across a command (e.g. /model then send).
    const trimmed = draft.trim();
    if (slashEnabled && trimmed.startsWith("/")) {
      runSlash(trimmed);
      return;
    }
    // The strip belongs to the draft being sent — don't leave it hanging
    // over the emptied composer.
    promptEnhance.reset();
    // ComposerAttachment carries a local `id` for the chip row — strip it from
    // the outgoing payload (mirrors the chat composer's send).
    onSend(attachments.map(({ id: _id, ...attachment }) => attachment));
    clearAttachments();
  }, [draft, slashEnabled, runSlash, onSend, promptEnhance.reset, attachments, clearAttachments]);
  // Sendable = something to say (text or files). While a reply streams the
  // same action QUEUES — the hook parks it and auto-sends on settle.
  const canSend = Boolean(draft.trim() || attachments.length > 0);
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // The inline slash menus (Esc-dismiss, ↑↓/Tab/Enter across the pickers)
      // take priority while one is open — shared hook, same ordering as the
      // home/chat composers. Disjoint from the recommendation's Tab-accept:
      // the menus only open on a leading "/", the recommendation only offers
      // Tab on an empty draft.
      if (slashEnabled && menu.handleKeyDown(event)) return;
      // Tab accepts a ready recommendation into the empty composer (it falls
      // through to normal focus traversal when there's nothing to accept, or
      // the user has already started typing their own reply).
      if (
        event.key === "Tab" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        recommendation.suggestion &&
        !draft.trim()
      ) {
        event.preventDefault();
        acceptRecommendation();
        return;
      }
      const cmdEnter = (event.metaKey || event.ctrlKey) && event.key === "Enter";
      const plainEnter =
        event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;
      if (cmdEnter || plainEnter) {
        event.preventDefault();
        // Enter while a reply streams queues the message (the hook parks it);
        // `disabled` (roster loading) still blocks.
        if (!disabled && canSend) send();
      }
    },
    [acceptRecommendation, canSend, disabled, draft, recommendation.suggestion, send, slashEnabled, menu.handleKeyDown],
  );

  const slashMenuOpen = slashEnabled && menu.menuOpen;

  return (
    // `relative` anchors the slash popover (.hc-slash-menu is absolute,
    // bottom-anchored) so it floats above the composer, over the thread. The
    // footer is also the drop target for file attachments — the enter/leave
    // counted handlers keep the overlay steady across child elements.
    <footer
      className={`quick-chat-overlay__composer relative${dropActive ? " quick-chat-overlay__composer--drop" : ""}`}
      {...dropHandlers}
    >
      {dropActive ? (
        <div className="quick-chat-dropzone" aria-hidden>
          <Icon name="ph:paperclip" width={14} aria-hidden />
          Drop files to attach
        </div>
      ) : null}
      {/* Slash suggestion popover — shared .hc-slash-* affordance, compact
          (no skill detail preview: the tray is too narrow for the side panel). */}
      {slashEnabled && menu.modelMenuActive && menu.modelOptions ? (
        <HomeSlashMenu
          listboxId={menu.slashListboxId}
          ariaLabel="Models"
          items={menu.modelOptions.map((m) => ({ key: m.id, name: m.label, desc: m.id }))}
          activeIndex={menu.slashIdx}
          footer="↑↓ navigate · Enter switch · Esc cancel"
          onHover={menu.setSlashIdx}
          onPick={(i) => {
            const m = menu.modelOptions?.[i];
            if (!m) return;
            onModelOverrideChange?.(m.id);
            onLocalNote?.(`Model set to \`${m.id}\` for this thread.`);
            onDraftChange("");
            composerRef?.current?.focus();
          }}
        />
      ) : slashEnabled && menu.skillMenuActive && menu.skillOptions ? (
        <HomeSlashMenu
          listboxId={menu.slashListboxId}
          ariaLabel="Skills"
          items={menu.skillOptions.map((s) => ({ key: s.id, name: s.name, desc: s.description || s.id }))}
          activeIndex={menu.slashIdx}
          footer="↑↓ navigate · Enter run · Tab complete · Esc cancel"
          onHover={menu.setSlashIdx}
          onPick={(i) => {
            const s = menu.skillOptions?.[i];
            if (s) invokeSkillOption(s);
          }}
        />
      ) : slashEnabled && menu.promptMenuActive && menu.promptOptions ? (
        <HomeSlashMenu
          listboxId={menu.slashListboxId}
          ariaLabel="Prompts"
          items={menu.promptOptions.map((p) => ({ key: p.id, name: p.name, desc: p.description || p.id }))}
          activeIndex={menu.slashIdx}
          footer="↑↓ navigate · Enter insert · Tab complete · Esc cancel"
          onHover={menu.setSlashIdx}
          onPick={(i) => {
            const p = menu.promptOptions?.[i];
            if (p) insertPromptTemplate(p);
          }}
        />
      ) : slashEnabled && (menu.slashSuggestions.length > 0 || menu.skillCommandRows.length > 0) ? (
        <HomeSlashMenu
          listboxId={menu.slashListboxId}
          ariaLabel="Slash commands"
          items={[
            ...menu.slashSuggestions.map((cmd) => ({
              key: cmd.name,
              name: cmd.name,
              desc: cmd.description,
              arg: cmd.argPlaceholder || undefined,
            })),
            // Matching skills ride under the commands — one list, one index.
            ...menu.skillCommandRows.map((s) => ({
              key: `skill-${s.id}`,
              name: s.name,
              desc: `Skill · ${s.description || s.id}`,
              arg: s.argumentHint || undefined,
            })),
          ]}
          activeIndex={menu.slashIdx}
          footer="↑↓ navigate · Enter run · Tab complete · type space to dismiss"
          onHover={menu.setSlashIdx}
          onPick={(i) => {
            const cmd = menu.slashSuggestions[i];
            const s = menu.skillCommandRows[i - menu.slashSuggestions.length];
            if (cmd) {
              onDraftChange(cmd.name + (cmd.argPlaceholder ? " " : ""));
              composerRef?.current?.focus();
            } else if (s) {
              invokeSkillOption(s);
            }
          }}
        />
      ) : null}
      {error ? (
        <p className="quick-chat-overlay__error" role="alert">
          {error}
        </p>
      ) : null}
      <ReplyRecommendationStrip
        state={recommendation.state}
        onUse={acceptRecommendation}
        onDismiss={recommendation.dismiss}
        onRegenerate={recommendation.regenerate}
      />
      <textarea
        ref={composerRef}
        id={inputId}
        value={draft}
        autoFocus={autoFocus}
        aria-label="Message"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={slashMenuOpen}
        aria-controls={slashMenuOpen ? menu.slashListboxId : undefined}
        aria-activedescendant={slashMenuOpen ? `${menu.slashListboxId}-opt-${menu.slashIdx}` : undefined}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={handlePaste}
        placeholder={familiar ? `Message @${familiar.id}…` : "@sage summarize what needs attention"}
        className="quick-chat-overlay__input"
      />
      {attachments.length > 0 ? (
        <div className="quick-chat-attachments" role="group" aria-label="Attached files">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="quick-chat-attachment-chip" title={attachment.name}>
              <Icon name={attachmentIcon(attachment)} width={11} aria-hidden />
              <span className="quick-chat-attachment-chip__name">{attachment.name}</span>
              <IconButton
                icon="ph:x"
                size="xs"
                aria-label={`Remove ${attachment.name}`}
                title={`Remove ${attachment.name}`}
                onClick={() => removeAttachment(attachment.id)}
              />
            </span>
          ))}
        </div>
      ) : null}
      {queued && queued.length > 0 ? (
        <div className="quick-chat-queued" role="group" aria-label="Queued messages">
          {queued.map((item) => (
            <span key={item.id} className="quick-chat-queued__chip" title={item.text}>
              <span
                className="quick-chat-queued__steer"
                onClick={() => onSteerQueued?.(item.id)}
                onKeyDown={(event) => {
                  if (!onSteerQueued) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSteerQueued(item.id);
                  }
                }}
                role="button"
                tabIndex={onSteerQueued ? 0 : -1}
                aria-disabled={!onSteerQueued}
                aria-label="Send queued message next"
                title="Send this queued message next"
              >
                <Icon name="ph:clock" width={11} aria-hidden />
                <span className="quick-chat-queued__text">
                  {item.text.trim() ||
                    `${item.attachments?.length ?? 0} file${(item.attachments?.length ?? 0) === 1 ? "" : "s"}`}
                </span>
                {item.attachments?.length && item.text.trim() ? (
                  <span className="quick-chat-queued__count">📎{item.attachments.length}</span>
                ) : null}
              </span>
              {onRemoveQueued ? (
                <IconButton
                  icon="ph:x"
                  size="xs"
                  aria-label="Remove queued message"
                  title="Remove from queue"
                  onClick={() => onRemoveQueued(item.id)}
                />
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      <EnhanceStrip
        state={promptEnhance.state}
        onApply={promptEnhance.apply}
        onDismiss={promptEnhance.dismiss}
        onRevert={promptEnhance.revert}
        onCancel={promptEnhance.cancel}
      />
      <div className="quick-chat-overlay__actions">
        {leading}
        <div className="flex items-center gap-2">
          <EnhanceControl
            state={promptEnhance.state}
            onEnhance={promptEnhance.enhance}
            onCancel={promptEnhance.cancel}
            disabled={sending || !draft.trim()}
            size="sm"
          />
          {sending ? (
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Stop
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            leadingIcon="ph:sparkle"
            onClick={send}
            disabled={disabled || !canSend}
            title={sending ? "Queues — sends when the reply finishes" : undefined}
          >
            {sending ? "Queue" : "Send"}
          </Button>
        </div>
      </div>
    </footer>
  );
}

// ── Reply recommendation strip ───────────────────────────────────────────────
// Renders above the composer input once a familiar has replied: a shimmer while
// the suggestion streams, then the proposed reply with a Tab affordance. Click
// (or Tab in the empty composer) autofills it; refresh asks for another;
// dismiss retires it for this turn.

export function ReplyRecommendationStrip({
  state,
  onUse,
  onDismiss,
  onRegenerate,
}: {
  state: ReplyRecommendationState;
  onUse: () => void;
  onDismiss: () => void;
  onRegenerate: () => void;
}) {
  if (state.phase === "idle") return null;
  const loading = state.phase === "loading";
  return (
    <div className="quick-chat-reco" role="group" aria-label="Recommended reply">
      <span className="quick-chat-reco__label">
        <Icon name="ph:sparkle" width={12} aria-hidden />
        {loading ? "Recommending a reply…" : "Recommended reply"}
      </span>
      {loading ? (
        state.preview ? (
          <p className="quick-chat-reco__text quick-chat-reco__text--preview">
            {state.preview}
            <span className="quick-chat-caret" aria-hidden />
          </p>
        ) : (
          <span className="quick-chat-reco__shimmer" aria-hidden />
        )
      ) : (
        <>
          <p className="quick-chat-reco__text">{state.text}</p>
          <span className="quick-chat-reco__actions">
            <kbd className="quick-chat-reco__kbd" aria-hidden>
              Tab
            </kbd>
            <Button
              size="xs"
              variant="secondary"
              onClick={onUse}
              title="Use this reply (Tab)"
            >
              Use
            </Button>
            <IconButton
              icon="ph:arrow-clockwise"
              size="xs"
              aria-label="Suggest another reply"
              title="Suggest another"
              onClick={onRegenerate}
            />
            <IconButton
              icon="ph:x"
              size="xs"
              aria-label="Dismiss recommended reply"
              title="Dismiss"
              onClick={onDismiss}
            />
          </span>
        </>
      )}
    </div>
  );
}

/** Suggestion chips fill the composer, then move the caret into it so the user
 *  can tweak-and-send. Returns the textarea ref to pass to QuickChatComposer. */
export function useSuggestionPicker(setDraft: (value: string) => void) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pickSuggestion = useCallback(
    (value: string) => {
      setDraft(value);
      requestAnimationFrame(() => composerRef.current?.focus());
    },
    [setDraft],
  );
  return { composerRef, pickSuggestion };
}
