"use client";

import { Icon as IconifyIcon, addCollection } from "@iconify/react";
import phCollection from "@iconify-json/ph/icons.json";

let registered = false;
function ensureRegistered() {
  if (registered) return;
  addCollection(phCollection as Parameters<typeof addCollection>[0]);
  registered = true;
}

/**
 * Every Phosphor icon used in the cave. Keep this list narrow on purpose —
 * adding a name here is a deliberate review point, and `IconName` makes the
 * Icon component reject typos at compile time so `pnpm build` is the test.
 *
 * If you need a new icon: confirm it exists in Phosphor
 * (https://phosphoricons.com/), add it here, then reference it in your
 * component as `<Icon name="ph:my-new-icon" />`.
 */
export const ICON_NAMES = [
  "ph:alarm-bold",
  "ph:alarm-fill",
  "ph:arrows-clockwise-bold",
  "ph:bell-fill",
  "ph:caret-down",
  "ph:caret-right-bold",
  "ph:chat-circle-dots",
  "ph:chat-circle-dots-bold",
  "ph:chat-circle-dots-fill",
  "ph:check-bold",
  "ph:circle",
  "ph:circle-fill",
  "ph:gear-six",
  "ph:gear-six-bold",
  "ph:kanban",
  "ph:magic-wand-fill",
  "ph:magnifying-glass",
  "ph:magnifying-glass-bold",
  "ph:note-pencil",
  "ph:plug",
  "ph:tray",
  "ph:wrench-bold",
  "ph:x-bold",
  "ph:x-circle-fill",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

type IconProps = {
  name: IconName;
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
