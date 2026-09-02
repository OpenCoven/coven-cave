"use client";

import { Icon } from "@/lib/icon";
import {
  CHAT_SESSION_STATUS,
  type ChatSessionStatusKey,
  type ChatSessionTransport,
} from "@/lib/chat-session-status";

import "@/styles/session-status-pill.css";

/** How the transport reads when it qualifies a running session. */
const TRANSPORT_LABEL: Record<Exclude<ChatSessionTransport, null>, string> = {
  connecting: "connecting",
  reconnecting: "reconnecting",
};

/**
 * The single badge that states a session's status.
 *
 * Before this existed the two session surfaces disagreed about what a session
 * WAS. The list row painted one of five daemon states as a pill; the detail
 * header painted a different four-state machine of its own as prose inside a
 * metadata run, stacked above a second strip counting completed steps and a
 * third strip counting them again. Reading a header top to bottom gave you
 * "connecting…" over "28 done" over "elapsed 1m 33s" — three fragments of one
 * story, in three voices, none of which was the status.
 *
 * So: one enum, one pill, both surfaces. Transport (`connecting`,
 * `reconnecting`) is a MODIFIER on the dot and on the accessible name — never
 * a replacement label — because it describes the wire rather than the work.
 * A session that is connecting is running; "connecting" is not an outcome a
 * run can end in, and putting it in the status slot meant the status slot
 * stopped answering "how did this go?".
 */
export function SessionStatusPill({
  status,
  transport = null,
  className,
}: {
  status: ChatSessionStatusKey;
  /** Wire condition beneath the status. Ignored unless the session is live. */
  transport?: ChatSessionTransport;
  className?: string;
}) {
  const presentation = CHAT_SESSION_STATUS[status];
  // Transport only means anything while work is in flight. A completed run is
  // not "connecting"; showing the modifier there would resurrect the exact
  // confusion this component exists to remove.
  const live = status === "running" || status === "queued" || status === "paused";
  const activeTransport = live ? transport : null;
  const label = activeTransport
    ? `${presentation.label}, ${TRANSPORT_LABEL[activeTransport]}`
    : presentation.label;

  return (
    <span
      className={["ui-session-pill", className].filter(Boolean).join(" ")}
      data-state={status}
      data-transport={activeTransport ?? undefined}
      // The dot's ring carries the transport visually; this carries it to a
      // screen reader, so the modifier is never colour- or motion-only.
      aria-label={activeTransport ? label : undefined}
      title={label}
    >
      {status === "running" || activeTransport ? (
        <span aria-hidden className="ui-session-pill__dot" />
      ) : presentation.icon ? (
        <Icon name={presentation.icon} width={10} aria-hidden />
      ) : null}
      {presentation.label}
    </span>
  );
}
