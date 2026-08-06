"use client";

/**
 * FamiliarCardPreview — the live trading card shown while summoning (cave-3rz.2).
 *
 * Every value on the face is real configuration, not decoration: CTX is the
 * model's actual context window, the type badge is the id that grants the role
 * token, and the frame is the harness. A "power level" stat was deliberately
 * not used — models are not a ranking, and a card that implies one leads people
 * to pick the shiny option and get a worse fit for their task.
 *
 * The foil plate is derived from the dropped artwork's own pixels, so foil
 * lands on whatever in the image would actually reflect. See src/lib/foil.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/lib/icon";
import { contextWindowForModel } from "@/lib/context-meter";
import { FAMILIAR_TYPES, type FamiliarTypeId } from "@/lib/familiar-types";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { formatTokens } from "@/lib/usage-format";

import "@/styles/familiar-card.css";

/** One frame colour per harness. A small discrete set, so the border stays
 *  legible across a roster at thumbnail size. */
const HARNESS_FRAME: Record<string, string> = {
  claude: "#c98a5b",
  codex: "#5bb6c9",
  hermes: "#9386d0",
  opencode: "#7fa86b",
  copilot: "#8d8f99",
  grok: "#b06a8f",
  openclaw: "#8d8f99",
};

/**
 * How long one office holds the badge before the next crossfades in.
 *
 * Slow on purpose: a familiar with three offices is not a ticker, and anything
 * quick enough to catch out of the corner of your eye reads as a glitch. Paired
 * with the ~620ms crossfade in familiar-card.css, each office is legible and
 * still for roughly three seconds.
 */
const OFFICE_CYCLE_MS = 3_600;

/**
 * Spin: how far the pointer has to travel before a press stops being a click.
 *
 * The card already had one gesture on it — press to flip — and spin has to
 * share the same pointer without either one guessing. A press is a FLIP until
 * it moves this far; past it the press is a spin and the click that follows is
 * swallowed. Six pixels is above hand tremor and well under any deliberate
 * drag, so neither gesture ever fires when the other was meant.
 */
const SPIN_SLOP_PX = 6;

/** Degrees of rotation per pixel dragged. Tuned so a drag across the card's own
 *  width turns it most of the way round — the card follows the hand rather than
 *  being a slider that happens to rotate. */
const SPIN_DEG_PER_PX = 0.55;

/**
 * Release physics: a damped spring back to face-on.
 *
 * Not a CSS transition, because a throw has to be able to carry the card PAST
 * a half-turn and settle from the other side; a transition can only interpolate
 * to the target the shortest way and would visibly rewind. Per frame:
 * velocity gains −k·angle, loses (1−damping), and is added to the angle.
 */
const SPIN_STIFFNESS = 0.055;
const SPIN_DAMPING = 0.9;
/** Below this (deg, deg/step) the spring is at rest and the loop stops. */
const SPIN_REST_DEG = 0.08;
/** One integration step — 60Hz, so the constants above read as "per frame" on
 *  the reference display while the spring stays clock-driven. */
const SPIN_STEP_MS = 1000 / 60;
/** Never integrate more than this per frame: after a long stall (a backgrounded
 *  window) catching up in one go would fling the card rather than resume it. */
const SPIN_MAX_STEPS_PER_FRAME = 6;

/** Ceiling on release velocity, in degrees per frame. A flick on a trackpad can
 *  report an absurd instantaneous speed; without this the card becomes a blur
 *  that takes seconds to settle, which reads as a bug rather than a throw. */
const SPIN_MAX_VELOCITY = 34;

const clampSpin = (v: number) =>
  Math.max(-SPIN_MAX_VELOCITY, Math.min(SPIN_MAX_VELOCITY, Number.isFinite(v) ? v : 0));

/** Keyboard parity for the spin: an impulse, not a fixed angle, so the card
 *  behaves the same whether it was thrown by hand or by key. */
const KEY_SPIN: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: 0, y: -10 },
  ArrowRight: { x: 0, y: 10 },
  ArrowUp: { x: 10, y: 0 },
  ArrowDown: { x: -10, y: 0 },
};

type DragState = {
  pointerId: number;
  originX: number;
  originY: number;
  /** Spin the card already carried when the press started. */
  fromX: number;
  fromY: number;
  lastX: number;
  lastY: number;
  lastAt: number;
  velX: number;
  velY: number;
  travelled: boolean;
};

