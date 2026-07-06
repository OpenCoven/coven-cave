"use client";

/**
 * HomeSlashMenu — the home composer's inline suggestion popover, shared by
 * the slash-command, /model, and /skill menus. Purely presentational: the
 * composer owns which menu is active, the active index, and all keyboard
 * handling; this renders the listbox with the exact classes/ARIA the
 * composer's textarea combobox contract expects.
 */

import type { ReactNode } from "react";

export type HomeSlashMenuItem = {
  /** Stable per-item key. */
  key: string;
  name: string;
  desc?: string;
  /** Optional trailing arg placeholder (slash commands only). */
  arg?: string;
};

type Props = {
  listboxId: string;
  ariaLabel: string;
  items: HomeSlashMenuItem[];
  activeIndex: number;
  footer: string;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
  /** Optional side panel (the /skill menu's detail preview). */
  preview?: ReactNode;
};

export function HomeSlashMenu({
  listboxId,
  ariaLabel,
  items,
  activeIndex,
  footer,
  onHover,
  onPick,
  preview,
}: Props) {
  const list = (
    <ul className="hc-slash-list" id={listboxId} role="listbox" aria-label={ariaLabel}>
      {items.map((item, i) => {
        const active = i === activeIndex;
        return (
          <li key={item.key} role="option" id={`${listboxId}-opt-${i}`} aria-selected={active}>
            <button
              type="button"
              tabIndex={-1}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(i)}
              className={`hc-slash-row${active ? " active" : ""}`}
            >
              <span className="hc-slash-name">{item.name}</span>
              {item.desc ? <span className="hc-slash-desc">{item.desc}</span> : null}
              {item.arg ? <span className="hc-slash-arg">{item.arg}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="hc-slash-menu">
      {preview ? <div className="hc-slash-body">{list}{preview}</div> : list}
      <div className="hc-slash-footer">{footer}</div>
    </div>
  );
}
