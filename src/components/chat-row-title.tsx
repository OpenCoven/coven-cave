import { chatTitleParts } from "@/lib/chat-title-parts";
import "@/styles/chat-row-title.css";

export function ChatRowTitle({ title, className = "" }: { title: string; className?: string }) {
  const { head, tail } = chatTitleParts(title);
  return (
    <span className={`chat-row-title ${className}`} title={title}>
      <span className="sr-only">{title}</span>
      <span className="chat-row-title__head" aria-hidden="true">{head}</span>
      <span className="chat-row-title__tail" aria-hidden="true"><span>{tail}</span></span>
    </span>
  );
}
