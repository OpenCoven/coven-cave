"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "@/lib/icon";

type Size = "xs" | "sm" | "md" | "lg";
type Variant = "ghost" | "secondary" | "primary";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  /** Required for screen readers. */
  "aria-label": string;
  size?: Size;
  variant?: Variant;
  active?: boolean;
  danger?: boolean;
};

const sizeClass: Record<Size, string> = {
  xs: "ui-icon-btn--xs",
  sm: "ui-icon-btn--sm",
  md: "",
  lg: "ui-icon-btn--lg",
};

const iconWidth: Record<Size, number> = {
  xs: 11,
  sm: 12,
  md: 14,
  lg: 16,
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, size = "md", variant = "ghost", active, danger, className, type = "button", ...rest },
  ref,
) {
  const classes = [
    "ui-icon-btn",
    sizeClass[size],
    `ui-icon-btn--${variant}`,
    active ? "ui-icon-btn--active" : "",
    danger ? "ui-icon-btn--danger" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button ref={ref} type={type} className={classes} aria-pressed={active || undefined} {...rest}>
      <Icon name={icon} width={iconWidth[size]} aria-hidden />
    </button>
  );
});
