export type ShellPanelLayout = Record<string, number>;

export const SHELL_NAV_MIN_PX = 220;
export const SHELL_NAV_MAX_PX = 420;
export const SHELL_NAV_DEFAULT_PX = 240;

type ResolveShellDestinationLayoutOptions = {
  panelIds: string[];
  savedLayout: ShellPanelLayout | undefined;
  groupSize: number;
  defaultPanelPixels: Partial<Record<string, number>>;
  preferredNavPixels: number;
  collapsedNavPixels: number;
  isMobile: boolean;
};

const roundPercentage = (value: number) => Number.parseFloat(value.toFixed(3));
const LAYOUT_SUM_TOLERANCE = 0.1;
const COLLAPSED_PIXEL_TOLERANCE = 1;

export function resolveShellNavWidth(raw: string | null): number {
  if (raw === null || raw.trim() === "") return SHELL_NAV_DEFAULT_PX;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return SHELL_NAV_DEFAULT_PX;

  return Math.min(SHELL_NAV_MAX_PX, Math.max(SHELL_NAV_MIN_PX, parsed));
}

export function resolveShellNavOpenPreference(
  persistedOpen: boolean | null,
  defaultOpen: boolean,
): { open: boolean; shouldPersist: boolean } {
  return persistedOpen === null
    ? { open: defaultOpen, shouldPersist: true }
    : { open: persistedOpen, shouldPersist: false };
}

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

export function isShellNavCollapsedLayout({
  layout,
  panelIds,
  groupSize,
  collapsedNavPixels,
}: {
  layout: ShellPanelLayout | undefined;
  panelIds: string[];
  groupSize: number;
  collapsedNavPixels: number;
}): boolean {
  if (
    !layout ||
    !isCompleteLayout(layout, panelIds) ||
    !Number.isFinite(groupSize) ||
    groupSize <= 0
  ) {
    return false;
  }
  return ((layout.nav ?? 0) / 100) * groupSize <=
    collapsedNavPixels + COLLAPSED_PIXEL_TOLERANCE;
}

export function resolveShellLayoutPersistence({
  isMobile,
  navCollapsed,
  layout,
  savedExpandedLayout,
  previousCollapsedLayout,
}: {
  isMobile: boolean;
  navCollapsed: boolean;
  layout: ShellPanelLayout;
  savedExpandedLayout: ShellPanelLayout | undefined;
  previousCollapsedLayout?: ShellPanelLayout;
}): ShellPanelLayout | undefined {
  const panelIds = Object.keys(layout);
  if (isMobile || !isCompleteLayout(layout, panelIds)) return undefined;
  if (!navCollapsed) {
    return Object.fromEntries(panelIds.map((panelId) => [panelId, layout[panelId]]));
  }
  if (
    !savedExpandedLayout ||
    !isCompleteLayout(savedExpandedLayout, panelIds) ||
    savedExpandedLayout.nav <= layout.nav + LAYOUT_SUM_TOLERANCE
  ) {
    return undefined;
  }

  const saved = Object.fromEntries(
    panelIds.map((panelId) => [panelId, savedExpandedLayout[panelId]]),
  );
  // The first collapsed callback only establishes a baseline. Later callbacks
  // apply list-like panel deltas to the saved expanded layout; detail remains
  // the flexible remainder and the expanded nav width never changes.
  if (!previousCollapsedLayout || !isCompleteLayout(previousCollapsedLayout, panelIds)) {
    return saved;
  }

  const merged = { ...saved };
  let assigned = merged.nav;
  for (const panelId of panelIds) {
    if (panelId === "nav" || panelId === "detail") continue;
    merged[panelId] = roundPercentage(
      saved[panelId] + layout[panelId] - previousCollapsedLayout[panelId],
    );
    assigned += merged[panelId];
  }
  merged.detail = roundPercentage(100 - assigned);
  return isCompleteLayout(merged, panelIds) ? merged : saved;
}

export function resolveShellDestinationLayout({
  panelIds,
  savedLayout,
  groupSize,
  defaultPanelPixels,
  preferredNavPixels,
  collapsedNavPixels,
  isMobile,
}: ResolveShellDestinationLayoutOptions): ShellPanelLayout | undefined {
  if (
    isMobile ||
    !Number.isFinite(groupSize) ||
    groupSize <= 0 ||
    panelIds.length === 0 ||
    !Number.isFinite(preferredNavPixels)
  ) {
    return undefined;
  }

  const savedLayoutIsComplete =
    savedLayout !== undefined && isCompleteLayout(savedLayout, panelIds);
  const savedNavIsCollapsed = isShellNavCollapsedLayout({
    layout: savedLayout,
    panelIds,
    groupSize,
    collapsedNavPixels,
  });
  const navPercentage = roundPercentage((preferredNavPixels / groupSize) * 100);

  const resolveLayout = (
    preserveSavedNonNavPanels: boolean,
  ): ShellPanelLayout | undefined => {
    const layout: ShellPanelLayout = {};
    const flexiblePanelIds: string[] = [];
    let assigned = navPercentage;

    for (const panelId of panelIds) {
      if (panelId === "nav" || panelId === "detail") continue;

      if (preserveSavedNonNavPanels) {
        layout[panelId] = savedLayout![panelId];
        assigned += layout[panelId];
        continue;
      }

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
      const flexibleSize = roundPercentage(
        (100 - assigned) / (flexiblePanelIds.length + 1),
      );
      for (const panelId of flexiblePanelIds) {
        layout[panelId] = flexibleSize;
        assigned += flexibleSize;
      }
    }

    const detailPercentage = roundPercentage(100 - assigned);
    if (detailPercentage <= 0) return undefined;
    layout.nav = navPercentage;
    layout.detail = detailPercentage;

    return isCompleteLayout(layout, panelIds) ? layout : undefined;
  };

  const preserveSavedNonNavPanels = savedLayoutIsComplete && !savedNavIsCollapsed;
  return (
    (preserveSavedNonNavPanels && resolveLayout(true)) ||
    resolveLayout(false)
  );
}
