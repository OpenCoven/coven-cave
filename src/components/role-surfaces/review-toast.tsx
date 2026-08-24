"use client";

/**
 * review-toast — the visible half of a review confirmation.
 *
 * `aria-hidden` on purpose. `useAnnouncer` already writes the same sentence
 * into an `sr-only` live region, so exposing this too would make assistive tech
 * read every verdict twice.
 *
 * Anchored to the deck rather than the viewport. `.rd-stage` declares
 * `container: review-deck / inline-size`, and a container type establishes
 * containment that traps `position: fixed` descendants — a fixed toast here
 * would silently anchor to the stage anyway. Making it `absolute` states that
 * outright, and it is the better behaviour besides: the deck can be one pane of
 * a split, and a confirmation for a review action belongs over the review
 * surface, not floating across the whole workspace.
 */

import { Icon } from "@/lib/icon";

export function ReviewToast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rd-toast" role="presentation" aria-hidden>
      <Icon name="ph:check-circle-fill" width={13} height={13} aria-hidden />
      <span>{message}</span>
    </div>
  );
}
