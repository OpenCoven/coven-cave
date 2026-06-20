"use client";

import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { relativeTime } from "@/lib/relative-time";
import type { Familiar, SessionRow } from "@/lib/types";

/**
 * The new-chat launch surface. Replaces the old dead-end ("pick a familiar from
 * the sidebar selector") with an actionable hub: choose who handles the chat
 * from an inline familiar grid, or resume a recent thread — one click into the
 * composer either way.
 */
export function NewChatLaunch({
  familiars,
  sessions,
  onPick,
  onResume,
  pendingProjectRoot,
}: {
  familiars: Familiar[];
  sessions: SessionRow[];
  onPick: (familiarId: string) => void;
  onResume: (sessionId: string) => void;
  pendingProjectRoot?: string | null;
}) {
  // Resolve glyphs/avatars/order the same way the rest of the app does so the
  // cards match the switcher (and FamiliarAvatar gets a ResolvedFamiliar).
  const resolved = useResolvedFamiliars(familiars);
  const recents = [...sessions]
    .filter((s) => !s.archived_at)
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 5);
  const famName = (id?: string | null) =>
    id ? resolved.find((f) => f.id === id)?.display_name : undefined;

  return (
    <section className="cave-launch" aria-label="Start a new chat">
      <div className="cave-launch__shell">
        <header className="cave-launch__hero">
          <span className="cave-launch__mark" aria-hidden>
            <Icon name="ph:sparkle-bold" width={18} aria-hidden />
          </span>
          <h2 className="cave-launch__title">Start a new chat</h2>
          <p className="cave-launch__subtitle">
            {pendingProjectRoot
              ? "Choose a familiar to start this chat in the pending project."
              : "Choose a familiar to handle the conversation."}
          </p>
        </header>

        <div className="cave-launch__section" aria-label="Familiars">
          <p className="cave-launch__label">Familiars</p>
          <div className="cave-launch__grid">
            {resolved.map((f) => (
              <button
                key={f.id}
                type="button"
                className="cave-launch__card"
                onClick={() => onPick(f.id)}
              >
                <FamiliarAvatar familiar={f} size="md" />
                <span className="cave-launch__card-copy">
                  <span className="cave-launch__card-name">{f.display_name}</span>
                  {f.harness || f.model ? (
                    <span className="cave-launch__card-meta">
                      {[f.harness, f.model].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </span>
                <Icon name="ph:arrow-right-bold" width={13} className="cave-launch__card-go" aria-hidden />
              </button>
            ))}
          </div>
        </div>

        {recents.length > 0 ? (
          <div className="cave-launch__section" aria-label="Recent threads">
            <p className="cave-launch__label">Pick up where you left off</p>
            <div className="cave-launch__recents">
              {recents.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="cave-launch__recent"
                  onClick={() => onResume(s.id)}
                >
                  <Icon name="ph:chat-circle-dots" width={15} className="cave-launch__recent-icon" aria-hidden />
                  <span className="cave-launch__recent-copy">
                    <span className="cave-launch__recent-title">{s.title || "New chat"}</span>
                    <span className="cave-launch__recent-meta">
                      {famName(s.familiarId) ? `${famName(s.familiarId)} · ` : ""}
                      {relativeTime(s.updated_at)}
                    </span>
                  </span>
                  <Icon name="ph:arrow-right-bold" width={12} className="cave-launch__recent-go" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
