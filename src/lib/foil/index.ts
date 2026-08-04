/**
 * foil — deterministic holographic foil plates for familiar cards.
 *
 * `plate.ts` is isomorphic (no DOM, no `sharp`), `browser.ts` adds the canvas
 * path used by the live summoning preview. The CLI and print-resolution
 * renderer live in `scripts/foil-forge/`.
 */
export { renderPlate, MARK_NAMES, TEMPLATES, tagsForTheme } from "./plate";
export type { PlateOptions, PlateResult, TemplateName } from "./plate";
export { buildFoilPlate, extractSpecularMask, extractAura } from "./browser";
export type { FoilPlateInput, FoilPlateOutput, MaskStrategy } from "./browser";
export { FALLOFF_NAMES, deriveSeed } from "./field";
