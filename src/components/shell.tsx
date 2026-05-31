"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";

// Shell — the three-pane app chrome introduced by issue #14.
//
// Layout (CSS grid, see .shell-root in globals.css):
//   ┌────────┬─────────────┬──────────────────────────┐
//   │  app   │   context   │                          │
//   │  nav   │   list      │      detail pane         │
//   │ 240px  │  ~260px     │         (flex)           │
//   └────────┴─────────────┴──────────────────────────┘
//
// `list` is optional — pass `list={null}` for a two-pane layout
// (used by full-bleed modes like /mockup-style settings).
//
// Resize handles are intentionally NOT re-added here. The previous
// workspace used react-resizable-panels; the Mood C aesthetic
// prefers fixed pane widths from tokens (--shell-nav-width,
// --shell-list-width). If you need a different width, override
// those tokens for a specific route.

export type ShellNavSection = {
  label?: string;
  items: ShellNavItem[];
};

export type ShellNavItem = {
  id: string;
  label: string;
  icon: IconName;
  kbd?: string;
  active?: boolean;
  onClick?: () => void;
  presence?: "active" | "idle";
};

export function Shell({
  nav,
  list,
  detail,
  topBar,
}: {
  nav: ReactNode;
  list?: ReactNode;
  detail: ReactNode;
  topBar?: ReactNode;
}) {
  const twoPane = !list;
  return (
    <div className="flex h-screen w-screen flex-col">
      {topBar}
      <div
        className={`shell-root flex-1 min-h-0${twoPane ? " shell-root--two-pane" : ""}`}
      >
        <aside className="shell-nav">{nav}</aside>
        {list && <aside className="shell-list">{list}</aside>}
        <main className="shell-detail">{detail}</main>
      </div>
    </div>
  );
}

export function ShellNav({
  header,
  sections,
}: {
  header?: ReactNode;
  sections: ShellNavSection[];
}) {
  return (
    <>
      {header}
      {sections.map((section, idx) => (
        <div key={section.label ?? `section-${idx}`}>
          {section.label && (
            <div className="shell-nav-eyebrow">{section.label}</div>
          )}
          {section.items.map((item) => (
            <ShellNavButton key={item.id} item={item} />
          ))}
        </div>
      ))}
    </>
  );
}

export function ShellNavButton({ item }: { item: ShellNavItem }) {
  return (
    <button
      type="button"
      className={`shell-nav-item${item.active ? " shell-nav-item--active" : ""}`}
      onClick={item.onClick}
    >
      <span className="shell-nav-item-icon">
        <Icon name={item.icon} width={14} />
      </span>
      <span>{item.label}</span>
      {item.presence && (
        <span
          aria-hidden
          className={`shell-presence-dot ml-auto${item.presence === "idle" ? " shell-presence-dot--idle" : ""}`}
        />
      )}
      {item.kbd && !item.presence && (
        <span className="shell-nav-kbd">{item.kbd}</span>
      )}
    </button>
  );
}

export function ShellNavHeader({
  initial,
  label,
}: {
  initial: string;
  label: string;
}) {
  return (
    <button type="button" className="shell-nav-header">
      <span className="shell-nav-avatar">{initial}</span>
      <span>{label}</span>
      <Icon
        name="ph:caret-down"
        width={12}
        className="ml-auto opacity-60"
      />
    </button>
  );
}
