"use client";

/**
 * The holographic familiar card.
 *
 * Renders an identity that already exists — it never derives one. The aura is
 * whatever it is handed, the seed is whatever names the familiar, and the
 * pointer moves a mask over a plate that was fixed before the card painted. A
 * card can therefore be shown in the rite while the familiar is still being
 * answered into existence, and again from the roster afterwards, and compose
 * identically both times.
 */

import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";

import { FamiliarGlyph } from "@/components/familiar-glyph";
import { foilSeedStyle } from "@/lib/familiar-holo";
import "@/styles/familiar-holo-card.css";

/** Degrees of tilt at the far edge of the card. Small on purpose. */
const MAX_TILT_DEG = 7;

export type FamiliarHoloCardProps = {
  /** Seeds the foil plate. The familiar's id once it has one, its name before. */
  identity: string;
  name: string;
  /** The office it holds — shown as the card's eyebrow. */
  office?: string | null;
  /** The line that describes the likeness. */
  line?: string | null;
  glyph: string;
  /** A CSS colour, already a token expression. Falls back to the app accent. */
  aura?: string | null;
  /** Object URL or served avatar URL for the portrait. */
  portraitUrl?: string | null;
  /** Rendered as the card's one stat. Never a power rating — see the note below. */
  stat?: { label: string; value: string } | null;
};

/**
 * A card carries exactly one stat, and it is never a power rating. Models are
 * not a ranking; a card implying one leads people to pick the shiny option and
 * get a worse fit for their task. The caller supplies a true magnitude or
 * nothing at all.
 */
export function FamiliarHoloCard({
  identity,
  name,
  office,
  line,
  glyph,
  aura,
  portraitUrl,
  stat,
}: FamiliarHoloCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const seedStyle = useMemo(() => foilSeedStyle(identity), [identity]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const box = cardRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    setPointer({ x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) });
  }, []);

  const handlePointerLeave = useCallback(() => setPointer(null), []);

  const style: CSSProperties = {
    ...seedStyle,
    ...(aura ? { "--holo-aura": aura } : {}),
    ...(pointer
      ? {
          "--holo-x": `${(pointer.x * 100).toFixed(1)}%`,
          "--holo-y": `${(pointer.y * 100).toFixed(1)}%`,
          // Tilt away from the pointer: pushing the left edge lifts the right.
          "--holo-tilt-x": `${((0.5 - pointer.y) * 2 * MAX_TILT_DEG).toFixed(2)}deg`,
          "--holo-tilt-y": `${((pointer.x - 0.5) * 2 * MAX_TILT_DEG).toFixed(2)}deg`,
        }
      : {}),
  } as CSSProperties;

  return (
    <div className="holo-card-slot">
      <div
        ref={cardRef}
        className="holo-card"
        style={style}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        // The card is decorative chrome for the rite beside it; the fields it
        // mirrors are all separately labelled inputs, so announcing it again
        // would read the same identity twice.
        aria-hidden
      >
        <div className="holo-card__art">
          {portraitUrl ? (
            <img className="holo-card__portrait" src={portraitUrl} alt="" />
          ) : (
            <span className="holo-card__sigil">
              <FamiliarGlyph glyph={{ kind: "icon", name: glyph }} size="xl" />
            </span>
          )}
        </div>
        <div className="holo-card__foil" />
        <div className="holo-card__plate" />
        <div className="holo-card__scrim" />
        <div className="holo-card__caption">
          {office ? <span className="holo-card__office">{office}</span> : null}
          <span className="holo-card__name">{name || "Unnamed"}</span>
          {line ? <span className="holo-card__line">{line}</span> : null}
          {stat ? (
            <span className="holo-card__stat">
              {stat.label}
              <span className="holo-card__stat-value">{stat.value}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
