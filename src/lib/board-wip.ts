"use client";

import type { CardStatus } from "@/lib/cave-board-types";

// Per-status WIP (work-in-progress) limits, persisted board-wide. A status with
// no entry has no limit. Keyed by status id so it's stable across renders.
const WIP_KEY = "cave:board:wipLimits";

export type WipLimits = Partial<Record<CardStatus, number>>;

export function readWipLimits(): WipLimits {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WIP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: WipLimits = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k as CardStatus] = Math.floor(v);
    }
    return out;
  } catch {
    return {};
  }
}

export function writeWipLimits(limits: WipLimits): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WIP_KEY, JSON.stringify(limits));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

/**
 * Set or clear one status's limit. A null/0/negative/non-integer limit clears
 * it. Pure — returns a new object, never mutates the input.
 */
export function setWipLimit(limits: WipLimits, status: CardStatus, limit: number | null): WipLimits {
  const next: WipLimits = { ...limits };
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    delete next[status];
  } else {
    next[status] = Math.floor(limit);
  }
  return next;
}

export type WipState = "none" | "ok" | "over";

/** Classify a column's count against its limit (for styling). Pure. */
export function wipState(count: number, limit: number | undefined): WipState {
  if (limit == null) return "none";
  return count > limit ? "over" : "ok";
}
