import { useEffect, useRef, useState } from "react";
import { MarkdownBlock } from "@/components/message-bubble";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { copyText } from "@/lib/clipboard";
import { Icon, type IconName } from "@/lib/icon";
import { extractNextPaths } from "@/lib/next-paths";
import type { Familiar } from "@/lib/types";
import { useStickToBottom } from "@/lib/use-stick-to-bottom";
import type { QuickChatMessage } from "@/lib/use-quick-chat";
import { FamiliarMark, QUICK_CHAT_SUGGESTIONS } from "./quick-chat-primitives";
import { lastRegenerableQuickChatMessageId } from "@/lib/quick-chat-thread-state";

function QuickChatBubble({
  message,
  familiar,
  isLastAssistant,
  onRegenerate,
  onSuggestion,
}: {
  message: QuickChatMessage;
  familiar: Familiar | null;
  isLastAssistant: boolean;
  onRegenerate?: () => void;
  onSuggestion?: (value: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const { visible, suggestions } =
    message.role === "assistant"
      ? extractNextPaths(message.text)
      : { visible: message.text, suggestions: [] };

  if (message.role === "user") {
    return (
      <div className="quick-chat-turn quick-chat-turn--user">
        <div className="quick-chat-bubble quick-chat-bubble--user">
          {message.text ? <p className="whitespace-pre-wrap break-words leading-6">{message.text}</p> : null}
          {message.attachments?.length ? (
            <p className="quick-chat-bubble__files" title={message.attachments.map((a) => a.name).join(", ")}>
              <Icon name="ph:paperclip" width={11} aria-hidden />
              {message.attachments.map((a) => a.name).join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const streaming = message.pending;
  const canAct = !streaming && visible.length > 0;
  return (
    <div className="quick-chat-turn quick-chat-turn--familiar">
      {familiar ? <FamiliarMark familiar={familiar} size="sm" /> : (
        <span className="grid h-5 w-5 place-items-center rounded-[var(--radius-control)] bg-[var(--bg-elevated)]">
          <Icon name="ph:sparkle" width={12} aria-hidden />
        </span>
      )}
      <div className="quick-chat-bubble quick-chat-bubble--familiar">
        {visible ? (
          streaming ? <p className="whitespace-pre-wrap break-words leading-6">{visible}<span className="quick-chat-caret" aria-hidden /></p> : (
            <div className="quick-chat-md"><MarkdownBlock text={visible} /></div>
          )
        ) : streaming ? (
          <span className="quick-chat-typing" aria-label="Thinking…"><i /><i /><i /></span>
        ) : <p className="text-[var(--fg-muted)]">No response.</p>}

        {message.error ? <p className="quick-chat-turn__error">{message.error}</p> : null}

        {canAct ? (
          <div className="quick-chat-turn__actions">
            <IconButton
              icon={copied ? "ph:check" : "ph:copy"}
              size="xs"
              aria-label={copied ? "Copied" : "Copy reply"}
              title="Copy reply"
              onClick={() => { void copyText(visible).then((ok) => { if (ok) setCopied(true); }); }}
            />
            {isLastAssistant && onRegenerate ? <IconButton icon="ph:arrow-clockwise" size="xs" aria-label="Regenerate reply" title="Regenerate" onClick={onRegenerate} /> : null}
          </div>
        ) : null}

        {isLastAssistant && !streaming && onSuggestion && suggestions.length > 0 ? (
          <div className="quick-chat-next-paths" role="group" aria-label="Suggested next steps">
            {suggestions.map((suggestion, i) => <Button key={i} size="xs" variant="secondary" className="quick-chat-next-path" onClick={() => onSuggestion(suggestion)}>{suggestion}</Button>)}
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
  const { schedulePin, stick } = useStickToBottom(scrollRef);
  const lastText = messages.length > 0 ? messages[messages.length - 1].text : "";

  useEffect(() => { stick(); }, [messages.length, stick]);
  useEffect(() => { schedulePin(); }, [messages.length, lastText, schedulePin]);

  const lastAssistantId = lastRegenerableQuickChatMessageId(messages);

  return (
    <div ref={scrollRef} className="quick-chat-thread" aria-live="polite">
      {messages.length === 0 ? (
        <div className="quick-chat-empty">
          <span className="quick-chat-empty__glyph" aria-hidden><Icon name={emptyIcon} width={22} /></span>
          <p className="quick-chat-empty__title">{emptyTitle}</p>
          <p className="quick-chat-empty__hint">{emptyHint}</p>
          {suggestions.length > 0 ? <div className="quick-chat-empty__chips">
            {suggestions.map((suggestion) => <Button key={suggestion} size="xs" variant="secondary" className="quick-chat-chip" onClick={() => onSuggestion?.(suggestion)}>{suggestion}</Button>)}
          </div> : null}
        </div>
      ) : messages.map((message) => (
        <QuickChatBubble key={message.id} message={message} familiar={familiar} isLastAssistant={message.id === lastAssistantId} onRegenerate={onRegenerate} onSuggestion={onSuggestion} />
      ))}
    </div>
  );
}
