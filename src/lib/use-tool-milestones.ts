"use client";

import { useEffect, useRef } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import { createToolMilestoneTracker } from "./chat-tool-milestones";
import type { Turn } from "./chat-turn-state";

/** One announcement per rendered batch keeps parallel tool milestones from
 * overwriting one another in the shared live region. */
export function useToolMilestones(turn: Turn | undefined) {
  const { announce } = useAnnouncer();
  const tracker = useRef<ReturnType<typeof createToolMilestoneTracker> | null>(null);
  const queued = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnId = turn?.id;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    queued.current = [];
  }, [turnId]);
  useEffect(() => {
    tracker.current ??= createToolMilestoneTracker();
    const messages = tracker.current(turn);
    queued.current.push(...messages);
    if (!queued.current.length || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      announce(queued.current.join(" "));
      queued.current = [];
    }, 150);
  }, [turn, announce]);
}
