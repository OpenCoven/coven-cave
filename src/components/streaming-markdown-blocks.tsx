"use client";

import { memo } from "react";

import type { StreamingContentBlock } from "@/lib/streaming-markdown-blocks";
import { ProgressiveMarkdownBlock } from "./message-bubble";

function stripListMarker(source: string): string {
  return source.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "");
}

function parseStreamingListItem(source: string, active: boolean) {
  const text = active ? stripListMarker(source) : stripListMarker(source).trimEnd();
  const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(text);
  if (!task) return { text, task: null };
  return {
    text: text.slice(task[0].length),
    task: { checked: task[1].toLowerCase() === "x" },
  };
}

type StreamingBlockProps = {
  block: StreamingContentBlock;
  live: boolean;
};

function sameListItem(
  left: { id: string; source: string } | undefined,
  right: { id: string; source: string } | undefined,
): boolean {
  return left?.id === right?.id && left?.source === right?.source;
}

function streamingBlockPropsEqual(
  previous: StreamingBlockProps,
  next: StreamingBlockProps,
): boolean {
  if (previous.live !== next.live) return false;
  const left = previous.block;
  const right = next.block;
  if (left.id !== right.id || left.kind !== right.kind || left.source !== right.source) {
    return false;
  }
  if (left.kind === "markdown") {
    return right.kind === "markdown" && left.renderMode === right.renderMode;
  }
  if (right.kind === "markdown") return false;
  return (
    left.ordered === right.ordered
    && left.committedItems.length === right.committedItems.length
    && left.committedItems.every((item, index) =>
      sameListItem(item, right.committedItems[index]))
    && sameListItem(left.activeItem, right.activeItem)
  );
}

const StreamingBlock = memo(function StreamingBlock({
  block,
  live,
}: StreamingBlockProps) {
  if (block.kind === "list") {
    const List = block.ordered ? "ol" : "ul";
    const items = block.activeItem
      ? [...block.committedItems, block.activeItem]
      : block.committedItems;
    return (
      <List data-stream-block-id={block.id}>
        {items.map((item) => {
          const active = item.id === block.activeItem?.id;
          const renderedItem = parseStreamingListItem(item.source, active);
          const taskLabel = renderedItem.task
            ? `${renderedItem.task.checked ? "Completed" : "Incomplete"} task${
              renderedItem.text.trim() ? `: ${renderedItem.text.trim()}` : ""
            }`
            : undefined;
          return (
            <li
              key={item.id}
              data-stream-list-item-id={item.id}
              className={renderedItem.task ? "task-list-item" : undefined}
            >
              {renderedItem.task ? (
                <input
                  type="checkbox"
                  checked={renderedItem.task.checked}
                  disabled
                  aria-label={taskLabel}
                />
              ) : null}
              <ProgressiveMarkdownBlock
                text={renderedItem.text}
                pending={active && live}
                showCaret={false}
              />
              {active && live ? (
                <span
                  aria-hidden={true}
                  data-stream-caret={true}
                  className="streaming-turn-caret"
                />
              ) : null}
            </li>
          );
        })}
      </List>
    );
  }

  if (live && block.renderMode === "plain") {
    return (
      <div
        data-stream-block-id={block.id}
        className="streaming-markdown-active-plain whitespace-pre-wrap"
      >
        {block.source}
        <span
          aria-hidden={true}
          data-stream-caret={true}
          className="streaming-turn-caret"
        />
      </div>
    );
  }

  return (
    <div data-stream-block-id={block.id}>
      <ProgressiveMarkdownBlock text={block.source} pending={live} showCaret={false} />
      {live ? (
        <span
          aria-hidden={true}
          data-stream-caret={true}
          className="streaming-turn-caret"
        />
      ) : null}
    </div>
  );
}, streamingBlockPropsEqual);

export function StreamingMarkdownBlocks({
  committedBlocks,
  activeBlock,
  live,
}: {
  committedBlocks: StreamingContentBlock[];
  activeBlock: StreamingContentBlock | null;
  live: boolean;
}) {
  const blocks = activeBlock ? [...committedBlocks, activeBlock] : committedBlocks;

  return (
    <div className="streaming-markdown-blocks">
      {blocks.map((block) => (
        <StreamingBlock
          key={block.id}
          block={block}
          live={live && block.id === activeBlock?.id}
        />
      ))}
    </div>
  );
}
