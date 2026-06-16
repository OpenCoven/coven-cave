"use client";

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
  if (familiar.avatarImage) {
    return (
      <img
        src={familiar.avatarImage}
        alt={familiar.display_name}
        width={px}
        height={px}
        className={className ?? "inline-block rounded-sm object-cover"}
        title={title}
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