export type FamiliarCardPreviewProps = {
  name: string;
  role?: string;
  description?: string;
  /** Harness id — drives the frame colour and the footer vessel line. */
  harness?: string | null;
  vesselLabel?: string;
  /** Namespaced model id, e.g. `anthropic/claude-opus-5`. */
  model?: string | null;
  /** Selected familiar types. Several cycle through the badge, one at a time. */
  typeIds?: FamiliarTypeId[];
  /** Object URL or data URL for the dropped portrait. */
  artUrl?: string | null;
  /** Foil plate data URL from `buildFoilPlate`. */
  plateUrl?: string | null;
  /** Accent sampled from the artwork. */
  aura?: string | null;
  /** Payload the back's seal encodes. */
  sealUrl?: string | null;
  /**
   * A scry is reading this artwork right now.
   *
   * Drives the foil's hunting sweep in `familiar-card.css`. It reuses the
   * plate this component already renders from `src/lib/foil` — the sweep only
   * pans the spectrum that normally follows the pointer, so there is one foil
   * system here, not a second one built for the wait.
   */
  scrying?: boolean;
  /**
   * The seal has been struck — the familiar exists.
   *
   * Turns the card over once, so the mark it now carries is the thing you see
   * rather than something you have to think to go looking for. It does NOT pin
   * the card face-down: a card you cannot turn back over is a screen, not a
   * card.
   */
  sealed?: boolean;
  /**
   * Let the card be spun by dragging it.
   *
   * Opt-in rather than always-on: the rite's card sits inside a stepped flow
   * where a stray drag across it should do nothing, while a card opened
   * fullscreen is the only thing on screen and picking it up is the point.
   *
   * The split with the gestures already here is deliberate — drag spins, a
   * press that does not travel still flips, hover still drives the foil. Under
   * `prefers-reduced-motion: reduce` the spin is not offered at all (no drag
   * rotation, no release momentum); the card is still fully viewable and still
   * flips by press or key, because flipping is a state change, not motion.
   */
  spinnable?: boolean;
  /** Extra class on the card's slot — lets a host size the card. */
  slotClassName?: string;
};

type QrMatrix = { size: number; rows: string[] };

