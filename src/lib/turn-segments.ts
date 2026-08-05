// Presentation-only grouping for compact assistant-turn tool activity.
// `textOffset` remains an optional boundary signal so same-name calls separated
// by streamed prose never collapse into one run.

export type ConsecutiveToolRun<T extends { name: string; textOffset?: number }> = {
  /** The first tool's display name, retained for the run summary. */
  name: string;
  tools: T[];
};

/**
 * Partition tool activity into maximal adjacent runs with the same name.
 *
 * This retains the original records and transcript order inside every run.
 */
export function groupConsecutiveTools<T extends { name: string; textOffset?: number }>(tools: readonly T[]): ConsecutiveToolRun<T>[] {
  const runs: ConsecutiveToolRun<T>[] = [];
  let lastKnownOffset: number | undefined;
  for (const tool of tools) {
    const normalizedName = tool.name.trim().toLowerCase();
    const previous = runs[runs.length - 1];
    const offset = Number.isFinite(tool.textOffset) ? tool.textOffset : undefined;
    const sameOffset = offset === undefined || lastKnownOffset === undefined || lastKnownOffset === offset;
    if (previous && previous.name.trim().toLowerCase() === normalizedName && sameOffset) {
      previous.tools.push(tool);
    } else {
      runs.push({ name: tool.name, tools: [tool] });
      // Keep lastKnownOffset across name changes so that offset discontinuities
      // between different tool types are detected when subsequent same-name tools appear
    }
    if (offset !== undefined) lastKnownOffset = offset;
  }
  return runs;
}
