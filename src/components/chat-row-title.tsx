import { chatTitleParts } from "@/lib/chat-title-parts";
import "@/styles/chat-row-title.css";

export function ChatRowTitle({ title, displayTitle = title, className = "" }: { title: string; displayTitle?: string; className?: string }) {
  // A compact rail can show PR/branch context on its own line while retaining
  // the complete contextual title for assistive technology and hover.
  const { head, tail } = chatTitleParts(displayTitle);
  return (
    <span className={`chat-row-title ${className}`} title={title}>
      <span className="sr-only">{title}</span>
      <span className="chat-row-title__head" aria-hidden="true">{head}</span>
      <span className="chat-row-title__tail" aria-hidden="true"><span>{tail}</span></span>
    </span>
  );
}