export function FamiliarCardPreview({
  name, role, description, harness, vesselLabel, model,
  typeIds, artUrl, plateUrl, aura, sealUrl, scrying, sealed,
  spinnable, slotClassName,
}: FamiliarCardPreviewProps) {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const sealRef = useRef<HTMLCanvasElement | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [qr, setQr] = useState<QrMatrix | null>(null);
  const [hovering, setHovering] = useState(false);
  const [officeIndex, setOfficeIndex] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  // Both fall back to a token in familiar-card.css rather than a literal here,
  // so no colour reaches render from TSX (coven-design/no-render-hex-color).
  const frame = HARNESS_FRAME[harness ?? ""];
  const accent = aura;
  const ctx = contextWindowForModel(model ?? undefined);
  const ctxLabel = formatTokens(ctx.tokens) ?? String(ctx.tokens);

  /**
   * Every office the familiar holds, in the order they were chosen. A familiar
   * with three offices used to show only the first, which quietly discarded two
   * thirds of a decision the user had just made; the badge cycles them instead.
   * With none chosen it falls back to the "general" spec, exactly as before.
   */
  const offices = useMemo(() => {
    const chosen = (typeIds ?? [])
      .filter((id) => id !== "general")
      .map((id) => FAMILIAR_TYPES.find((t) => t.id === id))
      .filter((spec): spec is (typeof FAMILIAR_TYPES)[number] => !!spec);
    if (chosen.length) return chosen;
    const general = FAMILIAR_TYPES.find((t) => t.id === "general");
    return general ? [general] : [];
  }, [typeIds]);

  /**
   * The badge cycles only when there is something to cycle, the pointer is
   * elsewhere, and motion is wanted. Under reduced motion every office is shown
   * at once instead — the information is the point, the swap is not.
   */
  const cycling = offices.length > 1 && !reducedMotion && !hovering;
  const shownOffice = offices.length ? officeIndex % offices.length : 0;

  // Changing the office set restarts at the first one, so the badge never opens
  // on whichever index the previous set happened to be resting at.
  useEffect(() => { setOfficeIndex(0); }, [offices]);

  useEffect(() => {
    if (!cycling) return;
    const timer = window.setInterval(
      () => setOfficeIndex((i) => (i + 1) % offices.length),
      OFFICE_CYCLE_MS,
    );
    // Clearing on pause is what makes hover a PAUSE rather than a restart: the
    // index is state, so the office under the pointer is still there after.
    return () => window.clearInterval(timer);
  }, [cycling, offices.length]);

  /**
   * The card's rotation has three independent contributors and they must be
   * composed, never overwritten: the FLIP (a half turn of state), the HOVER
   * tilt (follows the pointer, returns to zero when it leaves), and the SPIN
   * (dragged, then sprung back). Each writes only its own ref and asks for a
   * repaint, so a spin in flight survives a flip and a hover tilt does not
   * cancel a spin mid-throw.
   */
  const hoverTiltRef = useRef({ x: 0, y: 0 });
  const spinRef = useRef({ x: 0, y: 0 });
  const springRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  /** A press that travelled is a spin, so the click it ends with is not a flip. */
  const swallowClickRef = useRef(false);

  const paintTransform = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    const spin = spinRef.current;
    const hover = hoverTiltRef.current;
    const turn = (flipped ? 180 : 0) + hover.y + spin.y;
    el.style.setProperty("--tilt-x", `${(hover.x + spin.x).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${turn.toFixed(2)}deg`);

    // Which face is actually pointing at the viewer.
    //
    // The card carries no `backface-visibility` — the blend layers inside each
    // face flatten the 3D context and the browser's own culling gets it wrong,
    // so which face shows is decided explicitly (see familiar-card.css). The
    // FLIP alone used to decide it, which was true while 180 degrees was the
    // only rotation there was. A spin can leave the card at any angle, and past
    // edge-on the front was still being painted — mirrored, with its own text
    // backwards. So the answer is recomputed from the real angle instead.
    const facing = (((turn % 360) + 360) % 360);
    const showsBack = facing > 90 && facing < 270;
    el.classList.toggle("famcard--reversed", showsBack !== flipped);
  }, [flipped]);

  const setVars = useCallback((x: number, y: number, glow: number) => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty("--px", `${x}%`);
    el.style.setProperty("--py", `${y}%`);
    // Foil travel is in PIXELS: a percentage background-position against a
    // 100% background-size resolves to zero and never moves.
    el.style.setProperty("--fx", ((x - 50) * 2.6).toFixed(1));
    el.style.setProperty("--fy", ((y - 50) * 2.6).toFixed(1));
    el.style.setProperty("--glow", String(glow));
    hoverTiltRef.current = { x: (0.5 - y / 100) * 22, y: (x / 100 - 0.5) * 22 };
    paintTransform();
  }, [paintTransform]);

  const rest = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.classList.remove("famcard--live");
    el.style.setProperty("--px", "50%");
    el.style.setProperty("--py", "50%");
    el.style.setProperty("--fx", "0");
    el.style.setProperty("--fy", "0");
    el.style.setProperty("--glow", "0");
    hoverTiltRef.current = { x: 0, y: 0 };
    paintTransform();
  }, [paintTransform]);

  useEffect(() => { rest(); }, [rest]);

  // ── Spin ────────────────────────────────────────────────────────────────
  //
  // Two switches, not one, and the distinction matters.
  //
  // `dragArmed` is the GESTURE: a press that travels is a drag rather than a
  // click, and that is true whether or not the user wants motion. It stays on
  // under reduced motion so the split is identical in both modes — otherwise a
  // drag across the card would land as a click and flip it, which is a gesture
  // nobody made.
  //
  // `spinning` is the MOTION: rotation under the hand, and the spring after it.
  // That is what reduced motion removes. The card is still fully readable and
  // still flips, because a flip is a change of state rather than an animation
  // (familiar-card.css already strips its transition).
  const dragArmed = Boolean(spinnable);
  const spinning = dragArmed && !reducedMotion;

  const stopSpring = useCallback(() => {
    if (springRef.current !== null) cancelAnimationFrame(springRef.current);
    springRef.current = null;
  }, []);

  const releaseSpin = useCallback((vx: number, vy: number) => {
    stopSpring();
    // JS owns the angle for the duration, so the face swap must be immediate —
    // the 190ms visibility delay exists to land the FLIP's swap edge-on and
    // would lag a spin by a fifth of a second.
    cardRef.current?.classList.add("famcard--turning");
    let velX = clampSpin(vx);
    let velY = clampSpin(vy);
    let previous = 0;
    let carry = 0;
    const step = (now: number) => {
      // The spring integrates in FIXED steps against the clock, not once per
      // animation frame. Tying it to frames makes the same throw settle in one
      // second on a 120Hz display and in three on a throttled one — measured:
      // a card thrown in headless Chromium was still 12 degrees out after three
      // seconds because the frame rate was about 35Hz.
      const elapsed = previous ? Math.min(120, now - previous) : SPIN_STEP_MS;
      previous = now;
      carry += elapsed;
      let steps = 0;
      while (carry >= SPIN_STEP_MS && steps < SPIN_MAX_STEPS_PER_FRAME) {
        carry -= SPIN_STEP_MS;
        steps++;
        const spin = spinRef.current;
        velX = (velX - SPIN_STIFFNESS * spin.x) * SPIN_DAMPING;
        velY = (velY - SPIN_STIFFNESS * spin.y) * SPIN_DAMPING;
        spin.x += velX;
        spin.y += velY;
      }
      carry = Math.min(carry, SPIN_STEP_MS);
      const spin = spinRef.current;
      const settled =
        Math.abs(spin.x) < SPIN_REST_DEG && Math.abs(velX) < SPIN_REST_DEG &&
        Math.abs(spin.y) < SPIN_REST_DEG && Math.abs(velY) < SPIN_REST_DEG;
      if (settled) {
        spinRef.current = { x: 0, y: 0 };
        springRef.current = null;
        paintTransform();
        cardRef.current?.classList.remove("famcard--turning");
        return;
      }
      paintTransform();
      springRef.current = requestAnimationFrame(step);
    };
    springRef.current = requestAnimationFrame(step);
  }, [paintTransform, stopSpring]);

  // A card unmounted mid-throw must not keep a frame loop alive.
  useEffect(() => stopSpring, [stopSpring]);

  // Turning spin off (reduced motion switched on while the card is open) must
  // put the card back face-on rather than freeze it wherever it was left.
  useEffect(() => {
    if (spinning) return;
    stopSpring();
    spinRef.current = { x: 0, y: 0 };
    paintTransform();
  }, [spinning, stopSpring, paintTransform]);

  const handleDown = (ev: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragArmed || ev.button !== 0) return;
    const el = cardRef.current;
    if (!el) return;
    stopSpring();
    el.setPointerCapture?.(ev.pointerId);
    dragRef.current = {
      pointerId: ev.pointerId,
      originX: ev.clientX, originY: ev.clientY,
      fromX: spinRef.current.x, fromY: spinRef.current.y,
      lastX: ev.clientX, lastY: ev.clientY, lastAt: ev.timeStamp,
      velX: 0, velY: 0, travelled: false,
    };
  };

  const handleUp = (ev: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    cardRef.current?.releasePointerCapture?.(drag.pointerId);
    cardRef.current?.classList.remove("famcard--live");
    if (!drag.travelled || !spinning) {
      cardRef.current?.classList.remove("famcard--turning");
    }
    if (!drag.travelled) return;
    // The press became a drag, so the click that follows is not a flip.
    swallowClickRef.current = true;
    if (spinning) releaseSpin(drag.velX, drag.velY);
    ev.preventDefault();
  };

  const handleKey = (ev: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!spinning) return;
    const impulse = KEY_SPIN[ev.key];
    if (!impulse) return;
    // Spin has to be reachable without a pointer, or it is a feature only a
    // mouse user has. Enter/Space stay the flip, untouched.
    ev.preventDefault();
    releaseSpin(impulse.x, impulse.y);
  };

  const handleClick = () => {
    if (swallowClickRef.current) {
      swallowClickRef.current = false;
      return;
    }
    setFlipped((v) => !v);
  };

  // Struck once, not held: this fires on the transition into `sealed`, so a
  // user who turns the card back to the portrait keeps it that way.
  useEffect(() => {
    if (sealed) setFlipped(true);
  }, [sealed]);

  // The QR encoder is only needed once a payload exists, so it is loaded lazily
  // rather than shipped in the summoning bundle.
  useEffect(() => {
    let cancelled = false;
    if (!sealUrl) { setQr(null); return; }
    void (async () => {
      try {
        const mod = await import("qrcode");
        const created = mod.default.create(sealUrl, { errorCorrectionLevel: "H" });
        const n = created.modules.size;
        const data = created.modules.data;
        const rows: string[] = [];
        for (let y = 0; y < n; y++) {
          let r = "";
          for (let x = 0; x < n; x++) r += data[y * n + x] ? "1" : "0";
          rows.push(r);
        }
        if (!cancelled) setQr({ size: n, rows });
      } catch {
        if (!cancelled) setQr(null);
      }
    })();
    return () => { cancelled = true; };
  }, [sealUrl]);

  useEffect(() => {
    const canvas = sealRef.current;
    if (!canvas || !qr) return;
    drawSeal(canvas, qr);
  }, [qr]);

  const handleMove = (ev: React.PointerEvent<HTMLButtonElement>) => {
    const el = cardRef.current;
    if (!el) return;

    // A drag in progress owns the pointer: the card turns with the hand and the
    // hover tilt stays out of it, or the two would fight over the same axes.
    // Deliberately ABOVE the reduced-motion guard — recognising the gesture is
    // not motion, and under reduced motion this branch still runs so the press
    // is not mistaken for a click; it simply never rotates anything.
    const drag = dragRef.current;
    if (drag) {
      const dx = ev.clientX - drag.originX;
      const dy = ev.clientY - drag.originY;
      if (!drag.travelled && Math.hypot(dx, dy) < SPIN_SLOP_PX) return;
      drag.travelled = true;
      if (!spinning) return;
      spinRef.current = {
        x: drag.fromX - dy * SPIN_DEG_PER_PX,
        y: drag.fromY + dx * SPIN_DEG_PER_PX,
      };
      // Velocity in degrees per 60Hz frame, from the last sample rather than
      // the whole gesture — a throw is what the hand was doing at RELEASE.
      const dt = Math.max(1, ev.timeStamp - drag.lastAt);
      drag.velY = ((ev.clientX - drag.lastX) * SPIN_DEG_PER_PX * 16) / dt;
      drag.velX = (-(ev.clientY - drag.lastY) * SPIN_DEG_PER_PX * 16) / dt;
      drag.lastX = ev.clientX;
      drag.lastY = ev.clientY;
      drag.lastAt = ev.timeStamp;
      el.classList.add("famcard--live", "famcard--turning");
      paintTransform();
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((ev.clientY - r.top) / r.height) * 100));
    el.classList.add("famcard--live");
    setVars(x, y, 1);
  };

  const styleVars = {
    ...(frame ? { "--frame": frame } : {}),
    ...(accent ? { "--aura": accent } : {}),
    ...(plateUrl ? { "--holo-tex": `url(${plateUrl})` } : {}),
  } as React.CSSProperties;

  return (
    <div className={`famcard-slot${slotClassName ? ` ${slotClassName}` : ""}`}>
      <button
        ref={cardRef}
        type="button"
        className={`famcard focus-ring${flipped ? " famcard--flipped" : ""}${scrying ? " famcard--scrying" : ""}${spinning ? " famcard--spinnable" : ""}`}
        style={styleVars}
        onPointerMove={handleMove}
        onPointerDown={handleDown}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onKeyDown={handleKey}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => { setHovering(false); rest(); }}
        onClick={handleClick}
        aria-label={`Familiar card for ${name || "your familiar"}.${
          offices.length ? ` ${offices.length > 1 ? "Offices" : "Office"}: ${offices.map((o) => o.label).join(", ")}.` : ""
        } Activate to turn it over.${spinning ? " Drag, or use the arrow keys, to spin it." : ""}`}
      >
        <div className="famcard__face famcard__face--front">
          {artUrl ? (
            <img className="famcard__art" src={artUrl} alt="" />
          ) : (
            <div className="famcard__empty">
              <Icon name="ph:image-bold" width={24} height={24} aria-hidden />
              <span>Drop a likeness to see the card take shape</span>
            </div>
          )}
          {plateUrl ? <div className="famcard__foil" aria-hidden /> : null}
          <div className="famcard__glare" aria-hidden />
          <div className="famcard__scrim" aria-hidden />

          <div className="famcard__grid">
            <div className="famcard__head">
              <span className="famcard__name">{name || "Unnamed"}</span>
              <span className="famcard__ctx">
                <span className="famcard__ctx-label">CTX</span>
                <span className="famcard__ctx-value">{ctxLabel}</span>
              </span>
            </div>

            <div className="famcard__plate">
              {/* The offices. Stacked in one grid cell when they cycle, so the
                  group is permanently as wide as its longest label and the CTX
                  stat above never shifts as the badge swaps. Hidden from
                  assistive tech because the card's own label already names every
                  office — a badge that changes every few seconds is not
                  something to re-announce. */}
              <div className="famcard__typeline">
                <span
                  className={`famcard__types${offices.length > 1 && !reducedMotion ? " famcard__types--stack" : ""}`}
                  aria-hidden
                >
                  {offices.map((spec, i) => (
                    <span
                      key={spec.id}
                      className={`famcard__type${
                        reducedMotion || i === shownOffice ? " famcard__type--on" : ""
                      }`}
                    >
                      <span className="famcard__badge">
                        <Icon name={spec.iconName} width={11} height={11} aria-hidden />
                        {spec.label}
                      </span>
                    </span>
                  ))}
                </span>
                {/* The office's own line, only when there is one office. With
                    several it would have to swap too, and a second moving string
                    beside a moving badge is a ticker. */}
                {offices.length === 1 && offices[0].roleToken ? (
                  <span>{offices[0].description.split(" — ")[0]}</span>
                ) : null}
              </div>

              <div className="famcard__move">
                <span className="famcard__move-name">{role || "Familiar"}</span>
                <span className="famcard__move-cost">{model || "inherits default"}</span>
              </div>

              {description ? <p className="famcard__note">{description}</p> : null}

              <div className="famcard__foot">
                <span>{vesselLabel || harness || "unbound"}</span>
                <span>{name ? name.toLowerCase() : "—"}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="famcard__face famcard__face--back">
          <div className="famcard__back">
            <span className="famcard__mark">Coven</span>
            <div className="famcard__seal">
              {qr ? <canvas ref={sealRef} aria-hidden /> : null}
            </div>
            <p className="famcard__back-note">
              {qr ? "Scan to summon" : "Seal struck once the rite completes"}
            </p>
          </div>
          <div className="famcard__glare" aria-hidden />
        </div>
      </button>
    </div>
  );
}

