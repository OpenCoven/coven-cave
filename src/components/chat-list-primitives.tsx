import type { CSSProperties, ReactNode } from "react";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { Icon } from "@/lib/icon";

export function HighlightedSnippet({ snippet, query }: { snippet: string; query: string }) {
  const idx = query ? snippet.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx < 0) return <>{snippet}</>;
  return (
    <>
      {snippet.slice(0, idx)}
      <mark className="rounded-[var(--radius-control)] bg-[color-mix(in_oklch,var(--accent-presence)_28%,transparent)] px-0.5 text-[var(--text-primary)]">
        {snippet.slice(idx, idx + query.length)}
      </mark>
      {snippet.slice(idx + query.length)}
    </>
  );
}

type SortableHandleProps = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  isDragging: boolean;
};

export function SortableChatListItem({ id, children }: { id: string; children: (handleProps: SortableHandleProps) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return <li ref={setNodeRef} style={style} data-dragging={isDragging ? "true" : undefined} className="chat-list-sortable-row">{children({ attributes, listeners, isDragging })}</li>;
}

export function ChatListSection({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const inner = <>
    {onToggle ? <Icon name={collapsed ? "ph:caret-right" : "ph:caret-down"} width={11} className="shrink-0 text-[var(--text-muted)]" aria-hidden /> : null}
    <span className="truncate text-[length:var(--text-sm)] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)]">{label}</span>
    {typeof count === "number" ? <span className="font-mono text-[length:var(--text-sm)] text-[var(--text-secondary)] opacity-80">{count}</span> : null}
  </>;
  if (onToggle) return <li className="border-b border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)]"><button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`} className="focus-ring flex w-full items-center gap-1.5 px-4 py-2 text-left hover:bg-[var(--bg-raised)]/40">{inner}</button></li>;
  return <li className="flex items-center gap-1.5 border-b border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)] px-4 py-2">{inner}</li>;
}

