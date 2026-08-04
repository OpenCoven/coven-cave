"use client";

/**
 * useConjuredCard — turn a dropped likeness into the card's artwork, accent and
 * foil plate (cave-3rz.2).
 *
 * Runs entirely on the client so the preview updates the moment a file lands,
 * with no upload and no server round-trip. The plate is expensive enough to be
 * worth guarding: it is rebuilt only when the FILE changes, never when the name
 * or role is typed, or every keystroke would re-rasterise it.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { buildFoilPlate, extractAura, type MaskStrategy } from "@/lib/foil/browser";

/** Working resolution for mask + plate. Large enough that the halftone reads at
 *  card size, small enough that a rebuild stays imperceptible. */
const WORK_WIDTH = 512;

export type ConjuredCard = {
  artUrl: string | null;
  plateUrl: string | null;
  aura: string | null;
  coverage: number;
  strategy: MaskStrategy | null;
  pending: boolean;
  /** Human-readable status for the stage, or null when there is nothing to say. */
  note: string | null;
};

const EMPTY: ConjuredCard = {
  artUrl: null, plateUrl: null, aura: null,
  coverage: 0, strategy: null, pending: false, note: null,
};

export function useConjuredCard(file: File | null, theme: string): ConjuredCard {
  const [state, setState] = useState<ConjuredCard>(EMPTY);
  // The theme only seeds mark selection; keep it out of the effect deps so
  // typing a role does not re-run the rasteriser.
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    if (!file) { setState(EMPTY); return; }

    let cancelled = false;
    const objectUrl = URL.createObjectURL(file);
    setState({ ...EMPTY, artUrl: objectUrl, pending: true, note: "Reading the likeness…" });

    void (async () => {
      try {
        const bitmap = await createImageBitmap(file);
        const scale = WORK_WIDTH / bitmap.width;
        const w = WORK_WIDTH;
        const h = Math.max(1, Math.round(bitmap.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("2d context unavailable");
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();

        const image = ctx.getImageData(0, 0, w, h);
        const aura = extractAura(image, "#9386d0");
        const plate = buildFoilPlate({ image, theme: themeRef.current, seed: file.name });

        if (cancelled) return;
        setState({
          artUrl: objectUrl,
          plateUrl: plate.dataUrl,
          aura,
          coverage: plate.coverage,
          strategy: plate.strategy,
          pending: false,
          note: `Foil struck on ${(plate.coverage * 100).toFixed(1)}% of the likeness · ${
            plate.strategy.textureGate ? "bright ground, texture-gated" : "dark ground, luminance only"
          }`,
        });
      } catch {
        if (cancelled) return;
        // A failed plate must never cost the portrait — the card still renders,
        // just without foil.
        setState({ ...EMPTY, artUrl: objectUrl, note: "Could not read the likeness for foil." });
      }
    })();

    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return useMemo(() => state, [state]);
}
