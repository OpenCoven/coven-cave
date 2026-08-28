"use client";

/**
 * SidebarSection — a titled group in the sidebar.
 *
 * These were collapsible, with a chevron, `aria-expanded`, and a localStorage
 * key each. That machinery earned nothing: the sidebar holds two short groups
 * (Navigation and Rooms), neither long enough to need folding away, and a
 * chevron on every heading read as clutter — three interactive-looking
 * controls stacked above a list of genuinely interactive rows.
 *
 * So a section is now a heading and its content: no state, no toggle, nothing
 * to remember. The one thing on this surface that DOES collapse is the chat
 * threads rail, which is a whole column rather than a short list.
 *
 * `hideWhenEmpty` stays, because a heading over nothing is worse than no
 * heading — Rooms disappears entirely when no role surfaces are registered.
 */

import React from "react";

export type SidebarSectionProps = {
  /** Stable id — emitted as `data-section` so tests and styles can target it. */
  id: string;
  label: string;
  /** Right-aligned count chip; omitted or 0 renders nothing. */
  count?: number;
  /** Trailing slot in the heading row (rarely needed; kept for hosts that
   *  want an action beside the title). */
  actions?: React.ReactNode;
  hideWhenEmpty?: boolean;
  isEmpty?: boolean;
  children: React.ReactNode;
};

export function SidebarSection({
  id,
  label,
  count,
  actions,
  hideWhenEmpty,
  isEmpty,
  children,
}: SidebarSectionProps) {
  if (hideWhenEmpty && isEmpty) return null;

  const headId = `sidebar-section-head-${id}`;

  return (
    <section className="sidebar-section" data-section={id} aria-labelledby={headId}>
      <div className="sidebar-section__head-row">
        {/* A real heading, not a button: it names the group and nothing more. */}
        <h2 id={headId} className="sidebar-section__label">
          {label}
        </h2>
        {count && count > 0 ? (
          <span className="sidebar-section__count">{count > 99 ? "99+" : count}</span>
        ) : null}
        {actions ? <div className="sidebar-section__actions">{actions}</div> : null}
      </div>
      <div className="sidebar-section__panel">{children}</div>
    </section>
  );
}
