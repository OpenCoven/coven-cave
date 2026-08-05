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
  for (const tool of tools) {
    const normalizedName = tool.name.trim().toLowerCase();
    const previous = runs[runs.length - 1];
    const previousTool = previous?.tools[previous.tools.length - 1];
    const bothOffsetsKnown = Number.isFinite(previousTool?.textOffset) && Number.isFinite(tool.textOffset);
    const sameOffset = !bothOffsetsKnown || previousTool?.textOffset === tool.textOffset;
    if (previous && previous.name.trim().toLowerCase() === normalizedName && sameOffset) {
      previous.tools.push(tool);
    } else {
      runs.push({ name: tool.name, tools: [tool] });
    }
  }
  return runs;
}
