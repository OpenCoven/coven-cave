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
};

type QrMatrix = { size: number; rows: string[] };

export function FamiliarCardPreview({
  name, role, description, harness, vesselLabel, model,
  typeIds, artUrl, plateUrl, aura, sealUrl, scrying, sealed,
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
    const rx = (0.5 - y / 100) * 22;
    const ry = (x / 100 - 0.5) * 22;
    el.style.setProperty("--tilt-x", `${rx.toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(flipped ? 180 + ry : ry).toFixed(2)}deg`);
  }, [flipped]);

  const rest = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.classList.remove("famcard--live");
    el.style.setProperty("--px", "50%");
    el.style.setProperty("--py", "50%");
    el.style.setProperty("--fx", "0");
    el.style.setProperty("--fy", "0");
    el.style.setProperty("--glow", "0");
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", flipped ? "180deg" : "0deg");
  }, [flipped]);

  useEffect(() => { rest(); }, [rest]);

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
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = cardRef.current;
    if (!el) return;
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
    <div className="famcard-slot">
      <button
        ref={cardRef}
        type="button"
        className={`famcard focus-ring${flipped ? " famcard--flipped" : ""}${scrying ? " famcard--scrying" : ""}`}
        style={styleVars}
        onPointerMove={handleMove}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => { setHovering(false); rest(); }}
        onClick={() => setFlipped((v) => !v)}
        aria-label={`Familiar card for ${name || "your familiar"}.${
          offices.length ? ` ${offices.length > 1 ? "Offices" : "Office"}: ${offices.map((o) => o.label).join(", ")}.` : ""
        } Activate to turn it over.`}
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
