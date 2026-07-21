export type ShellPanelLayout = Record<string, number>;

type ResolveShellDestinationLayoutOptions = {
  panelIds: string[];
  savedLayout: ShellPanelLayout | undefined;
  groupSize: number;
  defaultPanelPixels: Partial<Record<string, number>>;
  collapsedNavPixels: number;
  isMobile: boolean;
};

const roundPercentage = (value: number) => Number.parseFloat(value.toFixed(3));
const LAYOUT_SUM_TOLERANCE = 0.1;
const COLLAPSED_PIXEL_TOLERANCE = 1;

function isCompleteLayout(
  layout: ShellPanelLayout,
  panelIds = Object.keys(layout),
): boolean {
  if (
    panelIds.length < 2 ||
    !panelIds.every(
      (panelId) =>
        typeof layout[panelId] === "number" &&
        Number.isFinite(layout[panelId]) &&
        layout[panelId] >= 0,
    )
  ) {
    return false;
  }
  const sum = panelIds.reduce((total, panelId) => total + layout[panelId], 0);
  return Math.abs(sum - 100) <= LAYOUT_SUM_TOLERANCE;
}

export function shouldPersistShellLayout({
  isMobile,
  navCollapsed,
  layout,
}: {
  isMobile: boolean;
  navCollapsed: boolean;
  layout: ShellPanelLayout;
}): boolean {
  return !isMobile && !navCollapsed && isCompleteLayout(layout);
}

export function resolveShellDestinationLayout({
  panelIds,
  savedLayout,
  groupSize,
  defaultPanelPixels,
  collapsedNavPixels,
  isMobile,
}: ResolveShellDestinationLayoutOptions): ShellPanelLayout | undefined {
  if (
    isMobile ||
    !Number.isFinite(groupSize) ||
    groupSize <= 0 ||
    panelIds.length === 0
  ) {
    return undefined;
  }

  const savedNavPixels = ((savedLayout?.nav ?? 0) / 100) * groupSize;
  if (
    savedLayout &&
    isCompleteLayout(savedLayout, panelIds) &&
    savedNavPixels > collapsedNavPixels + COLLAPSED_PIXEL_TOLERANCE
  ) {
    return Object.fromEntries(panelIds.map((panelId) => [panelId, savedLayout[panelId]]));
  }

  const layout: ShellPanelLayout = {};
  const flexiblePanelIds: string[] = [];
  let assigned = 0;

  for (const panelId of panelIds) {
    const defaultPixels = defaultPanelPixels[panelId];
    if (typeof defaultPixels === "number" && Number.isFinite(defaultPixels)) {
      const percentage = roundPercentage((defaultPixels / groupSize) * 100);
      layout[panelId] = percentage;
      assigned += percentage;
    } else {
      flexiblePanelIds.push(panelId);
    }
  }

  if (flexiblePanelIds.length > 0) {
    if (assigned >= 100) return undefined;
    const flexibleSize = roundPercentage((100 - assigned) / flexiblePanelIds.length);
    for (let index = 0; index < flexiblePanelIds.length; index += 1) {
      const panelId = flexiblePanelIds[index];
      layout[panelId] =
        index === flexiblePanelIds.length - 1
          ? roundPercentage(100 - assigned - flexibleSize * index)
          : flexibleSize;
    }
  }

  return isCompleteLayout(layout, panelIds) ? layout : undefined;
}
