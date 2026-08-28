/**
 * Research Desk — browser-capable resource preview support.
 *
 * The Research policy treats resource text as untrusted data and gates any
 * remote content behind the Context Pack consent model
 * (`consent.allowRemoteContent` — see `src/lib/research-protocol/context-pack.ts`).
 * These helpers mirror that model for the client-side browser view: the
 * browser-capable source URL is resolved from the durable manifest, and remote
 * loading is opt-in and fail-closed.
 */

import { paperArxivUrl } from "./research-paper-view.ts";
import type { ResourceManifestV1 } from "./research-resource-contracts.ts";

/** The slice of the Context Pack consent that gates the browser view. */
export type ResearchRemoteContentConsent = {
  /** Mirrors `ContextPackConsentV1.allowRemoteContent`. */
  allowRemoteContent: boolean;
};

/**
 * Fail-closed: remote content loads only when consent is present AND explicit.
 * A missing or malformed consent object never opens the browser pane, matching
 * the protocol's `privacy.remoteContent`-vs-consent check in `research-run.ts`.
 */
export function remoteContentAllowed(
  consent: Pick<ResearchRemoteContentConsent, "allowRemoteContent"> | undefined,
): boolean {
  return consent?.allowRemoteContent === true;
}

/**
 * The browser-capable source URL for a durable resource: the explicit source
 * URI wins, then the legacy saved-link URL, then the paper's arXiv landing
 * page. Returns null when the resource has no remote source to open (for
 * example a local-file resource whose content lives only in its local
 * snapshot).
 */
export function researchResourceSourceUrl(resource: ResourceManifestV1): string | null {
  if (resource.sourceUri) return resource.sourceUri;
  if (resource.legacySavedLink?.url) return resource.legacySavedLink.url;
  if (resource.paper?.arxivId) return paperArxivUrl(resource.paper.arxivId);
  return null;
}
