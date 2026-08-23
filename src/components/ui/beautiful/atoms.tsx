"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/* ─────────────────────────────────────────────────────────
 * CAVE PORT — local atoms
 *
 * Upstream's SelectionActions imports these two from the
 * Beautiful UI site's own `@/components/atoms/*`, which is
 * not part of the published component set. They are small
 * and fully described by their use, so they are implemented
 * here rather than left as a broken import.
 * ───────────────────────────────────────────────────────── */

/**
 * Text whose fill sweeps with a travelling highlight — the "working on it"
 * treatment used while an action is mid-flight. Under reduced motion the
 * gradient is dropped entirely and the label paints solid (see the
 * `.bui-shimmer` rule in beautiful-ui.css), so the text never sits at partial
 * opacity with nothing moving to explain why.
 */
export function Shimmer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={[(`bui-shimmer bg-clip-text text-transparent ${className ?? ""}`), "[background-image:linear-gradient(90deg,_var(--bui-ink-3)_35%,_var(--bui-ink)_50%,_var(--bui-ink-3)_65%)]! [background-size:200%_100%]! [animation:bui-shimmer-text_1.4s_linear_infinite]!"].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  );
}

const WORD_MS = 42;

/**
 * Reveals `text` one word at a time, firing `onProgress` after each word (the
 * caller uses it to keep a floating toolbar pinned to the growing selection)
 * and `onDone` once. Reduced motion resolves the whole string on the first
 * frame — the callbacks still fire in order, so nothing downstream can hang
 * waiting for a completion that never arrives.
 */
export function StreamText({
  text,
  onProgress,
  onDone,
}: {
  text: string;
  onProgress?: () => void;
  onDone?: () => void;
}) {
  const words = text.split(" ");
  const [count, setCount] = useState(0);

  // Keep the callbacks in refs so a caller re-creating them inline (which is
  // exactly what SelectionActions does) cannot restart the stream mid-flight.
  const progressRef = useRef(onProgress);
  const doneRef = useRef(onDone);
  progressRef.current = onProgress;
  doneRef.current = onDone;

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      setCount(words.length);
      progressRef.current?.();
      doneRef.current?.();
      return;
    }

    setCount(0);
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setCount(n);
      progressRef.current?.();
      if (n >= words.length) {
        clearInterval(id);
        doneRef.current?.();
      }
    }, WORD_MS);
    return () => clearInterval(id);
    // `text` is the whole input; splitting it again would be the same array.
  }, [text, words.length]);

  return (
    <>
      {words.slice(0, count).join(" ")}
      {count < words.length ? "" : null}
    </>
  );
}
