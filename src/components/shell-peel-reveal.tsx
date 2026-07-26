"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
// Type-only: erased at compile time, so the ~22 KB vendored WebGL module
// still reaches the bundle only through the dynamic import() below.
import type PeelComponent from "@/components/canvasui/Peel";

/** The loaded vendored component, stashed at module scope once the chunk
 *  arrives. NOT React.lazy/next/dynamic: a lazy's thenable is always pending
 *  on its FIRST render even when the chunk is already loaded, so the freshly
 *  mounted Suspense boundary would commit its null fallback — blanking the
 *  detail pane (~300ms FALLBACK_THROTTLE_MS) and double-mounting its children
 *  (state/focus/scroll loss) exactly when `enhanced` flips true (cave-ao2o).
 *  Rendering the stashed component directly makes the enhancement flip a
 *  single-commit re-parent. */
let PeelLive: typeof PeelComponent | null = null;
const peelReadyListeners = new Set<() => void>();
/** The detail children live inside <Peel> — switching to the live tree before
 *  the chunk arrives would blank the whole detail pane. Track the loaded
 *  module so the plain tree keeps rendering until the live tree can mount for
 *  real, in one commit. */
function subscribePeelReady(listener: () => void) {
  if (!PeelLive) {
    void import("@/components/canvasui/Peel")
      .then((mod) => {
        PeelLive = mod.default;
        for (const notify of peelReadyListeners) notify();
      })
      // Failed chunk loads self-heal: the next subscribe retries the import.
      .catch(() => {});
  }
  peelReadyListeners.add(listener);
  return () => peelReadyListeners.delete(listener);
}
function getPeelLive() {
  return PeelLive;
}
const getPeelLiveServer = () => null;

/** Peel geometry while the collapsed rail arms the reveal: 232px of exposed
 *  under-layer matches the hover-peek overlay width; a 120px trigger strip
 *  (vs the vendor's 200 default) keeps casual mouse travel from curling.
 *  curl/bow/bulge restate the vendor defaults because setOptions merges:
 *  every key OFF_OPTIONS flattens must be restated here or it stays flat. */
const LIVE_OPTIONS = {
  reveal: 232,
  zone: 120,
  curl: 300,
  bow: 75,
  bulge: 50,
  shine: 1,
} as const;
/** Nav open: geometry flattens to (sub)pixel scale via the vendor's live
 *  setOptions — reveal/zone gate the drive strip (floored at 1px upstream,
 *  hence curl/bow/bulge must flatten too or a pointer parked on that strip
 *  still curls the page; shine is peel-independent in the shader, so it
 *  must zero here too). The component stays mounted so toggling ⌘B never
 *  re-parents (and thereby remounts) the detail tree. */
const OFF_OPTIONS = {
  reveal: 0,
  zone: 0,
  curl: 1,
  bow: 0,
  bulge: 0,
  shine: 0,
} as const;

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
 * reduced-motion users) this renders a bare Fragment: zero wrapper elements,
 * so direct-child selector chains like `.shell-detail > .cave-mode-fade`
 * (see detail-split-host.tsx) keep matching, and the children are never
 * re-parented by `active` changes within a mode. The live tree waits for the
 * vendored chunk and then renders the loaded component directly — no
 * lazy/Suspense — so the enhancement flip is a single commit: the pane never
 * blanks on a null fallback and children re-parent exactly once (cave-ao2o).
 * Under the experimental flag those `>` chains do not reach through the
 * vendor's canvas layers — a known, flag-gated divergence (Task 6 QA).
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
  const Peel = useSyncExternalStore(
    supported ? subscribePeelReady : emptySubscribe,
    getPeelLive,
    getPeelLiveServer,
  );
  const reducedMotion = usePrefersReducedMotion();
  const enhanced = supported && Peel !== null && !reducedMotion;

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
    return <>{children}</>;
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
