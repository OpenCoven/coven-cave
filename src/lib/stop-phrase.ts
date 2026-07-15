"use client";

/**
 * Global stop phrase — a safety valve for running chat tasks.
 *
 * While a familiar is mid-task the composer normally swallows plain sends
 * (CHAT-D5-01 keeps the draft intact instead of destroying it). Typing the
 * configured stop phrase is the exception: it is treated as a command, not a
 * prompt — the running turn is cancelled exactly as if the Stop button were
 * pressed. The phrase lives in the synced preferences file
 * (`general.stopPhrase`, default "stop"); Settings → General owns the input.
 * Clearing the phrase disables the interception entirely.
 *
 * Matching is deliberately exact (after normalization): "stop" halts the
 * task, but "stop using tabs" is an instruction for the model and must never
 * be intercepted.
 */

import { useSyncExternalStore } from "react";

import {
  readAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences,
} from "./app-preferences.ts";
import { DEFAULT_STOP_PHRASE } from "./preferences-schema.ts";

export { DEFAULT_STOP_PHRASE };

/** Longest phrase the preference stores; also bounds matcher inputs. */
export const STOP_PHRASE_MAX_LENGTH = 64;

/**
 * Canonical form used on both sides of the comparison: lowercase, collapsed
 * whitespace, and trailing sentence punctuation dropped so "Stop!" and
 * "stop." still read as the bare phrase.
 */
export function normalizeStopUtterance(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?…]+$/u, "")
    .trim();
}

/**
 * True when `text` IS the stop phrase (not merely contains it). An empty or
 * unset phrase never matches — that is the off switch.
 */
export function matchesStopPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeStopUtterance(phrase);
  if (!normalizedPhrase) return false;
  if (typeof text !== "string" || text.length > STOP_PHRASE_MAX_LENGTH * 4) return false;
  return normalizeStopUtterance(text) === normalizedPhrase;
}

const listeners = new Set<() => void>();
let cached: string | null = null;

function notify() {
  for (const fn of listeners) fn();
}

export function readStopPhrase(): string {
  if (cached === null) cached = readAppPreferences().general.stopPhrase;
  return cached;
}

export function writeStopPhrase(phrase: string) {
  const next = phrase.trim().slice(0, STOP_PHRASE_MAX_LENGTH);
  cached = next;
  updateAppPreferences({ general: { stopPhrase: next } });
  notify();
}

subscribeAppPreferences(() => {
  cached = null;
  notify();
});

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Live view of the phrase — re-renders subscribers when Settings edits it. */
export function useStopPhrase(): string {
  return useSyncExternalStore(subscribe, readStopPhrase, () => DEFAULT_STOP_PHRASE);
}
