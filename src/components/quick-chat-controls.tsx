"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import { StandardSelect, type StandardSelectOption } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { MarkdownBlock } from "@/components/message-bubble";
import { copyText } from "@/lib/clipboard";
import type { QuickChatMessage } from "@/lib/use-quick-chat";

export type QuickChatSelectOption<T extends string> = StandardSelectOption<T>;

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
  const [copied, setCopied] = useState<string | null>(null);

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
              icon={copied === message.id ? "ph:check" : "ph:copy"}
              size="xs"
              aria-label={copied === message.id ? "Copied" : "Copy reply"}
              title="Copy reply"
              onClick={() => {
                void copyText(message.text).then((ok) => {
                  if (ok) setCopied(message.id);
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
  emptyTitle,
  emptyHint,
  suggestions,
  onSuggestion,
  onRegenerate,
}: {
  messages: QuickChatMessage[];
  familiar: Familiar | null;
  emptyIcon?: IconName;
  emptyTitle: string;
  emptyHint: string;
  suggestions?: string[];
  onSuggestion?: (value: string) => void;
  onRegenerate?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastText = messages.length > 0 ? messages[messages.length - 1].text : "";

  // Keep the newest turn in view as it streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastText]);

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
          {suggestions && suggestions.length > 0 ? (
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
