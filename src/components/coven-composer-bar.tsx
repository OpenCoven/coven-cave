"use client";

/**
 * ComposerRoutingBar — the composer is the single source of truth for what
 * happens when you press Enter (design proposal §7).
 *
 * Mode selector with an explainer, a live recipient preview that re-computes as
 * the draft changes, and the queued-message chip that makes "Enter queues" a
 * visible fact rather than a promise.
 */

import { useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Popover } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/settings-controls";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { COVEN_RESPONSE_MODES, type CovenResponseMode } from "@/lib/group-chat";
import type { CovenComposerRouting } from "@/lib/coven-composer-routing";

function ModeExplainer() {
  return (
    <div className="coven-modes">
      <div className="coven-modes__row">
        <span className="coven-modes__glyph" aria-hidden>
          <Icon name="ph:arrows-clockwise" width={12} height={12} />
        </span>
        <div>
          <p className="coven-modes__name">Round robin</p>
          <p className="coven-modes__body">
            One at a time, in roster order. Each familiar sees the replies before it.
            One message = one round.
          </p>
        </div>
      </div>
      <div className="coven-modes__row">
        <span className="coven-modes__glyph" aria-hidden>
          <Icon name="ph:broadcast" width={12} height={12} />
        </span>
        <div>
          <p className="coven-modes__name">Broadcast</p>
          <p className="coven-modes__body">Everyone at once, answering independently, in parallel.</p>
        </div>
      </div>
      <div className="coven-modes__rules">
        <p className="coven-modes__rule">
          Switching never changes a run in progress — it applies to your{" "}
          <strong>next message</strong>.
        </p>
        <p className="coven-modes__rule">
          <code>@name</code> replies to one familiar without advancing the rotation.
        </p>
      </div>
    </div>
  );
}

export function CovenComposerBar({
  routing,
  mode,
  onModeChange,
  modeLocked,
  byId,
  queued,
  onDiscardQueued,
}: {
  routing: CovenComposerRouting;
  mode: CovenResponseMode;
  onModeChange: (mode: CovenResponseMode) => void;
  /** A run is active: the switch sets the NEXT message's mode, not this run's. */
  modeLocked: boolean;
  byId: Map<string, ResolvedFamiliar>;
  /** Draft held until the active run finishes. */
  queued: string | null;
  onDiscardQueued: () => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="coven-composer-bar">
      {queued ? (
        <div className="coven-queued" role="status">
          <Icon name="ph:clock" width={12} height={12} aria-hidden />
          <span className="coven-queued__text">
            Queued — sends when this run finishes: “{queued}”
          </span>
          <button
            type="button"
            className="coven-queued__discard focus-ring"
            onClick={onDiscardQueued}
          >
            Discard
          </button>
        </div>
      ) : null}

      <div className="coven-routing">
        {routing.showModeControl ? (
          <span className="coven-routing__mode">
            <Segmented
              options={COVEN_RESPONSE_MODES}
              value={mode}
              onChange={onModeChange}
              getLabel={(option) => (option === "broadcast" ? "Broadcast" : "Round robin")}
              getTitle={(option) =>
                option === "broadcast"
                  ? "Everyone at once, answering independently"
                  : "One familiar at a time, in roster order"
              }
              ariaLabel="Coven response mode"
            />
            <button
              ref={infoRef}
              type="button"
              className="coven-routing__info focus-ring"
              aria-label="How modes work"
              aria-expanded={infoOpen}
              onClick={() => setInfoOpen((open) => !open)}
            >
              <Icon name="ph:info" width={12} height={12} aria-hidden />
            </button>
            <Popover
              open={infoOpen}
              onOpenChange={setInfoOpen}
              anchorRef={infoRef}
              placement="top-start"
              ariaLabel="Response modes"
              minWidth={340}
            >
              <ModeExplainer />
            </Popover>
          </span>
        ) : null}

        {modeLocked && routing.showModeControl ? (
          <span className="coven-routing__note">
            <Icon name="ph:clock" width={10} height={10} aria-hidden />
            This run keeps its mode — the switch applies to your next message.
          </span>
        ) : null}

        {routing.chips.length > 0 ? (
          <span className="coven-routing__preview">
            {routing.lead}
            {routing.chips.map((chip) => {
              const familiar = byId.get(chip.id);
              return (
                <span key={chip.id} className="coven-routing__chip-wrap">
                  {chip.arrow ? (
                    <Icon
                      name="ph:caret-right"
                      width={9}
                      height={9}
                      className="coven-routing__sep"
                      aria-hidden
                    />
                  ) : null}
                  {chip.dot ? (
                    <span className="coven-routing__sep" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  <span className="coven-routing__chip">
                    {familiar ? (
                      <FamiliarAvatar
                        familiar={familiar}
                        size="sm"
                        className="coven-routing__avatar"
                      />
                    ) : null}
                    {chip.name}
                  </span>
                </span>
              );
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default CovenComposerBar;
