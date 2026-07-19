import { AuthedImage } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        color: "var(--text-primary, #e8e6f0)",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

const NOVA_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="20" fill="#7c6cf0"/><circle cx="48" cy="38" r="16" fill="#efeaff"/><path d="M20 84c4-18 15-26 28-26s24 8 28 26z" fill="#efeaff"/></svg>',
  );

const SCOUT_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="#3fb98f"/><circle cx="36" cy="42" r="6" fill="#0c2b20"/><circle cx="60" cy="42" r="6" fill="#0c2b20"/><path d="M32 62q16 12 32 0" stroke="#0c2b20" stroke-width="5" fill="none" stroke-linecap="round"/></svg>',
  );

export const FamiliarAvatars = () => (
  <Surface>
    <AuthedImage
      src={NOVA_AVATAR}
      alt="Nova, the coven's resident familiar"
      width={64}
      height={64}
      style={{ borderRadius: 14 }}
    />
    <AuthedImage
      src={SCOUT_AVATAR}
      alt="Scout, the research familiar"
      width={64}
      height={64}
      style={{ borderRadius: "50%" }}
    />
    <span style={{ color: "var(--text-muted)" }}>
      data:/blob:/cross-origin sources render directly; same-origin /api/ sources are fetched
      with the sidecar auth token and swapped to a blob: URL.
    </span>
  </Surface>
);

export const FallbackWhilePending = () => (
  <Surface>
    <AuthedImage
      src={null}
      alt="Familiar avatar"
      fallback={
        <span
          style={{
            width: 64,
            height: 64,
            borderRadius: 14,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "color-mix(in oklab, var(--accent-presence) 14%, transparent)",
            color: "var(--accent-presence)",
            fontWeight: 600,
          }}
        >
          N
        </span>
      }
    />
    <span style={{ color: "var(--text-muted)" }}>
      With no source (or while the authenticated fetch is in flight) the fallback renders —
      never WebKit's broken-image glyph.
    </span>
  </Surface>
);
