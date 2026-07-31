"use client";

import { useRef, useState } from "react";
import { FamiliarIcon } from "@/components/familiar-icon";
import { Popover, PopoverBody, PopoverItem, PopoverLabel } from "@/components/ui/popover";
import { addableFamiliars } from "@/lib/coven-promotion";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";

/**
 * Participants cluster on the right of the session title row (Chat.dc.html 2a
 * ②). The design states its own intent in a comment: "a solo session becomes a
 * coven by adding someone here." So this is not decoration — the dashed `+` is
 * the entry point to multi-familiar chat.
 *
 * A chat thread is single-familiar, so the stack always shows one avatar and
 * the mode reads Solo. Adding someone promotes the thread into a coven (which
 * carries this session over) and hands off to the coven surface, where the
 * Broadcast / Round robin control lives.
 */
export function ChatParticipants({
  familiar,
  familiars,
  daemonRunning,
  onAddFamiliar,
}: {
  familiar: Familiar;
  familiars: Familiar[];
  /** Drives the presence dot: a familiar is only reachable with the daemon up. */
  daemonRunning: boolean | null;
  /** Promote this solo thread into a coven with `id` alongside. */
  onAddFamiliar: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const addable = addableFamiliars(familiars, familiar.id);
  const online = daemonRunning !== false;

  return (
    <span className="cave-chat-participants">
      <span
        className="cave-chat-participants__stack"
        title={`${familiar.display_name} — solo session`}
      >
        <span className="cave-chat-participants__avatar">
          <FamiliarIcon familiar={familiar} size="sm" />
          <span
            className="cave-chat-participants__presence"
            data-online={online ? "true" : "false"}
            aria-hidden
          />
        </span>
      </span>
      {/* Mode indicator. A chat thread is always solo — the design's
          broadcast / round-robin states belong to a promoted coven, and its
          own control owns them there. Naming the current state here keeps the
          grammar legible without parking a permanently-constant chip in the
          composer's context row. */}
      <span className="cave-chat-participants__mode">Solo</span>
      <button
        ref={anchorRef}
        type="button"
        className="cave-chat-participants__add focus-ring"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add a familiar — turns this chat into a coven"
        aria-label="Add a familiar to this chat"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Icon name="ph:plus" width={11} aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="bottom-end"
        minWidth={244}
        ariaLabel="Add a familiar to this chat"
      >
        <PopoverBody>
          <PopoverLabel>In this chat</PopoverLabel>
          <PopoverItem
            leading={<FamiliarIcon familiar={familiar} size="sm" />}
            title={`${familiar.display_name} is this chat's familiar`}
            disabled
            semantic="button"
          >
            <span className="cave-chat-participants__row">
              <span className="truncate">{familiar.display_name}</span>
              <span className="cave-chat-participants__role">host</span>
            </span>
          </PopoverItem>
          <PopoverLabel>Add to the conversation</PopoverLabel>
          {addable.length === 0 ? (
            <PopoverItem disabled semantic="button">
              No other familiars yet
            </PopoverItem>
          ) : (
            addable.map((other) => (
              <PopoverItem
                key={other.id}
                leading={<FamiliarIcon familiar={other} size="sm" />}
                title={`Start a coven with ${familiar.display_name} and ${other.display_name} — this thread carries over`}
                onSelect={() => {
                  setOpen(false);
                  onAddFamiliar(other.id);
                }}
              >
                <span className="cave-chat-participants__row">
                  <span className="truncate">{other.display_name}</span>
                  <span
                    className="cave-chat-participants__presence"
                    data-online={online ? "true" : "false"}
                    aria-hidden
                  />
                </span>
              </PopoverItem>
            ))
          )}
        </PopoverBody>
      </Popover>
    </span>
  );
}
