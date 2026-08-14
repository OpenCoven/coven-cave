export const SPLIT_TABS_MAX_WIDTH = 719;

export type HalfSplitGeometry = {
  left: number;
  separator: number;
  right: number;
};

export function halfSplitGeometry(hostWidth: number, separator: number): HalfSplitGeometry {
  const normalizedHostWidth = Math.max(0, Math.round(hostWidth));
  const normalizedSeparator = Math.min(normalizedHostWidth, Math.max(0, Math.round(separator)));
  const usableWidth = normalizedHostWidth - normalizedSeparator;
  const left = Math.floor(usableWidth / 2);

  return {
    left,
    separator: normalizedSeparator,
    right: usableWidth - left,
  };
}

export function splitPresentation(hostWidth: number): "panes" | "tabs" {
  return hostWidth <= SPLIT_TABS_MAX_WIDTH ? "tabs" : "panes";
}
