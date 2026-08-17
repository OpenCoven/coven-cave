import { useEffect, useRef, useState } from "react";
import { GitHubActionCard } from "@/components/github-action-card";
import { GitHubCard } from "@/components/github-card";
import { ProgressiveMarkdownBlock } from "@/components/message-bubble";
import { SkillStageCard } from "@/components/skill-stage-card";
import { StreamingTurnResponse } from "@/components/streaming-turn-response";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { shouldUseEmptySuccessfulFallback } from "@/lib/chat-assistant-output";
import { copyText } from "@/lib/clipboard";
import { Icon, type IconName } from "@/lib/icon";
import { formatQuickChatAssistantMessage } from "@/lib/quick-chat-message-format";
import { createStreamingTurnViewModel } from "@/lib/streaming-turn-view-model";
import type { Familiar } from "@/lib/types";
import { useStreamingPresentationSource } from "@/lib/use-streaming-presentation-source";
import { useStickToBottom } from "@/lib/use-stick-to-bottom";
import type { QuickChatMessage } from "@/lib/use-quick-chat";
import { FamiliarMark, QUICK_CHAT_SUGGESTIONS } from "./quick-chat-primitives";
import { lastRegenerableQuickChatMessageId } from "@/lib/quick-chat-thread-state";

function quickChatResponseMetadataLines(
  metadata?: QuickChatMessage["responseMetadata"],
): string[] {
  if (!metadata) return [];
  const lines: string[] = [];
  if (metadata.requestedModel !== undefined) {
    lines.push(`Requested model: ${metadata.requestedModel || "Runtime default"}`);
  }
  if (metadata.desiredModel) lines.push(`Effective model: ${metadata.desiredModel}`);
  if (metadata.forwardedModel && metadata.forwardedModel !== metadata.desiredModel) {
    lines.push(`Forwarded model: ${metadata.forwardedModel}`);
  }
  if (metadata.confirmedModel) lines.push(`Applied model: ${metadata.confirmedModel}`);
  else if (metadata.modelApplicationState) lines.push(`Model: ${metadata.modelApplicationState}`);
  if (metadata.modelSource) lines.push(`Source: ${metadata.modelSource}`);
  if (metadata.modelApplicationReason && !metadata.confirmedModel) {
    lines.push(metadata.modelApplicationReason);
  }
  const promptOnly = new Set(Object.keys(metadata.promptGuidanceControls ?? {}));
  const forwarded = new Set(Object.keys(metadata.forwardedControls ?? {}));
  const applied = new Set(Object.keys(metadata.appliedControls ?? {}));
  const rejected = new Set(metadata.rejectedControlFamilies ?? []);
  for (const [family, value] of Object.entries(metadata.requestedControls ?? {})) {
    const status = rejected.has(family)
      ? "Rejected"
      : promptOnly.has(family)
        ? "Prompt guidance"
        : applied.has(family)
          ? "Applied"
          : forwarded.has(family)
            ? "Forwarded — not confirmed"
            : "Requested — not confirmed";
    lines.push(`${status}: ${family} ${value}`);
  }
  return lines;
}

function QuickChatResponseMetadata({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div
      className="mt-2 flex flex-wrap gap-1.5"
      role="group"
      aria-label={`Response model and controls: ${lines.join(". ")}`}
    >
      {lines.map((line) => (
        <span
          key={line}
          className="rounded-[var(--radius-pill)] border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[length:var(--text-2xs)] text-[var(--fg-muted)]"
        >
          {line}
        </span>
      ))}
    </div>
  );
}