/**
 * Draw the QR seal.
 *
 * Every parameter here was chosen by decoding the rendered result rather than
 * by eye. What that testing established: the module grid must land on WHOLE
 * pixels (a fractional module antialiases every edge and even plain
 * black-on-white stops decoding); dark ink on light paper is required, because
 * light-on-dark failed at every scale; dot modules failed unless downscaled
 * enough to blur back into squares, but rounded squares plus crisp finder eyes
 * are robust — the locator only needs the eyes clean; the centre overlay
 * ceiling is between 15% and 25% of area; and a circular seal is impossible,
 * because a disc leaves the corners dark and that is exactly where the finder
 * patterns and their quiet zone live.
 */
function drawSeal(canvas: HTMLCanvasElement, qr: QrMatrix) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const n = qr.size;
  const quiet = 4;
  const frame = 3;
  const total = n + (quiet + frame) * 2;
  const unit = 20;
  canvas.width = total * unit;
  canvas.height = total * unit;

  const paper = "#efeaf7";
  const ink = "#3b2f66";
  const aura = "#4b3d7a";
  const P = canvas.width;

  ctx.clearRect(0, 0, P, P);
  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.roundRect(0, 0, P, P, unit * 2.5);
  ctx.fill();

  ctx.strokeStyle = "rgba(75, 61, 122, 0.55)";
  ctx.lineWidth = unit * 0.16;
  ctx.beginPath();
  ctx.roundRect(unit * 0.9, unit * 0.9, P - unit * 1.8, P - unit * 1.8, unit * 1.9);
  ctx.stroke();

  const off = quiet + frame;
  const isFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);

  ctx.fillStyle = ink;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.rows[y][x] !== "1" || isFinder(x, y)) continue;
      ctx.beginPath();
      ctx.roundRect((x + off) * unit, (y + off) * unit, unit, unit, unit * 0.35);
      ctx.fill();
    }
  }

  const eye = (gx: number, gy: number) => {
    const x = (gx + off) * unit;
    const y = (gy + off) * unit;
    ctx.strokeStyle = aura;
    ctx.lineWidth = unit;
    ctx.beginPath();
    ctx.roundRect(x + unit * 0.5, y + unit * 0.5, unit * 6, unit * 6, unit * 0.9);
    ctx.stroke();
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.roundRect(x + unit * 2, y + unit * 2, unit * 3, unit * 3, unit * 0.36);
    ctx.fill();
  };
  eye(0, 0);
  eye(n - 7, 0);
  eye(0, n - 7);
}
