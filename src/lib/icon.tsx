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
  "ph:arrow-up",
  "ph:arrow-up-bold",
  "ph:arrow-bend-up-right",
  "ph:arrows-clockwise-bold",
  "ph:arrows-in-simple",
  "ph:arrows-out-simple",
  "ph:at",
  "ph:bell-fill",
  "ph:bell-slash",
  "ph:bell-slash-fill",
  "ph:cat",
  "ph:camera",
  "ph:caret-down",
  "ph:funnel",
  "ph:funnel-fill",
  "ph:rows",
  "ph:columns",
  "ph:caret-up-down",
  "ph:caret-up-down-bold",
  "ph:caret-up",
  "ph:caret-down-fill",
  "ph:check",
  "ph:caret-left",
  "ph:caret-right",
  "ph:caret-right-bold",
  "ph:chat-circle-dots",
  "ph:chat-circle-dots-bold",
  "ph:chat-circle-dots-fill",
  "ph:check-bold",
  "ph:circle",
  "ph:circle-fill",
  "ph:gear-six",
  "ph:gear-six-bold",
  "ph:hand",
  "ph:heartbeat",
  "ph:kanban",
  "ph:magic-wand-fill",
  "ph:magnifying-glass",
  "ph:magnifying-glass-bold",
  "ph:minus",
  "ph:note-pencil",
  "ph:plug",
  "ph:plug-bold",
  "ph:list-bullets-bold",
  "ph:mask-happy",
  "ph:cursor-click",
  "ph:check-circle",
  "ph:warning",
  "ph:warning-circle",
  "ph:paperclip",
  "ph:plus",
  "ph:plus-bold",
  "ph:arrows-clockwise",
  "ph:share-network",
  "ph:vault",
  "ph:check-circle",
  "ph:key",
  "ph:issue-opened",
  "ph:chat-teardrop-dots-bold",
  "ph:dots-three-bold",
  "ph:sliders-bold",
  "ph:sparkle",
  "ph:tray",
  "ph:translate",
  "ph:wrench-bold",
  "ph:wrench",
  "ph:brain",
  "ph:x",
  "ph:x-bold",
  "ph:x-circle-fill",
  "ph:arrow-square-out",
  "ph:arrow-left",
  "ph:sliders-horizontal",
  "ph:users-three",
  "ph:paint-brush",
  "ph:info",
  "ph:arrow-square-out-bold",
  "ph:arrow-left-bold",
  "ph:arrow-right-bold",
  "ph:house-bold",
  "ph:lock-simple-bold",
  "ph:clock",
  "ph:globe",
  "ph:graph",
  "ph:squares-four",
  "ph:sidebar-simple",
  "ph:sidebar-simple-fill",
  "ph:folder",
  "ph:folder-open",
  "ph:folder-open-bold",
  "ph:folder-simple-dashed",
  "ph:folders-bold",
  "ph:calendar-blank",
  "ph:caret-down-bold",
  "ph:puzzle-piece-bold",
  "ph:puzzle-piece",
  "ph:sparkle-bold",
  "ph:bell-bold",
  "ph:phone",
  "ph:warning-fill",
  "ph:check",
  "ph:copy",
  "ph:caret-left",
  "ph:caret-right",
  "ph:caret-down",
  "ph:funnel",
  "ph:funnel-fill",
  "ph:rows",
  "ph:columns",
  "ph:caret-up-down",
  "ph:caret-up",
  "ph:caret-down-fill",
  "ph:check",
  "ph:file",
  "ph:file-code",
  "ph:file-bold",
  "ph:file-text",
  "ph:flask",
  "ph:book-bookmark",
  "ph:robot",
  "ph:clipboard-text",
  "ph:lock-simple",
  "ph:file-image",
  "ph:arrow-up-bold",
  "ph:arrow-bend-up-right",
  "ph:arrow-clockwise",
  "ph:terminal-window",
  "ph:chats-circle",
  "ph:pencil-simple",
  "ph:list-bullets",
  "ph:trash",
  "ph:trash-bold",
  "ph:github-logo",
  "ph:butterfly",
  "ph:telegram-logo",
  "ph:discord-logo",
  "ph:tiktok-logo",
  "ph:instagram-logo",
  "ph:linkedin-logo",
  "ph:twitter-logo",
  "ph:sun",
  "ph:moon",
  "ph:bell",
  "ph:book-open-bold",
  "ph:book-open",
  "ph:books",
  "ph:pencil-line-bold",
  "ph:brain-bold",
  "ph:chats",
  "ph:user",
  "ph:plus",
  "ph:plus-bold",
  "ph:circle-notch-bold",
  "ph:toggle-left-bold",
  "ph:toggle-right-bold",
  "ph:rocket-launch-bold",
  "ph:info-bold",
  "ph:x-bold",
  "ph:tag-bold",
  "ph:dots-three-vertical",
  "ph:archive",
  "ph:flame",
  "ph:arrow-counter-clockwise",
  "ph:bookmark-simple",
  "ph:bookmark-simple-fill",
  "ph:link",
  "ph:link-simple",
  "ph:git-pull-request",
  "ph:git-merge",
  "ph:git-diff",
  "ph:code",
  "ph:video",
  "ph:newspaper",
  "ph:graduation-cap",
  "ph:chat-centered-text",
  "ph:dots-three",
  "ph:minus-circle",
  "ph:arrow-down-bold",
  "ph:list-checks-bold",
  "ph:pencil-bold",
  "ph:rocket-bold",
  "ph:arrow-clockwise-bold",
  "ph:x-logo-bold",
  "ph:pen-nib-bold",
  "ph:note-bold",
  "ph:slack-logo-bold",
  "ph:discord-logo-bold",
  "ph:telegram-logo-bold",
  "ph:envelope-bold",
  "ph:calendar-bold",
  "ph:globe-bold",
  "ph:file-text-bold",
  "ph:image-bold",
  "ph:waveform-bold",
  "ph:video-bold",
  "ph:database-bold",
  "ph:cloud-arrow-up-bold",
  "ph:check-circle-bold",
  "ph:kanban-bold",
  "ph:terminal-bold",
  "ph:package-bold",
  "ph:cube-bold",
  "ph:cloud-bold",
  "ph:chart-bar-bold",
  "ph:share-network-bold",
  "ph:git-pull-request-bold",
  "ph:mask-happy-bold",
  "ph:clock-bold",
  "ph:key-bold",
  "ph:graph-bold",
  "ph:users-three-bold",
  "ph:books-bold",
  "ph:sliders-horizontal-bold",
  "ph:paperclip-bold",
  "ph:bug-bold",
  "ph:chat-teardrop-text-bold",
  "ph:chat-teardrop",
  "ph:circle-dashed",
  "ph:circles-three-plus",
  "ph:clock-countdown",
  "ph:bounding-box",
  "ph:git-fork-bold",
  "ph:user-bold",
  "ph:terminal-window-bold",
  "ph:git-branch-bold",
  "ph:lightning-bold",
  "ph:floppy-disk-bold",
  "ph:lightning-fill",
  "ph:paw-print-bold",
  "ph:code-bold",
  "ph:hand-bold",
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
