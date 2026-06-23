"use client";

import { useState } from "react";

import { Icon } from "@/lib/icon";

/** The OpenCoven documentation site, embedded in-app. */
export const DOCS_URL = "https://docs.opencoven.ai";

/**
 * DocsPane — embeds the OpenCoven docs site (docs.opencoven.ai) inside the app
 * as a full-height iframe. The site sends no `X-Frame-Options` and no
 * frame-blocking CSP, so it frames cleanly in both the Tauri desktop webview
 * and plain web / mobile Safari. A thin header keeps an "open externally"
 * escape hatch in case the docs host ever starts refusing to be framed.
 *
 * The iframe sandbox intentionally omits `allow-top-navigation` so the framed
 * docs can never navigate the whole app away from itself; `allow-popups` lets
 * external links in the docs open in a new tab as usual.
 */
export function DocsPane() {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2">
        <Icon name="ph:book-bookmark" width={16} height={16} aria-hidden />
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">Docs</span>
        <span className="truncate text-[12px] text-[var(--text-muted)]">docs.opencoven.ai</span>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ui-btn ui-btn--ghost ui-btn--sm focus-ring ml-auto"
        >
          <Icon name="ph:arrow-square-out" width={14} height={14} aria-hidden />
          Open
        </a>
      </div>
      <div className="relative min-h-0 flex-1">
        {!loaded ? (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--text-muted)]">
            Loading docs…
          </div>
        ) : null}
        <iframe
          src={DOCS_URL}
          title="Documentation"
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 h-full w-full border-0 bg-[var(--bg-base)]"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
