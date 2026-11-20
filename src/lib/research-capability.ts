export type ResearchCapability = {
  available: boolean;
  enabled: boolean;
  reason: 'available' | 'not-installed' | 'disabled';
};

export function resolveResearchCapability(available: boolean, setting?: string): ResearchCapability {
  const disabled = setting?.trim().toLowerCase();
  const enabled = available && disabled !== '0' && disabled !== 'false' && disabled !== 'off';
  return { available, enabled, reason: !available ? 'not-installed' : enabled ? 'available' : 'disabled' };
}

/** Installation is fixed at build time; activation is controlled by the server. */
export function researchCapability(): ResearchCapability {
  return resolveResearchCapability(
    process.env.COVEN_RESEARCH_PACKAGE_AVAILABLE === '1',
    process.env.COVEN_RESEARCH_ENABLED,
  );
}
