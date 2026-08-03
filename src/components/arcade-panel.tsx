"use client";

/**
 * The arcade panel — somewhere to put your hands during dead air.
 *
 * A voice call spends real seconds doing nothing you can watch: asking for the
 * mic, minting a session, connecting, and then waiting on the familiar to
 * think. This mounts Glitter Crypt into that gap.
 *
 * Three constraints shape it, and all three are load-bearing:
 *
 * 1. **Silent.** It plays *over* a live call, so the game never touches audio
 *    or `getUserMedia`. Enforced by an assertion in `glitter-crypt.test.ts`,
 *    not by good intentions.
 * 2. **Opt-in.** It never appears unasked. A game that ambushes someone
 *    mid-call is a bug, and the toggle is off until it is pressed.
 * 3. **Disposable.** All state lives inside the iframe, so unmounting is the
 *    entire teardown — no rAF loop or listener survives it.
 *
 * The iframe is `sandbox="allow-scripts"` with no `allow-same-origin`, so the
 * document sits on an opaque origin: it cannot reach our storage, cookies, or
 * DOM. That is why the game has to be one self-contained string.
 */

import { useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { ARCADE_TAGLINE, ARCADE_TITLE, buildArcadeSrcDoc } from "@/lib/arcade/glitter-crypt";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

type Props = {
  /** Rendered under the title — say what the caller is waiting on. */
  waitingLabel?: string;
  onClose: () => void;
};

export function ArcadePanel({ waitingLabel, onClose }: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Bumping this remounts the document. An identical `srcDoc` does not reload
  // an iframe, so a played-out run could never return to frame one without it.
  const [runNonce, setRunNonce] = useState(0);

  const srcDoc = useMemo(
    () => buildArcadeSrcDoc({ reducedMotion }),
    [reducedMotion],
  );

  return (
    <section className="arcade-panel" aria-label={`${ARCADE_TITLE} — something to do while you wait`}>
      <header className="arcade-panel__header">
        <div className="arcade-panel__heading">
          <Icon icon="ph:magic-wand-fill" aria-hidden="true" />
          <strong className="arcade-panel__title">{ARCADE_TITLE}</strong>
        </div>
        <p className="arcade-panel__tagline">{waitingLabel ?? ARCADE_TAGLINE}</p>
        <div className="arcade-panel__actions">
          <button
            type="button"
            className="arcade-panel__action focus-ring"
            aria-label="Restart the game"
            title="Restart"
            onClick={() => {
              setRunNonce((n) => n + 1);
              // The fresh document has to take the keyboard back, or the next
              // keypress lands on the dialog behind it.
              requestAnimationFrame(() => frameRef.current?.focus());
            }}
          >
            <Icon icon="ph:arrow-counter-clockwise" />
          </button>
          <button
            type="button"
            className="arcade-panel__action focus-ring"
            aria-label={`Close ${ARCADE_TITLE}`}
            title="Close"
            onClick={onClose}
          >
            <Icon icon="ph:x" />
          </button>
        </div>
      </header>
      <iframe
        key={runNonce}
        ref={frameRef}
        className="arcade-panel__frame"
        title={`${ARCADE_TITLE} — playable`}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
      />
      <p className="arcade-panel__hint">
        Move with WASD, turn with the arrow keys, zap with space. Nothing here makes a sound.
      </p>
    </section>
  );
}
