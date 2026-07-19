import { useEffect, useRef } from "react";
import { AvatarLightbox, Button } from "coven-cave";

const WREN_AVATAR =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'>` +
      `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0' stop-color='#6d5bd0'/><stop offset='1' stop-color='#2e2750'/>` +
      `</linearGradient></defs>` +
      `<rect width='96' height='96' fill='url(#g)'/>` +
      `<circle cx='48' cy='40' r='17' fill='#cfc6f7'/>` +
      `<path d='M34 30 L38 16 L46 27 Z' fill='#cfc6f7'/>` +
      `<path d='M62 30 L58 16 L50 27 Z' fill='#cfc6f7'/>` +
      `<path d='M20 92 C20 66 76 66 76 92 Z' fill='#cfc6f7'/>` +
      `</svg>`,
  );

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 24,
        borderRadius: "var(--radius-card)",
        minHeight: "70vh",
      }}
    >
      {children}
    </div>
  );
}

/** AvatarLightbox opens from its own trigger click, so the preview clicks the
 *  trigger once on mount to show the enlarged state. */
function AutoOpen({ children }: { children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    hostRef.current?.querySelector<HTMLButtonElement>(".cave-avatar-lightbox-trigger")?.click();
  }, []);
  return <div ref={hostRef}>{children}</div>;
}

const SmallAvatar = () => (
  <img
    src={WREN_AVATAR}
    alt=""
    style={{ width: 44, height: 44, borderRadius: "50%", display: "block" }}
  />
);

export const Basic = () => (
  <Surface>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <AutoOpen>
        <AvatarLightbox
          src={WREN_AVATAR}
          label="Wren"
          category="Familiar avatar"
          footerActions={
            <Button variant="ghost" size="sm" trailingIcon="arrow-square-out">
              Edit in Settings
            </Button>
          }
        >
          <SmallAvatar />
        </AvatarLightbox>
      </AutoOpen>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>Wren</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Grimoire keeper · awake</div>
      </div>
    </div>
  </Surface>
);

export const Trigger = () => (
  <Surface>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <AvatarLightbox src={WREN_AVATAR} label="Wren" category="Familiar avatar">
        <SmallAvatar />
      </AvatarLightbox>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Closed trigger — click enlarges the avatar
      </span>
    </div>
  </Surface>
);
