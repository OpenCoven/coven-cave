"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import type { PreviewBlock } from "@/lib/preview-blocks";

export function ChatPreviewCard({
  preview,
  onOpenPreview,
  onOpenUrl,
}: {
  preview: PreviewBlock;
  onOpenPreview?: (url: string) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const open = onOpenPreview ?? onOpenUrl;
  const displayUrl = new URL(preview.url);
  return (
    <section className="my-3 flex min-w-0 items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-raised)] p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]" aria-hidden>
        <Icon name="ph:globe" width={16} />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {preview.title}
        </strong>
        <span className="block truncate font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">
          {displayUrl.host}{displayUrl.pathname === "/" ? "" : displayUrl.pathname}
        </span>
      </span>
      <Button
        size="xs"
        variant="secondary"
        leadingIcon="ph:sidebar-simple"
        disabled={!open}
        onClick={() => open?.(preview.url)}
      >
        {onOpenPreview ? "Open beside chat" : "Open preview"}
      </Button>
    </section>
  );
}
