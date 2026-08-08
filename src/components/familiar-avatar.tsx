"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FamiliarGlyph } from "./familiar-glyph";
import { AvatarLightbox } from "./ui/avatar-lightbox";
import { useAuthedImageState } from "@/lib/authed-image";
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
  /** Footer actions inside the expanded preview (e.g. an "Edit" link) —
   *  forwarded to AvatarLightbox. Only meaningful with `expandable`. */
  expandFooterActions?: ReactNode;
};

export function FamiliarAvatar({ familiar, size = "md", className, title, expandable, expandFooterActions }: Props) {
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

  // The workspace avatar source is `/api/familiars/<id>/avatar`, which the
  // packaged sidecar gates behind an auth token that a native <img> can't
  // carry — it would 401 into the broken-image glyph. Resolve the current
  // source through the authed fetch (→ a blob: URL); data-URL uploads and
  // http(s) sources pass through untouched. A genuine fetch failure advances
  // the fallback chain exactly like a native decode error would.
  const rawSrc = sources[srcIdx];
  const { url: resolvedSrc, status } = useAuthedImageState(rawSrc);
  useEffect(() => {
    if (status === "error") setSrcIdx((i) => i + 1);
  }, [status, rawSrc]);

  // Render the image once resolved (`ready`); while an authed fetch is still in
  // flight, hold on the glyph placeholder rather than flashing a broken image.
  const hasImage = Boolean(resolvedSrc);

  const imgEl = hasImage ? (
    <img
      src={resolvedSrc ?? undefined}
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

  if (expandable && hasImage && resolvedSrc) {
    return (
      <AvatarLightbox src={resolvedSrc} label={familiar.display_name} footerActions={expandFooterActions}>
        {imgEl}
      </AvatarLightbox>
    );
  }

  return imgEl;
}
