"use client";

import type { CSSProperties, ReactNode } from "react";

type Variant = "text" | "text-sm" | "row" | "card" | "avatar";

export type SkeletonProps = {
  variant?: Variant;
  /** Override inline width — e.g. "60%" or 120. */
  width?: number | string;
  /** Override inline height — e.g. 14 or "1.5rem". */
  height?: number | string;
  className?: string;
  style?: CSSProperties;
};

const variantClass: Record<Variant, string> = {
  text: "ui-skeleton--text",
  "text-sm": "ui-skeleton--text-sm",
  row: "ui-skeleton--row",
  card: "ui-skeleton--card",
  avatar: "ui-skeleton--avatar",
};

export function Skeleton({ variant = "text", width, height, className, style }: SkeletonProps) {
  const classes = ["ui-skeleton", variantClass[variant], className ?? ""].filter(Boolean).join(" ");
  return (
    <div
      className={classes}
      aria-hidden
      style={{
        ...(width !== undefined ? { width: typeof width === "number" ? `${width}px` : width } : null),
        ...(height !== undefined ? { height: typeof height === "number" ? `${height}px` : height } : null),
        ...style,
      }}
    />
  );
}

export function SkeletonGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["ui-skeleton-group", className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

export function SkeletonRows({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <SkeletonGroup className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant="row" />
      ))}
    </SkeletonGroup>
  );
}
