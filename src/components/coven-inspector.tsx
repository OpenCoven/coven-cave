"use client";

/**
 * Conversation details, moved out of the transcript's way.
 *
 * Subject, running summary, per-familiar threads and project access used to sit
 * in a strip above the conversation, spending prime vertical space on fields
 * that are read rarely and edited less. They live in a toggled right-hand
 * inspector instead, so the transcript never pays for them (design proposal §2).
 */

import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { CovenGroup } from "@/lib/group-chat";

export function CovenInspector({
  group,
  participants,
  projectName,
  onClose,
  onCommitDetails,
  onDebugSession,
}: {
  group: CovenGroup;
  participants: ResolvedFamiliar[];
  projectName: string | null;
  onClose: () => void;
  onCommitDetails: (details: { subject?: string; summary?: string }) => void;
  onDebugSession?: (sessionId: string, familiarId: string) => void;
}) {
  const threaded = participants.filter((familiar) => group.sessions[familiar.id]);
  return (
    <aside className="coven-inspector" aria-label="Conversation details">
      <div className="coven-inspector__head">
        <button
          type="button"
          className="coven-inspector__close focus-ring"
          aria-label="Close details"
          title="Close details"
          onClick={onClose}
        >
          <Icon name="ph:sidebar-simple" width={13} height={13} aria-hidden />
        </button>
        <span className="coven-inspector__kicker">Details</span>
      </div>

      <label className="coven-inspector__field">
        <span className="coven-inspector__label">Subject</span>
        {/* key: re-seed the uncontrolled draft when the coven changes. */}
        <input
          key={`${group.id}:subject`}
          type="text"
          defaultValue={group.subject ?? ""}
          placeholder="What is this coven about?"
          className="coven-inspector__input focus-ring-inset"
          onBlur={(event) => onCommitDetails({ subject: event.target.value })}
        />
      </label>

      <label className="coven-inspector__field">
        <span className="coven-inspector__label">Summary</span>
        <textarea
          key={`${group.id}:summary`}
          rows={3}
          defaultValue={group.summary ?? ""}
          placeholder="Short running summary of the conversation…"
          className="coven-inspector__input focus-ring-inset"
          onBlur={(event) => onCommitDetails({ summary: event.target.value })}
        />
      </label>

      {onDebugSession && threaded.length > 0 ? (
        <div className="coven-inspector__group">
          <span className="coven-inspector__label">Threads</span>
          <ul className="coven-inspector__threads">
            {threaded.map((familiar) => (
              <li key={familiar.id} className="coven-inspector__thread">
                <FamiliarAvatar familiar={familiar} size="sm" />
                <span className="coven-inspector__thread-name">{familiar.display_name}</span>
                <button
                  type="button"
                  className="coven-inspector__debug focus-ring"
                  title={`Debug ${familiar.display_name}'s session`}
                  onClick={() => onDebugSession(group.sessions[familiar.id], familiar.id)}
                >
                  Debug
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="coven-inspector__meta">
        Created <RelativeTime iso={group.createdAt} /> · updated{" "}
        <RelativeTime iso={group.updatedAt} />
        {projectName ? (
          <>
            <br />
            Project access: {projectName}
          </>
        ) : null}
      </p>
    </aside>
  );
}

export default CovenInspector;
