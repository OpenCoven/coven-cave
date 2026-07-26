"use client";

import { Icon as IconifyIcon, addCollection } from "@iconify/react";
import { useEffect, useState } from "react";
// Defaults, inferred-role glyphs, and summoning choices render immediately
// from this ~10 KiB collection. The ~638 KiB searchable picker catalogue is a
// separate async chunk and is only fetched when an uncommon selected glyph or
// the picker itself needs it.
import phFamiliarCore from "@/lib/ph-familiar-core.json";
import { DEFAULT_FAMILIAR_GLYPH, type FamiliarGlyph as Glyph } from "@/lib/familiar-glyph";

type PhosphorCollection = Parameters<typeof addCollection>[0] & {
  icons?: Record<string, unknown>;
};

const CORE_GLYPH_NAMES = new Set(
  Object.keys((phFamiliarCore as PhosphorCollection).icons ?? {}).map((n) => `ph:${n}`),
);

let fullGlyphNames: Set<string> | null = null;
let fullCatalogPromise: Promise<Set<string>> | null = null;

/** Register the full offline catalogue once, shared by every uncommon glyph. */
export function loadFullFamiliarGlyphCatalog(): Promise<Set<string>> {
  if (fullGlyphNames) return Promise.resolve(fullGlyphNames);
  if (!fullCatalogPromise) {
    fullCatalogPromise = import("@/lib/ph-glyph-catalog.json")
      .then((module) => {
        const collection = module.default as PhosphorCollection;
        addCollection(collection);
        fullGlyphNames = new Set(
          Object.keys(collection.icons ?? {}).map((name) => `ph:${name}`),
        );
        return fullGlyphNames;
      })
      .catch((error) => {
        fullCatalogPromise = null;
        throw error;
      });
  }
  return fullCatalogPromise;
}

/** Never hand Iconify an unavailable name: it renders no placeholder itself. */
function renderableGlyphName(name: string): string {
  return CORE_GLYPH_NAMES.has(name) || fullGlyphNames?.has(name)
    ? name
    : DEFAULT_FAMILIAR_GLYPH.name;
}

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

let coreRegistered = false;
function ensureCoreRegistered() {
  if (coreRegistered) return;
  addCollection(phFamiliarCore as PhosphorCollection);
  coreRegistered = true;
}

type Size = "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<Size, number> = {
  sm: 16,
  md: 22,
  lg: 36,
  xl: 48,
};

type Props = {
  glyph: Glyph;
  size?: Size;
  className?: string;
  title?: string;
};

export function FamiliarGlyph({ glyph, size = "md", className, title }: Props) {
  const px = SIZE_PX[size];
  const [, markCatalogLoaded] = useState(0);
  const needsFullCatalog = !CORE_GLYPH_NAMES.has(glyph.name) && !fullGlyphNames;

  useEffect(() => {
    if (!needsFullCatalog) return;
    let active = true;
    void loadFullFamiliarGlyphCatalog()
      .then(() => {
        if (active) markCatalogLoaded((revision) => revision + 1);
      })
      .catch(() => {
        // Keep the guaranteed core fallback when a lazy chunk cannot load.
      });
    return () => {
      active = false;
    };
  }, [needsFullCatalog, glyph.name]);

  ensureCoreRegistered();
  return (
    <span
      className={className ?? "inline-flex items-center justify-center text-[var(--text-primary)]"}
      title={title}
    >
      <IconifyIcon
        icon={renderableGlyphName(glyph.name)}
        width={px}
        height={px}
        aria-label={title}
        role={title ? "img" : undefined}
      />
    </span>
  );
}
