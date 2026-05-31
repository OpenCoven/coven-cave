"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";

type PropertyPillProps = {
  icon?: IconName;
  label: ReactNode;
  /** If true, render as filled (a value is set). Otherwise outlined. */
  filled?: boolean;
  onClick?: () => void;
  title?: string;
};

export function PropertyPill({ icon, label, filled, onClick, title }: PropertyPillProps) {
  return (
    <button
      type="button"
      className={`ui-pill${filled ? " ui-pill--filled" : ""}`}
      onClick={onClick}
      title={title}
    >
      {icon ? (
        <span className="ui-pill-icon">
          <Icon name={icon} width={12} />
        </span>
      ) : null}
      <span>{label}</span>
    </button>
  );
}
