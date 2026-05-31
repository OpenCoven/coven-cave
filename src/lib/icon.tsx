"use client";

import { Icon as IconifyIcon, addCollection } from "@iconify/react";
import phCollection from "@iconify-json/ph/icons.json";

let registered = false;
function ensureRegistered() {
  if (registered) return;
  addCollection(phCollection as Parameters<typeof addCollection>[0]);
  registered = true;
}

type IconProps = {
  name: string;
  className?: string;
  width?: number | string;
  height?: number | string;
  "aria-hidden"?: boolean;
  "aria-label"?: string;
  title?: string;
};

export function Icon({ name, className, width, height, title, ...aria }: IconProps) {
  ensureRegistered();
  // `title` isn't a first-class prop on `IconifyIcon`, so we wrap when the
  // caller wants a native tooltip. Same width/height defaults either way so
  // call sites can treat it like any inline glyph.
  const icon = (
    <IconifyIcon
      icon={name}
      className={className}
      width={width ?? "1em"}
      height={height ?? "1em"}
      aria-hidden={aria["aria-hidden"] ?? !aria["aria-label"]}
      aria-label={aria["aria-label"]}
      role={aria["aria-label"] ? "img" : undefined}
    />
  );
  if (!title) return icon;
  return (
    <span title={title} className="inline-flex">
      {icon}
    </span>
  );
}
