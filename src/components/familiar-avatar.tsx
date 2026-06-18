"use client";

import { useEffect, useState } from "react";
import { FamiliarGlyph } from "./familiar-glyph";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Size = "sm" | "md" | "lg" | "xl";

const PX: Record<Size, number> = { sm: 16, md: 22, lg: 36, xl: 48 };

type Props = {
  familiar: ResolvedFamiliar;
  size?: Size;
  className?: string;
  title?: string;
};

export function FamiliarAvatar({ familiar, size = "md", className, title }: Props) {
  const px = PX[size];
  // Fall back to the glyph when the avatar image fails to load (e.g. a
  // transient 404 while the avatar route compiles on a cold start, a timeout,
  // or a decode failure) instead of leaving the browser's broken-image
  // placeholder. The avatar route's 404 contract assumes this fallback. Reset
  // on src change so a new familiar/version re-attempts the image.
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setErrored(false);
  }, [familiar.avatarImage]);

  if (familiar.avatarImage && !errored) {
    return (
      <img
        src={familiar.avatarImage}
        alt={familiar.display_name}
        width={px}
        height={px}
        className={className ?? "inline-block rounded-sm object-cover"}
        title={title}
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <FamiliarGlyph
      glyph={familiar.glyph}
      size={size}
      className={className}
      title={title}
    />
  );
}
