"use client";

import { useEffect, useMemo, useState } from "react";
import { FamiliarGlyph } from "./familiar-glyph";
import { AvatarLightbox } from "./ui/avatar-lightbox";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Size = "sm" | "md" | "lg" | "xl";

const PX: Record<Size, number> = { sm: 16, md: 22, lg: 36, xl: 48 };

type Props = {
  familiar: ResolvedFamiliar;
  size?: Size;
  className?: string;
  title?: string;
  /** When true, clicking the avatar opens a full-size preview modal. */
  expandable?: boolean;
};

export function FamiliarAvatar({ familiar, size = "md", className, title, expandable }: Props) {
  const px = PX[size];
  // Prefer the avatar image over the glyph, and try EVERY available image source
  // before ever falling back to the glyph. The glyph is the last resort — it
  // must only show when no avatar image loads. A failed load (transient 404 on a
  // cold-start avatar route, a timeout, a decode failure, or a missing format)
  // advances to the next source (e.g. the workspace avatar → a Cave-local
  // upload) instead of dropping straight to the icon. Reset on src change so a
  // new familiar/version re-attempts from the top.
  const sources = useMemo(
    () =>
      [familiar.avatarImage, familiar.avatarImageFallback].filter(
        (s): s is string => Boolean(s),
      ),
    [familiar.avatarImage, familiar.avatarImageFallback],
  );
  const [srcIdx, setSrcIdx] = useState(0);
  useEffect(() => {
    setSrcIdx(0);
  }, [familiar.avatarImage, familiar.avatarImageFallback]);

  const currentSrc = sources[srcIdx];
  const hasImage = Boolean(currentSrc);

  const imgEl = hasImage ? (
    <img
      src={currentSrc}
      alt={familiar.display_name}
      width={px}
      height={px}
      className={className ?? "inline-block rounded-[var(--radius-control)] object-cover"}
      title={title}
      onError={() => setSrcIdx((i) => i + 1)}
    />
  ) : (
    <FamiliarGlyph
      glyph={familiar.glyph}
      size={size}
      className={className}
      title={title}
    />
  );

  if (expandable && hasImage) {
    return (
      <AvatarLightbox src={currentSrc} label={familiar.display_name}>
        {imgEl}
      </AvatarLightbox>
    );
  }

  return imgEl;
}
