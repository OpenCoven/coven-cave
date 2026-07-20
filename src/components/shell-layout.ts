export type ShellPanelLayout = Record<string, number>;

type ResolveShellDestinationLayoutOptions = {
  panelIds: string[];
  savedLayout: ShellPanelLayout | undefined;
  groupSize: number;
  defaultPanelPixels: Partial<Record<string, number>>;
  requireOpenNav: boolean;
};

const roundPercentage = (value: number) => Number.parseFloat(value.toFixed(3));

export function resolveShellDestinationLayout({
  panelIds,
  savedLayout,
  groupSize,
  defaultPanelPixels,
  requireOpenNav,
}: ResolveShellDestinationLayoutOptions): ShellPanelLayout | undefined {
  if (
    savedLayout &&
    panelIds.every((panelId) => Number.isFinite(savedLayout[panelId])) &&
    (!requireOpenNav || (savedLayout.nav ?? 0) > 0)
  ) {
    return Object.fromEntries(panelIds.map((panelId) => [panelId, savedLayout[panelId]]));
  }

  if (!Number.isFinite(groupSize) || groupSize <= 0 || panelIds.length === 0) {
    return undefined;
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
    const flexibleSize = roundPercentage((100 - assigned) / flexiblePanelIds.length);
    for (const panelId of flexiblePanelIds) {
      layout[panelId] = flexibleSize;
    }
  }

  return layout;
}
