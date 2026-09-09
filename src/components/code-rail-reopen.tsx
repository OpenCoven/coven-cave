"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";

export function CodeRailReopen({
  changeCount,
  changeNonce,
  onOpen,
}: {
  changeCount: number | null;
  changeNonce: number;
  onOpen: () => void;
}) {
  const previousNonce = useRef(changeNonce);
  const [notifying, setNotifying] = useState(false);
  const { announce } = useAnnouncer();
  const changesLabel = changeCount ? `${changeCount} changed ${changeCount === 1 ? "file" : "files"}` : undefined;
  useEffect(() => {
    if (previousNonce.current === changeNonce) return;
    previousNonce.current = changeNonce;
    setNotifying(true);
    announce("Code changes updated. Open Code to review.");
  }, [announce, changeNonce]);
  useEffect(() => {
    if (!notifying) return;
    // Let animationend own full-motion timing (including slow WebKit frames).
    // Reduced motion has no animation event, so settle its static cue separately.
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    const settleStaticCue = () => {
      window.clearTimeout(timer);
      if (motion.matches) timer = window.setTimeout(() => setNotifying(false), 1600);
    };
    settleStaticCue();
    motion.addEventListener("change", settleStaticCue);
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener("change", settleStaticCue);
    };
  }, [changeNonce, notifying]);

  return (
    <button
      type="button"
      aria-label="Show code rail"
      aria-description={changesLabel}
      title={changesLabel ? `Show Code - ${changesLabel}` : "Show Code"}
      data-change-count={changeCount ?? "unknown"}
      data-change-nonce={changeNonce}
      className="workspace-rail-reopen focus-ring"
      onClick={onOpen}
    >
      <span
        key={changeNonce}
        className="workspace-rail-reopen__tab"
        data-notifying={notifying ? "true" : undefined}
        onAnimationEnd={() => setNotifying(false)}
        aria-hidden
      >
        <Icon name="ph:code" width={16} aria-hidden />
        <span className="workspace-rail-reopen__label">Code</span>
        {changeCount ? <span className="workspace-rail-reopen__count">{changeCount}</span> : null}
        <Icon name="ph:caret-left" width={12} aria-hidden />
      </span>
    </button>
  );
}
