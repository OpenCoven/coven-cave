"use client";

/**
 * FamiliarCardTrigger — wrap a familiar's avatar so clicking it opens the card.
 *
 * The sibling of `ui/avatar-lightbox.tsx`, and deliberately not a replacement
 * for it: the lightbox is the generic "peek at this picture" gesture and still
 * owns every project, operator and roster avatar. A familiar on its own profile
 * has something better to show than a cropped square of its portrait — the
 * portrait is already the card's full-bleed art — so that one surface opens the
 * card instead. Both keep the same rule: the avatar's primary click VIEWS, and
 * changing a portrait is always a separate, labelled control.
 *
 * The overlay is loaded on first open. It pulls in the card, the foil pipeline
 * and a QR encoder, and an avatar renders on nearly every surface in the app —
 * none of that belongs in a chunk that ships to all of them.
 */

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";

import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

const FamiliarCardOverlay = dynamic(
  () => import("@/components/familiar-card-overlay").then((m) => m.FamiliarCardOverlay),
  { ssr: false },
);

type Props = {
  familiar: ResolvedFamiliar;
  /** The inline avatar to render as the trigger. The caller owns its markup. */
  children: ReactNode;
};

export function FamiliarCardTrigger({ familiar, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cave-avatar-lightbox-trigger focus-ring"
        aria-label={`Open ${familiar.display_name}'s card`}
        title="Click to open the card"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {children}
      </button>
      {open ? (
        <FamiliarCardOverlay familiar={familiar} open onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
