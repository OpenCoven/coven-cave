"use client";

import { useEffect } from "react";

/**
 * Root error boundary — the last line of defense. Catches errors thrown in the
 * root layout itself (where the normal `error.tsx` can't help), so a fatal error
 * still shows a recoverable page instead of a blank white screen on any
 * distribution. It replaces the whole document, so it renders its own
 * <html>/<body> and uses hardcoded neutral-dark colors: the theme stylesheet may
 * not have loaded when the layout is what failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Cave fatal error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0a0a",
          color: "#e8e8ec",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: 400, textAlign: "center", padding: 28 }}>
          <div style={{ fontSize: 34, marginBottom: 12 }} aria-hidden>
            ⚠️
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 600 }}>The app hit a snag</h1>
          <p style={{ margin: "0 0 20px", fontSize: 13, color: "#9a9a9a" }}>
            CovenCave ran into an unexpected error while starting this view. Reloading usually
            clears it.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              color: "#fff",
              background: "#7c6cf0",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
