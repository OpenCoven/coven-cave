"use client";

import { forwardRef } from "react";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import type { Familiar, SessionRow } from "@/lib/types";

// ---------------------------------------------------------------------------
// FamiliarStrip — 28px avatar circles at the top of the AgentPanel.
// Active familiar gets a Mood C violet ring. Badge text (QUEEN/RESEARCH/etc.)
// appears as a native title tooltip on hover.
// ---------------------------------------------------------------------------

function FamiliarStrip({
  familiars,
  activeId,
  onSelect,
}: {
  familiars: Familiar[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const overrides = useGlyphOverrides();

  if (familiars.length === 0) return null;

  return (
    <div className="familiar-strip">
      {familiars.map((f) => {
        const glyph = resolveFamiliarGlyph(f, overrides);
        const isActive = f.id === activeId;
        return (
            type="button"
            title={`${f.display_name}${f.role ? ` · ${f.role}` : ""}`}
            aria-label={f.display_name}
            aria-pressed={isActive}
            onClick={() => onSelect(f.id)}
            className={`familiar-strip-avatar${isActive ? " familiar-strip-avatar--active" : ""}`}
          >
            <FamiliarGlyph glyph={glyph} size="sm" />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentPanel
// ---------------------------------------------------------------------------

type Props = {
  familiar: Familiar | null;
  familiars: Familiar[];
  activeId: string | null;
  sessions: SessionRow[];
  daemonRunning: boolean;
  onSessionStarted: () => void;
  onSlashFromChat: (command: string, args: string) => boolean;
  onOpenOnboarding: () => void;
  onFamiliarSelect: (id: string) => void;
};

export const AgentPanel = forwardRef<ChatRouterHandle, Props>(function AgentPanel(
  props,
  ref,
) {
  const {
    familiar,
    familiars,
    activeId,
    onFamiliarSelect,
    onOpenOnboarding,
    sessions,
    daemonRunning,
    onSessionStarted,
    onSlashFromChat,
  } = props;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Familiar avatar strip — always rendered when familiars exist */}
      <FamiliarStrip
        familiars={familiars}
        activeId={activeId}
        onSelect={(id) => {
          onFamiliarSelect(id);
        }}
      />

      {/* Chat area */}
      {!familiar ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-[12px] text-[var(--text-muted)]">
          <p className="text-[var(--text-secondary)]">Pick a familiar above.</p>
          <p className="mt-1">Their live chat lives here.</p>
          <button
            type="button"
            onClick={onOpenOnboarding}
            className="mt-4 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]/80"
          >
            Open setup
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatRouter
            ref={ref}
            familiar={familiar}
            sessions={sessions}
            daemonRunning={daemonRunning}
            onSessionStarted={onSessionStarted}
            onSlashFromChat={onSlashFromChat}
            onOpenOnboarding={onOpenOnboarding}
          />
        </div>
      )}
    </div>
  );
});
