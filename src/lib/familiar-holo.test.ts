// @ts-nocheck
//
// The foil seed. The property under test is the one the card depends on: a
// familiar's plate is a function of its identity and of nothing else, so the
// card composes identically in the rite and on the roster.

import assert from "node:assert/strict";
import { foilSeed, foilSeedStyle } from "./familiar-holo.ts";

// ---------------------------------------------------------------------------
// Same identity, same plate — every time, in any order.
// ---------------------------------------------------------------------------

{
  const a = foilSeed("wren");
  const b = foilSeed("wren");
  assert.deepEqual(a, b, "the same identity must produce the same plate on every call");

  // Interleave a different identity: a seed that carried state between calls
  // would drift here and not in the back-to-back comparison above.
  foilSeed("onyx");
  assert.deepEqual(foilSeed("wren"), a, "an unrelated card rendering in between must not move this one's plate");
}

// ---------------------------------------------------------------------------
// Different identities get visibly different plates.
// ---------------------------------------------------------------------------

{
  const names = ["wren", "onyx", "basil", "vesper", "pip", "thistle", "juniper", "marlow"];
  const sweeps = new Set(names.map((name) => foilSeed(name).sweepTurn));
  assert.ok(
    sweeps.size >= names.length - 1,
    `eight familiars should not share a foil sweep; got ${sweeps.size} distinct values out of ${names.length}`,
  );

  const wren = foilSeed("wren");
  const onyx = foilSeed("onyx");
  assert.notEqual(wren.sweepTurn, onyx.sweepTurn, "two familiars must not sweep from the same angle");
  assert.notEqual(wren.platePhase, onyx.platePhase, "two familiars must not rake in the same phase");
}

// ---------------------------------------------------------------------------
// The three draws are independent — one hash, but not one value three times.
// ---------------------------------------------------------------------------

{
  const seed = foilSeed("wren");
  assert.notEqual(
    seed.sweepTurn,
    seed.platePhase,
    "sweep and phase must be independent draws, or the plate and the sweep move together and the foil reads as one flat band",
  );
}

// ---------------------------------------------------------------------------
// Ranges. Out-of-range values are not a rendering nicety: a sweep outside
// [0,1) turn or a pitch at or below zero collapses the gradient.
// ---------------------------------------------------------------------------

{
  const identities = ["", "a", "wren", "a-very-long-familiar-id-that-goes-on", "🜁🜂🜃", "0", "999999999"];
  for (const identity of identities) {
    const seed = foilSeed(identity);
    assert.ok(
      seed.sweepTurn >= 0 && seed.sweepTurn < 1,
      `sweepTurn out of [0,1) for ${JSON.stringify(identity)}: ${seed.sweepTurn}`,
    );
    assert.ok(
      seed.platePhase >= 0 && seed.platePhase < 1,
      `platePhase out of [0,1) for ${JSON.stringify(identity)}: ${seed.platePhase}`,
    );
    assert.ok(
      seed.platePitch >= 0.8 && seed.platePitch <= 1.2,
      `platePitch out of [0.8,1.2] for ${JSON.stringify(identity)}: ${seed.platePitch}`,
    );
  }
}

// An unnamed familiar is a legitimate state — the rite renders a card before a
// name is typed — and must yield a plate rather than throwing or producing NaN.
{
  const seed = foilSeed("");
  assert.equal(Number.isFinite(seed.sweepTurn), true, "an empty identity still yields a finite sweep");
  assert.equal(Number.isFinite(seed.platePitch), true, "an empty identity still yields a finite pitch");
}

// ---------------------------------------------------------------------------
// The style object the card actually spreads.
// ---------------------------------------------------------------------------

{
  const style = foilSeedStyle("wren");
  assert.deepEqual(
    Object.keys(style).sort(),
    ["--holo-plate-phase", "--holo-plate-pitch", "--holo-sweep"],
    "the seed contributes exactly the three custom properties the sheet reads",
  );
  assert.ok(/^0(\.\d+)?turn$/.test(style["--holo-sweep"]), `sweep must be a turn value, got ${style["--holo-sweep"]}`);
  assert.ok(
    /^0(\.\d+)?turn$/.test(style["--holo-plate-phase"]),
    `phase must be a turn value, got ${style["--holo-plate-phase"]}`,
  );
  const pitch = Number(style["--holo-plate-pitch"]);
  assert.ok(pitch >= 0.8 && pitch <= 1.2, `pitch must stay in range as a string, got ${style["--holo-plate-pitch"]}`);
  assert.deepEqual(foilSeedStyle("wren"), style, "the style object is as deterministic as the seed behind it");
}

console.log("foil seed ok");
