"use client";

import dynamic from "next/dynamic";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

// The ~22 KB vendored WebGL file loads only on HTML-in-canvas browsers.
const Peel = dynamic(() => import("@/components/canvasui/Peel"), { ssr: false });

/** Peel geometry while the collapsed rail arms the reveal: 232px of exposed
 *  under-layer matches the hover-peek overlay width; a 120px trigger strip
 *  (vs the vendor's 200 default) keeps casual mouse travel from curling. */
const LIVE_OPTIONS = { reveal: 232, zone: 120 } as const;
/** Nav open: geometry collapses to nothing via the vendor's live setOptions.
 *  The component stays mounted so toggling ⌘B never re-parents (and thereby
 *  remounts) the detail tree. */
const OFF_OPTIONS = { reveal: 0, zone: 0 } as const;

/** How many times a lost WebGL context earns a fresh mount before giving up —
 *  a crashing GPU/driver loop should not thrash remounts forever (mirrors
 *  cave-backdrop-blaze.tsx, bead cave-kbh1). */
const MAX_CONTEXT_RESTARTS = 3;

type ProbeCanvas = HTMLCanvasElement & { requestPaint?: () => void };
type ProbeContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: Element, x: number, y: number) => void;
};

let htmlInCanvasProbe: boolean | null = null;
/** Local copy of the vendored supportsHtmlInCanvas() so the probe never pulls
 *  the 22 KB module into the bundle. Cached: capability is static per env. */
function probeHtmlInCanvas(): boolean {
  if (htmlInCanvasProbe !== null) return htmlInCanvasProbe;
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas") as ProbeCanvas;
  const ctx = canvas.getContext("2d") as ProbeContext | null;
  htmlInCanvasProbe = Boolean(
    ctx &&
      typeof ctx.drawElementImage === "function" &&
      typeof canvas.requestPaint === "function",
  );
  return htmlInCanvasProbe;
}

const emptySubscribe = () => () => {};

/**
 * Progressive peel-reveal around the shell's detail children (cave-3vgd).
 * When the desktop nav is collapsed to its rail (`active`), browsers with the
 * experimental HTML-in-canvas API peel the page back from the left edge as
 * the cursor approaches, revealing the sidebar (`under`) beneath — a
 * decorative tease that hands off to the interactive .shell-nav--peek
 * overlay. Everywhere else (Tauri WKWebView, Safari, Firefox, stock Chrome,
 * reduced-motion users) this renders display:contents wrappers: zero layout
 * impact, zero GPU or network cost, and the children are never re-parented
 * by `active` changes within a mode.
 */
export function ShellPeelReveal({
  active,
  under,
  children,
}: {
  active: boolean;
  under: ReactNode;
  children: ReactNode;
}) {
  const supported = useSyncExternalStore(emptySubscribe, probeHtmlInCanvas, () => false);
  const reducedMotion = usePrefersReducedMotion();
  const enhanced = supported && !reducedMotion;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [glEpoch, setGlEpoch] = useState(0);

  // webglcontextlost fires on the vendor's output canvas and does not bubble,
  // but a capture-phase listener on the wrapper still sees it.
  useEffect(() => {
    if (!enhanced) return;
    const node = wrapRef.current;
    if (!node) return;
    const onContextLost = () => {
      setGlEpoch((epoch) => (epoch < MAX_CONTEXT_RESTARTS ? epoch + 1 : epoch));
    };
    node.addEventListener("webglcontextlost", onContextLost, true);
    return () => node.removeEventListener("webglcontextlost", onContextLost, true);
  }, [enhanced]);

  if (!enhanced) {
    return (
      <div className="shell-peel-reveal shell-peel-reveal--plain">
        <div className="shell-peel-scroll">{children}</div>
      </div>
    );
  }
  return (
    <div ref={wrapRef} className="shell-peel-reveal shell-peel-reveal--live">
      <Peel
        key={glEpoch}
        className="shell-peel-fill"
        side="left"
        mode="cursor"
        under={
          active ? (
            <div className="shell-peel-under" aria-hidden inert>
              {under}
            </div>
          ) : undefined
        }
        {...(active ? LIVE_OPTIONS : OFF_OPTIONS)}
      >
        <div className="shell-peel-scroll">{children}</div>
      </Peel>
    </div>
  );
}
