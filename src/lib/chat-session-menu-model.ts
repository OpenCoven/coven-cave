// Pure model for the chat session header's action cluster (cave-zolo).
//
// The header splits session actions into two tiers:
//  - DIRECT actions — high-frequency / lifecycle verbs (voice call, archive,
//    delete) rendered as icon buttons in the header cluster, so they are no
//    longer buried behind the ⋮ kebab.
//  - OVERFLOW items — the kebab menu, now slimmed to genuinely secondary
//    tools (continue on phone, project, thinking, reflect, debug). Items that
//    gained a direct affordance (archive, delete, call) and duplicates of
//    inline affordances (rename — the title carries a pencil) are gone.
//
// Framework-free so the item lists are testable under
// `node --experimental-strip-types` without rendering React.

import type { IconName } from "@/lib/icon";

export type SessionMenuItemId =
  | "continue-on-phone"
  | "project"
  | "thinking"
  | "reflect"
  | "debug";

export type SessionMenuItem = {
  id: SessionMenuItemId;
  label: string;
  icon: IconName;
  /** Renders the Popover checkmark slot (toggle items). */
  checked?: boolean;
  disabled?: boolean;
  /** Hover tooltip when the label alone is terse. */
  title?: string;
};

export type SessionMenuSection = SessionMenuItem[];

export function sessionMenuSections(ctx: {
  sessionId: string | null;
  /** Whether a project row makes sense (projects exist or add-project is wired). */
  projectPickerAvailable: boolean;
  /** Active project display name; null → "No project". */
  projectName: string | null;
  /** Root path of the active project (tooltip). */
  projectRoot: string | null;
  hasTurns: boolean;
  showThinking: boolean;
  /** Reflect-on-thread is wired (familiar has an id). */
  reflectAvailable: boolean;
  reflecting: boolean;
}): SessionMenuSection[] {
  const primary: SessionMenuItem[] = [];
  if (ctx.sessionId) {
    primary.push({
      id: "continue-on-phone",
      label: "Continue on phone",
      icon: "ph:device-mobile",
    });
  }
  if (ctx.projectPickerAvailable) {
    primary.push({
      id: "project",
      label: `Project: ${ctx.projectName ?? "No project"}`,
      icon: "ph:folder",
      title: ctx.projectRoot ?? "No project",
    });
  }

  const tools: SessionMenuItem[] = [];
  if (ctx.hasTurns) {
    tools.push({
      id: "thinking",
      label: ctx.showThinking ? "Hide thinking" : "Show thinking",
      icon: ctx.showThinking ? "ph:brain-bold" : "ph:brain",
      checked: ctx.showThinking,
      title: ctx.showThinking ? "Hide reasoning blocks" : "Show reasoning blocks",
    });
  }
  if (ctx.reflectAvailable) {
    tools.push({
      id: "reflect",
      label: ctx.reflecting ? "Reflecting…" : "Reflect on this thread",
      icon: ctx.reflecting ? "ph:circle-notch-bold" : "ph:sparkle-bold",
      disabled: ctx.reflecting,
    });
  }
  tools.push({ id: "debug", label: "Debug session", icon: "ph:bug-bold" });

  return [primary, tools].filter((section) => section.length > 0);
}

/** Direct archive button — flips verb on archived sessions instead of hiding,
 *  so restore is one click from the header too (the kebab no longer carries
 *  Archive/Unarchive). */
export function archiveAction(ctx: { archived: boolean; archiving: boolean }): {
  icon: IconName;
  label: string;
  title: string;
} {
  if (ctx.archived) {
    return {
      icon: "ph:arrow-counter-clockwise",
      label: ctx.archiving ? "Unarchiving chat…" : "Unarchive this chat",
      title: "Restore this chat to the rail",
    };
  }
  return {
    icon: "ph:archive",
    label: ctx.archiving ? "Archiving chat…" : "Archive this chat",
    title: "Archive this chat — it leaves the rail but is never deleted",
  };
}

/** Direct voice-call button state — mirrors the old kebab item's gating:
 *  disabled until the familiar has a voice provider, and while a call runs. */
export function voiceAction(ctx: {
  voiceConfigured: boolean;
  voiceActive: boolean;
  familiarName: string;
}): { disabled: boolean; label: string } {
  if (!ctx.voiceConfigured) {
    return { disabled: true, label: "Voice — set up in Studio" };
  }
  if (ctx.voiceActive) {
    return { disabled: true, label: `Call ${ctx.familiarName} — call in progress` };
  }
  return { disabled: false, label: `Call ${ctx.familiarName}` };
}
