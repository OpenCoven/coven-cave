"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
type Size = "xs" | "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  children?: ReactNode;
};

const sizeClass: Record<Size, string> = {
  xs: "ui-btn--xs",
  sm: "ui-btn--sm",
  md: "",
  lg: "ui-btn--lg",
};

const variantClass: Record<Variant, string> = {
  primary: "ui-btn--primary",
  secondary: "ui-btn--secondary",
  ghost: "ui-btn--ghost",
  danger: "ui-btn--danger",
  "danger-ghost": "ui-btn--danger-ghost",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const classes = [
    "ui-btn",
    variantClass[variant],
    sizeClass[size],
    fullWidth ? "ui-btn--full" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const iconWidth = size === "lg" ? 16 : size === "xs" ? 11 : 13;
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className={`ui-btn-spinner${loading ? " is-visible" : ""}`} aria-hidden="true" />
      {leadingIcon ? (
        <span className={`ui-btn-icon-slot${loading ? " is-hidden" : ""}`} aria-hidden="true">
          <Icon name={leadingIcon} width={iconWidth} aria-hidden />
        </span>
      ) : null}
      {children}
      {trailingIcon ? (
        <span className={`ui-btn-icon-slot${loading ? " is-hidden" : ""}`} aria-hidden="true">
          <Icon name={trailingIcon} width={iconWidth} aria-hidden />
        </span>
      ) : null}
    </button>
  );
});
