"use client";

import type { ReactNode } from "react";
import type { ChatTimelineEntry } from "@/lib/chat-activity-timeline";
import type { ToolEvent } from "@/lib/chat-turn-state";
import type { ChatReasoningBlock } from "@/lib/chat-reasoning-blocks";

/** Activity rows never move into a different keyed group on completion. The
 * caller keeps ownership of Markdown, rich cards and authenticated tool UI. */
export function ChatTurnTimeline({ entries, renderText, renderTool, renderReasoning }: {
  entries: readonly ChatTimelineEntry[];
  renderText: (text: string, key: string, trailing: boolean) => ReactNode;
  renderTool: (tool: ToolEvent) => ReactNode;
  renderReasoning: (block: ChatReasoningBlock) => ReactNode;
}) {
  return <div data-chat-activity-timeline={true}>
    {entries.map((entry, index) => <div key={entry.key} data-timeline-key={entry.key}
      data-timeline-kind={entry.kind} className={entry.kind === "text" ? "streaming-turn-prose" : "my-2 min-w-0"}>
      {entry.kind === "text" ? renderText(entry.text, entry.key, index === entries.length - 1) : entry.kind === "tool" ? renderTool(entry.tool) : renderReasoning(entry.block)}
    </div>)}
  </div>;
}
