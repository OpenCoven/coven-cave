// Viewport size presets for the Canvas sketch editor (cave-ztbo): render the
// sandboxed sketch at true device CSS pixels — so the sketch's own media
// queries actually fire — then scale the frame down to fit the stage, the
// same way browser devtools' device toolbar does. "Fill" is the historical
// behavior: the frame tracks the stage responsively with no fixed size.

import type { IconName } from "@/lib/icon";

export type CanvasViewportPresetId = "fill" | "desktop" | "tablet" | "phone";

export type CanvasViewportPreset = {
  id: CanvasViewportPresetId;
  label: string;
  icon: IconName;
  /** Device CSS pixels; omitted for the responsive "fill" preset. */
  width?: number;
  height?: number;
};

// Device dimensions follow the common devtools presets: a 1280×800 laptop
// viewport, a 768×1024 portrait tablet, and a 390×844 modern phone.
export const CANVAS_VIEWPORT_PRESETS: readonly CanvasViewportPreset[] = [
  { id: "fill", label: "Fill", icon: "ph:corners-out" },
  { id: "desktop", label: "Desktop", icon: "ph:desktop", width: 1280, height: 800 },
  { id: "tablet", label: "Tablet", icon: "ph:device-tablet", width: 768, height: 1024 },
  { id: "phone", label: "Phone", icon: "ph:device-mobile", width: 390, height: 844 },
];

export function canvasViewportPreset(id: CanvasViewportPresetId): CanvasViewportPreset {
  return CANVAS_VIEWPORT_PRESETS.find((preset) => preset.id === id) ?? CANVAS_VIEWPORT_PRESETS[0];
}

/**
 * Scale factor that fits a preset's device box inside the available stage
 * area. Never upscales (a phone sketch on a big stage renders 1:1), and an
 * unmeasured stage (zero/negative box, e.g. before the first ResizeObserver
 * tick) resolves to 1 so the frame is never collapsed or inverted.
 */
export function resolveViewportScale(
  preset: CanvasViewportPreset,
  availWidth: number,
  availHeight: number,
): number {
  if (!preset.width || !preset.height) return 1;
  if (!Number.isFinite(availWidth) || !Number.isFinite(availHeight)) return 1;
  if (availWidth <= 0 || availHeight <= 0) return 1;
  const scale = Math.min(1, availWidth / preset.width, availHeight / preset.height);
  // Round to 4 decimals: stable across ResizeObserver jitter, invisible at px scale.
  return Math.max(0.05, Math.round(scale * 10000) / 10000);
}

/** Header caption for a sized preset, e.g. "1280×800 · 72%" (no caption for fill). */
export function describeViewport(preset: CanvasViewportPreset, scale: number): string | null {
  if (!preset.width || !preset.height) return null;
  const size = `${preset.width}×${preset.height}`;
  return scale < 1 ? `${size} · ${Math.round(scale * 100)}%` : size;
}
