"use client";

import { memo } from "react";

import type { StreamingContentBlock } from "@/lib/streaming-markdown-blocks";
import { ProgressiveMarkdownBlock } from "./message-bubble";

function stripListMarker(source: string): string {
  return source.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "");
}

const StreamingBlock = memo(function StreamingBlock({
  block,
  live,
}: {
  block: StreamingContentBlock;
  live: boolean;
}) {
  if (block.kind === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List data-stream-block-id={block.id}>
        {block.committedItems.map((item) => (
          <li key={item.id} data-stream-list-item-id={item.id}>
            <ProgressiveMarkdownBlock
              text={stripListMarker(item.source)}
              pending={false}
              showCaret={false}
            />
          </li>
        ))}
        {block.activeItem ? (
          <li key={block.activeItem.id} data-stream-list-item-id={block.activeItem.id}>
            <ProgressiveMarkdownBlock
              text={stripListMarker(block.activeItem.source)}
              pending={live}
              showCaret={false}
            />
            {live ? (
              <span
                aria-hidden={true}
                data-stream-caret={true}
                className="streaming-turn-caret"
              />
            ) : null}
          </li>
        ) : null}
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
});

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
