"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Catches render/runtime errors thrown anywhere in
 * the workspace subtree so one broken component recovers gracefully instead of
 * white-screening the whole surface. Deliberately dependency-light — the UI that
 * crashed must not be required to render this fallback.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Diagnostics: `digest` ties a client-visible error to the server logs.
    console.error("Cave surface error:", error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--bg-base, #0a0a0a)",
        color: "var(--text-primary, #e8e8ec)",
        fontFamily: "var(--font-sans), system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          textAlign: "center",
          padding: "28px 28px 24px",
          borderRadius: 16,
          border: "1px solid var(--border-hairline, rgba(255,255,255,0.1))",
          background: "var(--bg-raised, #141414)",
        }}
      >
        <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 12 }} aria-hidden>
          ⚠️
        </div>
        <h1 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--text-muted, #9a9a9a)" }}>
          This surface hit an unexpected error. You can retry it, or reload the app — your work is
          saved as you go.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--accent-fg, #fff)",
              background: "var(--accent-presence, #7c6cf0)",
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text-primary, #e8e8ec)",
              background: "transparent",
              border: "1px solid var(--border-strong, rgba(255,255,255,0.18))",
            }}
          >
            Reload app
          </button>
        </div>
      </div>
    </div>
  );
}
