import type { FlowRunRecord } from "@/lib/flows";

export function flowRunDurationLabel(run: FlowRunRecord, now = new Date()): string | null {
  const startedAt = Date.parse(run.startedAt);
  const finishedAt = run.finishedAt ? Date.parse(run.finishedAt) : now.getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return null;
  const totalSeconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}
