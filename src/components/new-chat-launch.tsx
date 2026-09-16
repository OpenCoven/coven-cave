"use client";

import "@/styles/cave-chat.css";
import "@/styles/new-chat-launch.css";

import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { relativeTime } from "@/lib/relative-time";
import { formatTimestamp, readDateTimePrefs, useDateTimePrefs } from "@/lib/datetime-format";
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
  onRequestActor,
  onResume,
  pendingProjectRoot,
}: {
  familiars: Familiar[];
  sessions: SessionRow[];
  onPick: (familiarId: string) => void;
  onRequestActor?: () => void;
  onResume: (sessionId: string) => void;
  pendingProjectRoot?: string | null;
}) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
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
              ? "Choose a familiar to work in this project."
              : "Choose who to work with. You can write your message next."}
          </p>
          {pendingProjectRoot ? (
            <p className="cave-launch__project">
              <Icon name="ph:folder" width={14} aria-hidden />
              <span>{pendingProjectRoot}</span>
            </p>
          ) : null}
        </header>

        <div className="cave-launch__section" aria-label="Familiars">
          <p className="cave-launch__label">Familiars</p>
          {onRequestActor ? (
            <Button className="cave-launch__choose" variant="primary" onClick={() => onRequestActor()}>
              Choose familiar
            </Button>
          ) : resolved.length === 0 ? (
            <EmptyState
              compact
              headline="No familiars yet"
              subtitle="Add a familiar in Familiars, then return to start a chat."
            />
          ) : (
            <div className="cave-launch__grid">
              {resolved.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="cave-launch__card focus-ring reveal-scope"
                  aria-label={`Start a chat with ${f.display_name}`}
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
                  <Icon name="ph:arrow-right-bold" width={13} className="cave-launch__card-go reveal-on-hover" aria-hidden />
                </button>
              ))}
            </div>
          )}
        </div>

        {recents.length > 0 ? (
          <div className="cave-launch__section" aria-label="Recent chats">
            <p className="cave-launch__label">Pick up where you left off</p>
            <div className="cave-launch__recents">
              {recents.map((s) => {
                const fam = s.familiarId ? resolved.find((f) => f.id === s.familiarId) : undefined;
                return (
                <button
                  key={s.id}
                  type="button"
                  className="cave-launch__recent focus-ring reveal-scope"
                  aria-label={`Resume ${s.title || "New chat"}`}
                  onClick={() => onResume(s.id)}
                >
                  {fam ? (
                    <FamiliarAvatar familiar={fam} size="sm" className="cave-launch__recent-icon" />
                  ) : (
                    <Icon name="ph:chat-circle-dots" width={15} className="cave-launch__recent-icon" aria-hidden />
                  )}
                  <span className="cave-launch__recent-copy">
                    <span className="cave-launch__recent-title">{s.title || "New chat"}</span>
                    <span
                      className="cave-launch__recent-meta"
                      title={s.updated_at ? formatTimestamp(s.updated_at, readDateTimePrefs()) : undefined}
                    >
                      {famName(s.familiarId) ? `${famName(s.familiarId)} · ` : ""}
                      {relativeTime(s.updated_at)}
                    </span>
                  </span>
                  <Icon name="ph:arrow-right-bold" width={12} className="cave-launch__recent-go reveal-on-hover" aria-hidden />
                </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
