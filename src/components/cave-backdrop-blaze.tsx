"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { blazeColorsFromAccent, BLAZE_OPTIONS } from "@/lib/cave-backdrop-blaze-colors";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

// The ~22 KB vendored WebGL file loads only when the Blaze style is shown.
const Blaze = dynamic(() => import("@/components/canvasui/Blaze"), { ssr: false });

function readAccentCss(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent-presence").trim();
}

/**
 * The animated backdrop visual (cave-99s9): Canvas UI Blaze rendered with no
 * wrapped content, so the output canvas carries pure fire/sparks/smoke behind
 * the app. Colors derive live from `--accent-presence` — theme and mode swaps
 * retint the fire without a remount (the vendored wrapper forwards prop
 * changes to the running instance). Reduced motion mounts nothing: no frozen
 * fire frame, no GPU spend (backdrop.css hides the layer as the CSS belt to
 * this suspender). No WebGL2 → the vendored component quietly renders nothing.
 */
export function CaveBackdropBlaze() {
  const reducedMotion = usePrefersReducedMotion();
  const [accentCss, setAccentCss] = useState<string | null>(null);

  // One observer covers every accent source: preset swaps rewrite
  // data-theme/data-mode; custom themes carry the accent as an inline style
  // property on <html>.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setAccentCss(readAccentCss());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-mode", "style"],
    });
    return () => observer.disconnect();
  }, []);

  if (reducedMotion || accentCss === null) return null;
  const { sparkColor, smokeColor } = blazeColorsFromAccent(accentCss);
  return (
    <div className="cave-backdrop-blaze" aria-hidden>
      <Blaze
        {...BLAZE_OPTIONS}
        sparkColor={sparkColor}
        smokeColor={smokeColor}
        className="cave-backdrop-blaze__fill"
      >
        {null}
      </Blaze>
    </div>
  );
}
