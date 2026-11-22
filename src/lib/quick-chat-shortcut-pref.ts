"use client";

/**
 * The opt-in Quick Chat global shortcut (#5980): ⌘⇧Space on macOS,
 * Ctrl+Shift+Space on Windows and Linux. A global shortcut takes its key from
 * every other app while it is held, so it is off by default and only the
 * Settings toggle turns it on.
 *
 * The desktop shell registers the shortcut at launch from the saved
 * preference. The toggle asks the shell first and saves only what the shell
 * actually did, so a key already claimed by another app never shows as on.
 */

import { useSyncExternalStore } from "react";
import {
  readAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences,
} from "./app-preferences.ts";

export function quickChatShortcutLabel(mac: boolean): string {
  return mac ? "⌘⇧Space" : "Ctrl+Shift+Space";
}

export function readQuickChatShortcutEnabled(): boolean {
  return readAppPreferences().general.quickChatShortcut;
}

export function useQuickChatShortcutEnabled(): boolean {
  return useSyncExternalStore(subscribeAppPreferences, readQuickChatShortcutEnabled, () => false);
}

type SetShortcut = (enabled: boolean) => Promise<boolean>;

async function invokeSetShortcut(enabled: boolean): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("set_quick_chat_shortcut", { enabled });
}

/**
 * Ask the desktop shell to register or release the shortcut, then save the
 * state it reports. A refusal (another app holds the key) throws and leaves
 * the saved preference unchanged.
 */
export async function setQuickChatShortcutEnabled(
  enabled: boolean,
  setShortcut: SetShortcut = invokeSetShortcut,
): Promise<boolean> {
  const registered = await setShortcut(enabled);
  updateAppPreferences({ general: { quickChatShortcut: registered } });
  return registered;
}
