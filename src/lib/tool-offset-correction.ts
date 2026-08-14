import type { ToolOffsetCorrection } from "./stream-events";

type ToolWithTextOffset = {
  textOffset?: number;
};

export function rebaseToolTextOffsets<T extends ToolWithTextOffset>(
  tools: T[] | undefined,
  correction: ToolOffsetCorrection | null | undefined,
): T[] | undefined {
  if (
    !tools ||
    !correction ||
    !Number.isSafeInteger(correction.after) ||
    correction.after < 0 ||
    !Number.isSafeInteger(correction.delta) ||
    correction.delta === 0
  ) {
    return tools;
  }

  let changed = false;
  const rebased = tools.map((tool) => {
    if (!Number.isFinite(tool.textOffset) || tool.textOffset! < correction.after) {
      return tool;
    }
    const textOffset = Math.max(correction.after, tool.textOffset! + correction.delta);
    if (textOffset === tool.textOffset) return tool;
    changed = true;
    return { ...tool, textOffset };
  });
  return changed ? rebased : tools;
}
