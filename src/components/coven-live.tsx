"use client";

/**
 * CovenLive — full-bleed hero takeover surface for the "Coven" mode.
 * Replaces list + detail panes; nav rail and AgentPanel stay visible.
 *
 * No new deps. No backend wiring. Demo-safe.
 */

import { useCallback } from "react";

type FamiliarEntry = {
  id: string;
  name: string;
  avatar: string;
};

const FAMILIARS: FamiliarEntry[] = [
  { id: "nova",  name: "Nova",  avatar: "/assets/avatars/nova-portrait.png"  },
  { id: "cody",  name: "Cody",  avatar: "/assets/avatars/cody-portrait.png"  },
  { id: "echo",  name: "Echo",  avatar: "/assets/avatars/echo-portrait.png"  },
  { id: "sage",  name: "Sage",  avatar: "/assets/avatars/sage-portrait.png"  },
  { id: "kitty", name: "Kitty", avatar: "/assets/avatars/kitty-portrait.png" },
  { id: "charm", name: "Charm", avatar: "/assets/avatars/charm-portrait.png" },
  { id: "astra", name: "Astra", avatar: "/assets/avatars/astra-portrait.png" },
];

type ActivityEntry = {
  time: string;
  text: string;
};

const ACTIVITY: ActivityEntry[] = [
  { time: "21:47", text: "Cody opened PR #40 — coven-cave/feat-demo-seed-polish" },
  { time: "21:44", text: "Nova coordinated weekly call prep — 3 sessions active" },
  { time: "21:38", text: "Sage finished reading — ReasoningBank.pdf" },
  { time: "21:34", text: "Echo wrote a memory — failure_database_lock.md" },
  { time: "21:28", text: "Charm drafted a tweet — open-coven-weekly" },
  { time: "21:21", text: "Astra archived a session — sage:web:lit-research" },
];

type Props = {
  onWakeFamiliar?: () => void;
};

export function CovenLive({ onWakeFamiliar }: Props) {
  const handleImageError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>, name: string) => {
      const img = e.currentTarget;
      img.style.display = "none";
      const parent = img.parentElement;
      if (parent) {
        const initials = document.createElement("span");
        initials.textContent = name[0].toUpperCase();
        initials.style.cssText =
          "display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:2rem;font-weight:600;color:var(--text-muted);";
        parent.appendChild(initials);
      }
    },
    [],
  );

  return (
    <div
      className="coven-live-root"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "var(--bg-base)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2rem",
      }}
    >
      {/* Lavender radial glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 60% at 50% 30%, var(--accent-presence) 0%, transparent 60%)",
          opacity: 0.18,
          filter: "blur(48px)",
          pointerEvents: "none",
        }}
      />

      {/* Familiar constellation */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "2rem",
          justifyContent: "center",
          alignItems: "center",
          maxWidth: 720,
          position: "relative",
          zIndex: 1,
        }}
      >
        {FAMILIARS.map((f, i) => {
          const size = f.id === "nova" ? 140 : 100;
          const delay = `${i * 0.9}s`;
          return (
            <div
              key={f.id}
              title={f.name}
              style={{
                width: size,
                height: size,
                borderRadius: "50%",
                overflow: "hidden",
                border: "1px solid var(--border-strong)",
                flexShrink: 0,
                background: "var(--bg-raised)",
                cursor: "default",
                animation: `covenFloat 6s ease-in-out ${delay} infinite`,
                transition: "box-shadow 0.2s ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow =
                  "0 0 0 2px var(--accent-presence)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={f.avatar}
                alt={f.name}
                width={size}
                height={size}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onError={(e) => handleImageError(e, f.name)}
              />
            </div>
          );
        })}
      </div>

      {/* Heading */}
      <div
        style={{
          textAlign: "center",
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          The Coven is awake.
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          Seven familiars. One workshop. Yours.
        </p>
      </div>

      {/* Wake CTA */}
      <button
        onClick={onWakeFamiliar}
        style={{
          position: "relative",
          zIndex: 1,
          background: "transparent",
          border: "1px solid var(--border-strong)",
          borderRadius: 8,
          padding: "8px 24px",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--text-primary)",
          cursor: "pointer",
          transition: "background 0.15s ease, border-color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-raised)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
      >
        Wake a familiar
      </button>

      {/* Activity ticker */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "16px 24px",
          display: "flex",
          gap: 10,
          overflowX: "auto",
          scrollbarWidth: "none",
          zIndex: 1,
        }}
      >
        {ACTIVITY.map((a, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--bg-raised)",
              border: "1px solid var(--border-hairline)",
              borderRadius: 999,
              padding: "5px 14px",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                color: "var(--text-faint)",
              }}
            >
              {a.time}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{a.text}</span>
          </div>
        ))}
      </div>

      {/* Float animation */}
      <style>{`
        @keyframes covenFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}
