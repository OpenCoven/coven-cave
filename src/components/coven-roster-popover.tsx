"use client";

/**
 * ParticipantPicker — the roster behind the header's "N familiars ▾".
 *
 * Position, name, role, reorder and an "in the next run" switch per familiar,
 * under one stated contract: changes apply to the next run, never to a run in
 * progress (design proposal §9). Sitting a familiar out is not removing it —
 * it keeps its membership, its place in the order and its pinned session.
 */

import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

export type CovenRosterEntry = {
  familiar: ResolvedFamiliar;
  /** 1-based reply position; null in broadcast, where order is meaningless. */
  position: number | null;
  included: boolean;
};

export function CovenRosterPopover({
  entries,
  available,
  roundRobin,
  running,
  onToggleIncluded,
  onMove,
  onAdd,
  onRemove,
}: {
  entries: CovenRosterEntry[];
  /** Familiars not yet in this coven. */
  available: ResolvedFamiliar[];
  roundRobin: boolean;
  running: boolean;
  onToggleIncluded: (familiarId: string, included: boolean) => void;
  onMove: (familiarId: string, delta: -1 | 1) => void;
  onAdd: (familiarId: string) => void;
  onRemove: (familiarId: string) => void;
}) {
  return (
    <div className="coven-roster">
      <div className="coven-roster__head">
        <span className="coven-roster__kicker">
          Roster · {running ? "next run only" : roundRobin ? "next run order" : "members"}
        </span>
      </div>

      <ul className="coven-roster__list">
        {entries.map((entry, index) => (
          <li key={entry.familiar.id} className="coven-roster__row">
            {roundRobin ? (
              <span className="coven-roster__pos" aria-hidden>
                {entry.included ? entry.position : "–"}
              </span>
            ) : null}
            <FamiliarAvatar familiar={entry.familiar} size="md" className="coven-roster__avatar" />
            <span className="coven-roster__identity">
              <span className="coven-roster__name">{entry.familiar.display_name}</span>
              <span className="coven-roster__role">{entry.familiar.role}</span>
            </span>
            {roundRobin ? (
              <>
                <button
                  type="button"
                  className="coven-roster__move focus-ring"
                  aria-label={`Move ${entry.familiar.display_name} earlier`}
                  disabled={index === 0}
                  onClick={() => onMove(entry.familiar.id, -1)}
                >
                  <Icon name="ph:caret-up" width={10} height={10} aria-hidden />
                </button>
                <button
                  type="button"
                  className="coven-roster__move focus-ring"
                  aria-label={`Move ${entry.familiar.display_name} later`}
                  disabled={index === entries.length - 1}
                  onClick={() => onMove(entry.familiar.id, 1)}
                >
                  <Icon name="ph:caret-down" width={10} height={10} aria-hidden />
                </button>
              </>
            ) : null}
            <button
              type="button"
              role="switch"
              aria-checked={entry.included}
              className="coven-roster__switch focus-ring"
              aria-label={`Include ${entry.familiar.display_name} in the next run`}
              title={
                entry.included
                  ? "Included in the next run — click to sit out"
                  : "Sitting out — click to include"
              }
              onClick={() => onToggleIncluded(entry.familiar.id, !entry.included)}
            >
              <span className="coven-roster__knob" aria-hidden />
            </button>
            <button
              type="button"
              className="coven-roster__remove focus-ring"
              aria-label={`Remove ${entry.familiar.display_name} from this coven`}
              title="Remove from this coven"
              onClick={() => onRemove(entry.familiar.id)}
            >
              <Icon name="ph:x" width={11} height={11} aria-hidden />
            </button>
          </li>
        ))}
        {entries.length === 0 ? (
          <li className="coven-roster__empty">No familiars in this coven yet.</li>
        ) : null}
      </ul>

      {available.length > 0 ? (
        <div className="coven-roster__add">
          <span className="coven-roster__kicker">Add</span>
          <ul className="coven-roster__list">
            {available.map((familiar) => (
              <li key={familiar.id}>
                <button
                  type="button"
                  className="coven-roster__add-row focus-ring"
                  onClick={() => onAdd(familiar.id)}
                >
                  <FamiliarAvatar familiar={familiar} size="md" className="coven-roster__avatar" />
                  <span className="coven-roster__identity">
                    <span className="coven-roster__name">{familiar.display_name}</span>
                    <span className="coven-roster__role">{familiar.role}</span>
                  </span>
                  <Icon name="ph:plus" width={12} height={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="coven-roster__note">
        {roundRobin
          ? "This is the round-robin reply order. Changes apply to the next run — never a run in progress."
          : "Changes apply to the next run — never a run in progress."}
      </p>
    </div>
  );
}

export default CovenRosterPopover;
