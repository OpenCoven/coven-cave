import type { ReactNode } from "react";
import { CovenWikiReader } from "@/components/covenwiki-reader";
import { MarkdownBlock, MessageBubble } from "@/components/message-bubble";
import { modalWikiManifest } from "./modal-wiki-data";
import "@/styles/cave-md.css";

const table = "| Dependency | Owner | Status | Next action | Evidence |\n| --- | --- | --- | --- | --- |\n" + Array.from({ length: 24 }, (_, index) => `| Review ${index + 1} | Human reviewer | Approval required | Preserve authored decisions before dispatch | Synthetic source evidence for dependency ${index + 1} |`).join("\n");
const diagram = "```mermaid\nflowchart LR\n  A[Review plan] --> B[Owner decision] --> C[Record next step]\n```";

export function modalMarkdownFixtures(): Record<string, ReactNode> {
  return {
    "wiki-source": <CovenWikiReader manifest={modalWikiManifest} slug="review" />,
    "markdown-table": <MarkdownBlock text={table} />,
    "markdown-diagram": <MarkdownBlock text={diagram} />,
    "markdown-chat-table": <MessageBubble role="assistant" content={table} collapsible={false} hideCopyAction />,
    "markdown-chat-diagram": <MessageBubble role="assistant" content={diagram} collapsible={false} hideCopyAction />,
  };
}
