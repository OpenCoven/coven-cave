"use client";

/**
 * FamiliarCardOverlay — a familiar's card, fullscreen.
 *
 * This surface RENDERS an identity. It never derives one. Everything on the
 * face is read back from the stored record and the portrait on disk, and the
 * aura is the stored `color` override rather than anything sampled here, so a
 * familiar's colour cannot drift because somebody looked at it. There is no
 * scry on this path and no way to reach one: see the contract note on
 * `src/lib/use-familiar-card.ts`, which `familiar-card-overlay.test.ts` pins by
 * walking this component's whole import graph.
 *
 * Gestures, and how they share one card:
 *  · drag to SPIN — the card turns with the hand and springs back on release;
 *  · a press that does not travel still FLIPS, exactly as it did before;
 *  · hover still drives the foil.
 * Escape and a click on the backdrop close it; focus is trapped while it is
 * open and returned to the avatar that opened it.
 */

import { useRef } from "react";
import { createPortal } from "react-dom";

import { FamiliarCardPreview } from "@/components/familiar-card-preview";
import { Icon } from "@/lib/icon";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { runtimeDisplayLabel } from "@/lib/harness-adapters";
import { useFamiliarCard } from "@/lib/use-familiar-card";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

import "@/styles/familiar-card.css";

/** Where a card's mark points. Matches the rite's seal, so the card a familiar
 *  was summoned with and the card you open later carry the same mark. */
const SEAL_ORIGIN = "https://opencoven.ai/f/";

export type FamiliarCardOverlayProps = {
  familiar: ResolvedFamiliar;
  open: boolean;
  onClose: () => void;
};

export function FamiliarCardOverlay({ familiar, open, onClose }: FamiliarCardOverlayProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  // The trap saves the element that had focus when it activated — the avatar —
  // and restores it on close, so dismissing never dumps focus at the top of the
  // page behind the card.
  useFocusTrap(open, dialogRef, { onEscape: onClose });

  const card = useFamiliarCard(familiar, open);
  const harness = familiar.harness ?? familiar.defaultHarness ?? null;

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="famcard-full" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="famcard-full__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${familiar.display_name}'s card`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <FamiliarCardPreview
          name={familiar.display_name}
          role={familiar.role}
          description={familiar.description}
          harness={harness}
          vesselLabel={harness ? runtimeDisplayLabel(harness) : undefined}
          model={familiar.model}
          typeIds={card.typeIds}
          artUrl={card.artUrl}
          plateUrl={card.plateUrl}
          /* The STORED aura. Not re-extracted — see use-familiar-card.ts. */
          aura={card.aura}
          sealUrl={`${SEAL_ORIGIN}${familiar.id}`}
          spinnable
          slotClassName="famcard-slot--full"
        />

        <p className="famcard-full__hint" aria-live="polite">
          {card.building
            ? "Striking the foil from the portrait…"
            : reducedMotion
              ? "Press the card to turn it over."
              : "Drag to spin · press to turn it over"}
        </p>

        <button
          type="button"
          className="famcard-full__close focus-ring"
          onClick={onClose}
          aria-label={`Close ${familiar.display_name}'s card`}
        >
          <Icon name="ph:x" width={16} height={16} aria-hidden />
        </button>
      </div>
    </div>,
    document.body,
  );
}
