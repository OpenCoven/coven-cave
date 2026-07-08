"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "@/lib/command-controls";
import { Icon, type IconName } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import { StandardSelect, type StandardSelectOption } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { MarkdownBlock } from "@/components/message-bubble";
import { copyText } from "@/lib/clipboard";
import type { QuickChatMessage } from "@/lib/use-quick-chat";
import { useStickToBottom } from "@/lib/use-stick-to-bottom";

export type QuickChatSelectOption<T extends string> = StandardSelectOption<T>;

// One-tap starters for a cold thread — they fill the composer, not send.
export const QUICK_CHAT_SUGGESTIONS = [
  "Summarize what needs my attention",
  "Draft a short status update",
  "What changed recently?",
];

function initials(familiar: Familiar): string {
  return (familiar.display_name || familiar.id)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function FamiliarMark({ familiar, size = "sm" }: { familiar: Familiar; size?: "sm" | "md" }) {
  const sizeClass = size === "md" ? "h-6 w-6 text-[10px]" : "h-5 w-5 text-[9px]";
  return familiar.avatarUrl ? (
    <img src={familiar.avatarUrl} alt="" className={`${sizeClass} rounded-[var(--radius-control)] object-cover`} />
  ) : (
    <span className={`grid ${sizeClass} place-items-center rounded-[var(--radius-control)] bg-[var(--bg-elevated)] font-semibold text-[var(--fg-primary)]`}>
      {initials(familiar)}
    </span>
  );
}

// ── Header identity ──────────────────────────────────────────────────────────
// The avatar + name + handle block both quick-chat surfaces open with.

export function QuickChatIdentity({
  familiar,
  loading,
  as: Heading = "h2",
}: {
  familiar: Familiar | null;
  loading: boolean;
  /** Heading level — the tray window is a full page (h1), the overlay a dialog (h2). */
  as?: "h1" | "h2";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {familiar ? (
        <FamiliarMark familiar={familiar} size="md" />
      ) : (
        <Icon name="ph:chat-circle-dots" width={20} aria-hidden />
      )}
      <div className="min-w-0">
        <Heading className="truncate text-sm font-semibold">
          {familiar ? familiar.display_name : "Quick chat"}
        </Heading>
        <p className="truncate text-xs text-[var(--fg-muted)]">
          {/* While the roster loads, say so — "No familiar selected" reads
              as an error/empty state when it's really just cold. */}
          {loading ? "Loading familiars…" : familiar ? `@${familiar.id}` : "No familiar selected"}
        </p>
      </div>
    </div>
  );
}

export function QuickChatSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: T;
  options: QuickChatSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <StandardSelect
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      showCaret={false}
      className={[
        "quick-chat-select__trigger min-w-0 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 text-left text-xs outline-none disabled:cursor-not-allowed disabled:opacity-55",
        className ?? "",
      ].filter(Boolean).join(" ")}
      renderValue={(selected) => (
        <>
          <span className="flex min-w-0 items-center gap-2">
            {selected?.leading ?? (selected?.icon ? <Icon name={selected.icon} width={13} aria-hidden className="shrink-0 text-[var(--fg-muted)]" /> : null)}
            <span className="min-w-0 truncate">{selected?.label ?? label}</span>
          </span>
          <Icon name="ph:caret-down" width={13} aria-hidden className="shrink-0 text-[var(--fg-muted)]" />
        </>
      )}
    />
  );
}

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
  thinkingEffort,
  onThinkingEffortChange,
  responseSpeed,
  onResponseSpeedChange,
  sending,
}: {
  loading: boolean;
  familiars: Familiar[];
  selectedFamiliarId: string | null;
  onPickFamiliar: (id: string | null) => void;
  thinkingEffort: CommandThinkingEffort;
  onThinkingEffortChange: (value: CommandThinkingEffort) => void;
  responseSpeed: CommandResponseSpeed;
  onResponseSpeedChange: (value: CommandResponseSpeed) => void;
  sending: boolean;
}) {
  return (
    <div className="quick-chat-overlay__controls">
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

// ── Composer ─────────────────────────────────────────────────────────────────
// Error slot + textarea + actions row, shared by both surfaces. Enter sends;
// Shift+Enter inserts a newline; ⌘/Ctrl+Enter always sends; IME composition is
// left alone.

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
}: {
  error: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
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
}) {
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const cmdEnter = (event.metaKey || event.ctrlKey) && event.key === "Enter";
      const plainEnter =
        event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;
      if (cmdEnter || plainEnter) {
        event.preventDefault();
        if (!sending && draft.trim()) onSend();
      }
    },
    [draft, onSend, sending],
  );

  return (
    <footer className="quick-chat-overlay__composer">
      {error ? (
        <p className="quick-chat-overlay__error" role="alert">
          {error}
        </p>
      ) : null}
      <textarea
        ref={composerRef}
        id={inputId}
        value={draft}
        autoFocus={autoFocus}
        aria-label="Message"
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={familiar ? `Message @${familiar.id}…` : "@sage summarize what needs attention"}
        className="quick-chat-overlay__input"
      />
      <div className="quick-chat-overlay__actions">
        {leading}
        <div className="flex items-center gap-2">
          {sending ? (
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Stop
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            leadingIcon="ph:sparkle"
            onClick={onSend}
            disabled={sending || disabled || !draft.trim()}
          >
            Send
          </Button>
        </div>
      </div>
    </footer>
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

// ── Conversation thread ──────────────────────────────────────────────────────
// Shared between the in-app dropdown and the Tauri standalone window so the two
// render identical turns. Owns its own scroll container + auto-scroll and marks
// it as a polite live region so streamed replies are announced.

function QuickChatBubble({
  message,
  familiar,
  isLastAssistant,
  onRegenerate,
}: {
  message: QuickChatMessage;
  familiar: Familiar | null;
  isLastAssistant: boolean;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Show the ✓ for a beat, then hand the button back to "copy".
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (message.role === "user") {
    return (
      <div className="quick-chat-turn quick-chat-turn--user">
        <div className="quick-chat-bubble quick-chat-bubble--user">
          <p className="whitespace-pre-wrap break-words leading-6">{message.text}</p>
        </div>
      </div>
    );
  }

  const streaming = message.pending;
  const canAct = !streaming && message.text.length > 0;
  return (
    <div className="quick-chat-turn quick-chat-turn--familiar">
      {familiar ? (
        <FamiliarMark familiar={familiar} size="sm" />
      ) : (
        <span className="grid h-5 w-5 place-items-center rounded-[var(--radius-control)] bg-[var(--bg-elevated)]">
          <Icon name="ph:sparkle" width={12} aria-hidden />
        </span>
      )}
      <div className="quick-chat-bubble quick-chat-bubble--familiar">
        {message.text ? (
          streaming ? (
            // Render partial text plainly while it streams — re-parsing markdown
            // per token is wasteful and flashes half-open code fences.
            <p className="whitespace-pre-wrap break-words leading-6">
              {message.text}
              <span className="quick-chat-caret" aria-hidden />
            </p>
          ) : (
            <div className="quick-chat-md">
              <MarkdownBlock text={message.text} />
            </div>
          )
        ) : streaming ? (
          <span className="quick-chat-typing" aria-label="Thinking…">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <p className="text-[var(--fg-muted)]">No response.</p>
        )}

        {message.error ? (
          <p className="quick-chat-turn__error">{message.error}</p>
        ) : null}

        {canAct ? (
          <div className="quick-chat-turn__actions">
            <IconButton
              icon={copied ? "ph:check" : "ph:copy"}
              size="xs"
              aria-label={copied ? "Copied" : "Copy reply"}
              title="Copy reply"
              onClick={() => {
                void copyText(message.text).then((ok) => {
                  if (ok) setCopied(true);
                });
              }}
            />
            {isLastAssistant && onRegenerate ? (
              <IconButton
                icon="ph:arrow-clockwise"
                size="xs"
                aria-label="Regenerate reply"
                title="Regenerate"
                onClick={onRegenerate}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function QuickChatThread({
  messages,
  familiar,
  emptyIcon = "ph:chat-circle-dots",
  emptyTitle = familiar ? `Ask ${familiar.display_name} anything` : "Ask a familiar anything",
  emptyHint = "Replies stream right here · @name to switch familiar · Enter to send",
  suggestions = QUICK_CHAT_SUGGESTIONS,
  onSuggestion,
  onRegenerate,
}: {
  messages: QuickChatMessage[];
  familiar: Familiar | null;
  emptyIcon?: IconName;
  emptyTitle?: string;
  emptyHint?: string;
  suggestions?: string[];
  onSuggestion?: (value: string) => void;
  onRegenerate?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow the stream with intent-based release (cave-o8si): scrolling up
  // detaches, returning to the true bottom re-attaches. The old 48px position
  // threshold re-stuck a reader pausing near the bottom, so the next streamed
  // token yanked them back down.
  const { schedulePin, stick } = useStickToBottom(scrollRef);
  const lastText = messages.length > 0 ? messages[messages.length - 1].text : "";

  // A new turn (sending / a reply starting) re-engages follow-along; on mount
  // this doubles as the initial snap to the latest turn.
  useEffect(() => {
    stick();
  }, [messages.length, stick]);

  // Keep the newest turn in view as it streams.
  useEffect(() => {
    schedulePin();
  }, [messages.length, lastText, schedulePin]);

  const lastAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  })();

  return (
    <div ref={scrollRef} className="quick-chat-thread" aria-live="polite">
      {messages.length === 0 ? (
        <div className="quick-chat-empty">
          <span className="quick-chat-empty__glyph" aria-hidden>
            <Icon name={emptyIcon} width={22} />
          </span>
          <p className="quick-chat-empty__title">{emptyTitle}</p>
          <p className="quick-chat-empty__hint">{emptyHint}</p>
          {suggestions.length > 0 ? (
            <div className="quick-chat-empty__chips">
              {suggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  size="xs"
                  variant="secondary"
                  className="quick-chat-chip"
                  onClick={() => onSuggestion?.(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        messages.map((message) => (
          <QuickChatBubble
            key={message.id}
            message={message}
            familiar={familiar}
            isLastAssistant={message.id === lastAssistantId}
            onRegenerate={onRegenerate}
          />
        ))
      )}
    </div>
  );
}
