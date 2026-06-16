"use client";

import { Icon } from "@/lib/icon";

export type SalemMood = "idle" | "thinking" | "happy" | "listening";

// Salem is a black cat, so on dark Cave chrome the disc needs a lift + a
// colored rim for contrast (mirroring the old 3D scene's purple rim light).
// The rim tints by mood so the four states stay visually distinct.
const MOOD_RIM: Record<SalemMood, string> = {
  idle: "var(--accent-presence)",
  thinking: "oklch(0.78 0.16 70)", // amber — "working"
  happy: "var(--color-success, #57c878)",
  listening: "oklch(0.72 0.15 250)", // blue — "ears up"
};

/**
 * Salem's 2D cat avatar. Flat replacement for the former Three.js scene
 * (removed to drop the heavy `three` dependency). Used at the floating
 * perch (88px) and in the chat panel (40px); handles all four moods via the
 * rim tint.
 */
export function SalemCat({ mood, size }: { mood: SalemMood; size: number }) {
  const rim = MOOD_RIM[mood];
  return (
    <span
      className={`salem-cat salem-cat--${mood}`}
      data-mood={mood}
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 50% 32%, oklch(0.27 0.035 300), oklch(0.15 0.02 300))",
        border: `1px solid color-mix(in oklch, ${rim} 55%, transparent)`,
        boxShadow: `0 0 ${Math.round(size / 6)}px color-mix(in oklch, ${rim} 30%, transparent), 0 4px 12px oklch(0 0 0 / 35%)`,
        color: "oklch(0.93 0.015 300)",
      }}
      aria-hidden
      title="Salem"
    >
      <Icon name="ph:cat" width={Math.round(size * 0.62)} />
    </span>
  );
}
