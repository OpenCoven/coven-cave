/**
 * The foil seed — deterministic plate geometry for a familiar's holo card.
 *
 * A card's foil is seeded from **identity alone**: the same familiar composes
 * the same plate every time, on every surface, at any size. That is a hard
 * property rather than a nicety — the card is rendered in the rite before the
 * familiar exists, again from the roster afterwards, and a foil that drifted
 * between the two would read as two different familiars.
 *
 * It is also why nothing here reads a clock, a random source, a viewport, or a
 * pointer. The seed produces angles and phases; the pointer only moves a mask
 * over a plate that was already fixed.
 */

/** FNV-1a over UTF-16 code units. Small, stable, and dependency-free. */
function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in range without BigInt.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export type FoilSeed = {
  /** Start angle of the foil sweep, in turns: `[0, 1)`. */
  sweepTurn: number;
  /** Phase offset of the halftone plate, in turns: `[0, 1)`. */
  platePhase: number;
  /** Plate pitch multiplier: `[0.8, 1.2]`. Keeps two cards from ringing alike. */
  platePitch: number;
};

/**
 * Derive the plate geometry for one identity.
 *
 * `identity` is whatever names the familiar at the time — its id once it has
 * one, its name while the rite is still assembling. An empty identity is a
 * legitimate state (the rite before a name is typed) and yields the base
 * plate rather than throwing.
 */
export function foilSeed(identity: string): FoilSeed {
  const base = hash32(identity);
  // Three independent draws from one hash: rotate the word so the low bits of
  // one field are not the low bits of the next.
  const sweep = base;
  const phase = hash32(`${identity}:phase`);
  const pitch = hash32(`${identity}:pitch`);
  return {
    sweepTurn: (sweep % 1000) / 1000,
    platePhase: (phase % 1000) / 1000,
    platePitch: 0.8 + ((pitch % 401) / 400) * 0.4,
  };
}

/**
 * The CSS custom properties a seed contributes to a card.
 *
 * Returned as a plain record so the component can spread it into a style
 * object and the suite can assert the values without a DOM.
 */
export function foilSeedStyle(identity: string): Record<string, string> {
  const seed = foilSeed(identity);
  return {
    "--holo-sweep": `${seed.sweepTurn}turn`,
    "--holo-plate-phase": `${seed.platePhase}turn`,
    "--holo-plate-pitch": seed.platePitch.toFixed(3),
  };
}
