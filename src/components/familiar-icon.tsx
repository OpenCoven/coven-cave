"use client";

// Override-aware familiar glyph. Extracted from chat-view.tsx so the chat
// empty state (chat-empty-state.tsx) and the transcript can share it without
// a circular import.

import type { Familiar } from "@/lib/types";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import { useFamiliarImages } from "@/lib/cave-familiar-images";
import { useFamiliarOverrides } from "@/lib/cave-familiar-overrides";
import { resolveFamiliar } from "@/lib/familiar-resolve";
import { FamiliarAvatar } from "@/components/familiar-avatar";

export function FamiliarIcon({
  familiar,
  size = "sm",
}: {
  familiar: Familiar;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const overrides = useGlyphOverrides();
  const images = useFamiliarImages();
  const familiarOverrides = useFamiliarOverrides();
  const resolved = resolveFamiliar(familiar, {
    override: familiarOverrides[familiar.id],
    image: images[familiar.id],
    glyphOverride: overrides[familiar.id],
    archived: false,
  });
  return <FamiliarAvatar familiar={resolved} size={size} />;
}
