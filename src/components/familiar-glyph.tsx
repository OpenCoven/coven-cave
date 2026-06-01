"use client";

import { Icon as IconifyIcon, addCollection } from "@iconify/react";
import phCollection from "@iconify-json/ph/icons.json";
import type { FamiliarGlyph as Glyph } from "@/lib/familiar-glyph";

// ---------------------------------------------------------------------------
// Render component
//
// Why this lives outside `@/lib/icon`:
//   The chrome `<Icon>` component takes a strict `IconName` union over the
//   short registry of icons used by the app shell. The picker lets users
//   pick from any of Phosphor's ~1500 icons, so we'd otherwise have to dump
//   the entire catalogue into that union (defeating its purpose). Keeping a
//   second renderer here means user-content icons stay free-form while
//   chrome icons stay typo-safe.
// ---------------------------------------------------------------------------

let registered = false;
function ensureRegistered() {
  if (registered) return;
  addCollection(phCollection as Parameters<typeof addCollection>[0]);
  registered = true;
}

type Size = "sm" | "md" | "lg";

const SIZE_PX: Record<Size, number> = {
  sm: 16,
  md: 22,
  lg: 36,
};

type Props = {
  glyph: Glyph;
  size?: Size;
  className?: string;
  title?: string;
};

export function FamiliarGlyph({ glyph, size = "md", className, title }: Props) {
  const px = SIZE_PX[size];

  if (glyph.kind === "emoji") {
    return (
      <span
        className={className ?? "inline-flex items-center justify-center"}
        style={{ fontSize: px, lineHeight: 1 }}
        title={title}
        aria-label={title}
        role={title ? "img" : undefined}
      >
        {glyph.char}
      </span>
    );
  }

  ensureRegistered();
  return (
    <span
      className={className ?? "inline-flex items-center justify-center text-[var(--text-primary)]"}
      title={title}
    >
      <IconifyIcon
        icon={glyph.name}
        width={px}
        height={px}
        aria-label={title}
        role={title ? "img" : undefined}
      />
    </span>
  );
}
