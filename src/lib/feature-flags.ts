function envFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function caveChatoutCodex(): boolean {
  return envFlag(process.env.NEXT_PUBLIC_CAVE_CHATOUT_CODEX);
}

/** Crafts stay implemented but are hidden until an operator explicitly enables
 * them for the running Cave instance. */
export function caveCrafts(): boolean {
  return envFlag(process.env.NEXT_PUBLIC_CAVE_CRAFTS);
}

/** Agentic Board recommendations stay gated while Research topic assistance
 * and legacy Chat Enhance remain available independently. */
export function caveAgenticRecommendations(): boolean {
  return envFlag(process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS);
}

/** Root rollout gate for the Cave-owned local Research Resource catalog. */
export function caveResearchResources(): boolean {
  return envFlag(process.env.NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES);
}

/** Local ingestion cannot run without the authoritative resource catalog. */
export function caveResearchLocalIngestion(): boolean {
  return caveResearchResources()
    && envFlag(process.env.NEXT_PUBLIC_CAVE_RESEARCH_LOCAL_INGESTION);
}

/** Semantic retrieval is optional and never gates lexical resource search. */
export function caveResearchSemantic(): boolean {
  return caveResearchLocalIngestion()
    && envFlag(process.env.NEXT_PUBLIC_CAVE_RESEARCH_SEMANTIC);
}

/** Context Packs depend on local resources, but not on semantic retrieval. */
export function caveResearchContextPacks(): boolean {
  return caveResearchResources()
    && envFlag(process.env.NEXT_PUBLIC_CAVE_RESEARCH_CONTEXT_PACKS);
}

/**
 * Browser-capable resource preview: loading a resource's source URL in the
 * Research Desk browser modal. This is rollout availability only: callers
 * must separately prove an explicitly selected Context Pack's
 * `consent.allowRemoteContent`. The flag never substitutes for consent and
 * still requires the authoritative resource catalog (cave-m13fh).
 */
export function caveResearchRemoteContent(): boolean {
  return caveResearchResources()
    && envFlag(process.env.NEXT_PUBLIC_CAVE_RESEARCH_REMOTE_CONTENT);
}

/** Topic Discovery cannot run until Context Packs are available. */
export function caveResearchTopicDiscovery(): boolean {
  return caveResearchContextPacks()
    && envFlag(process.env.NEXT_PUBLIC_CAVE_RESEARCH_TOPIC_DISCOVERY);
}

/**
 * Hosted runs fail closed until Gate C0 supplies a server-only authority that
 * can prove cloud account, repository, bindings, and authentication-policy
 * readiness. The public environment variable records rollout intent only and
 * cannot enable this getter in A1.
 */
export function caveResearchHostedRuns(): boolean {
  return false;
}