function QuickChatBubble({
  message,
  familiar,
  isLastAssistant,
  onRegenerate,
  onSuggestion,
  onStop,
}: {
  message: QuickChatMessage;
  familiar: Familiar | null;
  isLastAssistant: boolean;
  onRegenerate?: () => void;
  onSuggestion?: (value: string) => void;
  onStop?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const streaming = message.role === "assistant" && Boolean(message.pending);
  const formatted = formatQuickChatAssistantMessage(
    message.role === "assistant" ? message.text : "",
    streaming,
  );
  const presentedVisible = useStreamingPresentationSource(
    formatted.visibleProse,
    streaming,
  );

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

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

  const {
    copyText: visible,
    pieces,
    skillUpdates,
    authoredResults,
    suggestions: typedSuggestions,
  } = formatted;
  // Quick chat is intentionally a compact reply-only surface. Task and action
  // intents stay hidden because this tray cannot review or execute them.
  const suggestions = typedSuggestions
    .filter((path) => path.kind === "reply")
    .map((path) => path.prompt);
  const responseMetadataLines = quickChatResponseMetadataLines(message.responseMetadata);
  const streamingModel = createStreamingTurnViewModel({
    turnId: message.id,
    visibleText: presentedVisible,
    pending: streaming,
    lifecycle: message.lifecycle,
    failed: Boolean(message.error),
    authoredResults,
  });
  const canAct = !streaming && visible.length > 0;
  const showEmptySuccessfulFallback = shouldUseEmptySuccessfulFallback({
    emptySuccessful: streamingModel.emptySuccessful,
    visibleProse: visible,
    hasRichBlocks:
      pieces.some((piece) => piece.kind !== "text"),
    resultCount: streamingModel.results.length,
    skillUpdateCount: skillUpdates.length,
    followUpCount: suggestions.length,
  });
  const orderedProseContent =
    !streaming && pieces.some((piece) => piece.kind !== "text") ? (
      <div className="quick-chat-md">
        {pieces.map((piece, index) => {
          if (piece.kind === "text") {
            return (
              <ProgressiveMarkdownBlock
                key={`prose-${index}`}
                text={piece.text}
              />
            );
          }
          if (piece.kind === "action") {
            return (
              <div key={`action-${index}`} className="my-2">
                <GitHubActionCard action={piece.action} />
              </div>
            );
          }
          return (
            <div key={`card-${index}`} className="my-2">
              <GitHubCard descriptor={piece.descriptor} />
            </div>
          );
        })}
      </div>
    ) : undefined;
  const quickChatSupplementaryContent = (
    <div data-quick-chat-supplementary-content={true}>
      {skillUpdates.length ? (
        <div className="mt-2 space-y-2">
          {skillUpdates.map((update) => (
            <SkillStageCard
              key={update.name}
              name={update.name}
              stage={update.stage}
              note={update.note}
            />
          ))}
        </div>
      ) : null}

      {message.error ? <p className="quick-chat-turn__error">{message.error}</p> : null}

      <QuickChatResponseMetadata lines={responseMetadataLines} />

      {canAct ? (
        <div className="quick-chat-turn__actions">
          <IconButton
            icon={copied ? "ph:check" : "ph:copy"}
            size="xs"
            aria-label={copied ? "Copied" : "Copy reply"}
            title="Copy reply"
            onClick={() => { void copyText(visible).then((ok) => { if (ok) setCopied(true); }); }}
          />
          {isLastAssistant && onRegenerate && !message.error ? (
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

      {isLastAssistant && !streaming && onSuggestion && suggestions.length > 0 ? (
        <div className="quick-chat-next-paths" role="group" aria-label="Suggested next steps">
          {suggestions.map((suggestion, i) => <Button key={i} size="xs" variant="secondary" className="quick-chat-next-path" onClick={() => onSuggestion(suggestion)}>{suggestion}</Button>)}
        </div>
      ) : null}
    </div>
  );
  return (
    <div className="quick-chat-turn quick-chat-turn--familiar">
      {familiar ? <FamiliarMark familiar={familiar} size="sm" /> : (
        <span className="grid h-5 w-5 place-items-center rounded-[var(--radius-control)] bg-[var(--bg-elevated)]">
          <Icon name="ph:sparkle" width={12} aria-hidden />
        </span>
      )}
      <div className="quick-chat-bubble quick-chat-bubble--familiar">
        {showEmptySuccessfulFallback ? (
          <>
            <div className="quick-chat-turn__error" role="alert">
              <span>No response.</span>
              {isLastAssistant && onRegenerate ? (
                <Button size="xs" variant="ghost" className="focus-ring" onClick={onRegenerate}>
                  Retry
                </Button>
              ) : null}
            </div>
            {quickChatSupplementaryContent}
          </>
        ) : (
          <StreamingTurnResponse
            turnId={message.id}
            familiarName={familiar?.display_name ?? "Unknown familiar"}
            model={streamingModel}
            density="compact"
            proseContent={orderedProseContent}
            onStop={streaming ? onStop : undefined}
            onRetry={message.error && isLastAssistant ? onRegenerate : undefined}
            canContinue={false}
            onCopyCompleted={
              streamingModel.committedText
                ? () => { void copyText(streamingModel.committedText); }
                : undefined
            }
            supplementaryContent={quickChatSupplementaryContent}
          />
        )}
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
  onStop,
}: {
  messages: QuickChatMessage[];
  familiar: Familiar | null;
  emptyIcon?: IconName;
  emptyTitle?: string;
  emptyHint?: string;
  suggestions?: string[];
  onSuggestion?: (value: string) => void;
  onRegenerate?: () => void;
  onStop?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { schedulePin, stick } = useStickToBottom(scrollRef);
  const lastText = messages.length > 0 ? messages[messages.length - 1].text : "";

  useEffect(() => { stick(); }, [messages.length, stick]);
  useEffect(() => { schedulePin(); }, [messages.length, lastText, schedulePin]);

  const lastAssistantId = lastRegenerableQuickChatMessageId(messages);

  return (
    <div ref={scrollRef} className="quick-chat-thread">
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
        <QuickChatBubble
          key={message.id}
          message={message}
          familiar={familiar}
          isLastAssistant={message.id === lastAssistantId}
          onRegenerate={onRegenerate}
          onSuggestion={onSuggestion}
          onStop={onStop}
        />
      ))}
    </div>
  );
}
