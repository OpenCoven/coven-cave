import { FamiliarRite } from "@/components/familiar-rite";

/** Full-page host for the rite (cave-3rz.3).
 *
 *  The shipped Summon path is the overlay — `FamiliarRiteOverlay`, opened from
 *  the Familiars view. This route stays as a chrome-less place to look at the
 *  rite on its own. The seal is just as real here — it creates a familiar —
 *  but with no callbacks there is nowhere to hand back to and no way out to
 *  the circle, which is why the overlay is the entry point and this is not.
 *
 *  `.rite-page` is not decoration. `body { overflow: hidden }` is global app
 *  chrome — panels scroll, the window never does — and the overlay gets that
 *  panel from `.rite-dialog__body`. This route had none, so the rite was
 *  clipped rather than scrolled and the seal's Summon button sat below a
 *  reachable edge. It is also the scrolling ancestor the sticky card sticks
 *  to here. */
export default function RitePage() {
  return (
    <div className="rite-page">
      <FamiliarRite />
    </div>
  );
}
