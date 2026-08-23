"use client";

import "@/styles/artifact-source-view.css";

import { useEffect, useMemo, useState } from "react";
import { highlightToHtml } from "@/components/message-bubble";
import { artifactSource } from "@/lib/artifact-source";
import type { ArtifactKind } from "@/lib/canvas-artifacts";

export function ArtifactSourceView({
  code,
  kind,
  ariaLabel,
  className,
}: {
  code: string;
  kind?: ArtifactKind;
  ariaLabel: string;
  className?: string;
}): React.JSX.Element {
  const source = useMemo(() => artifactSource(code, kind), [code, kind]);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    void highlightToHtml(source.code, source.language)
      .then((highlighted) => {
        if (!cancelled) setHtml(highlighted);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const rootClassName = [
    "artifact-source-view",
    className ?? "",
  ].join(" ");

  return (
    <div className={rootClassName}>
      <div className="artifact-source-view__head">
        <span className="artifact-source-view__title">Source</span>
        <span className="artifact-source-view__language">{source.label}</span>
      </div>
      {html ? (
        <div
          className="artifact-source-view__scroll artifact-source-view__scroll--highlighted"
          role="region"
          aria-label={ariaLabel}
          tabIndex={0}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre
          className="artifact-source-view__scroll"
          role="region"
          aria-label={ariaLabel}
          tabIndex={0}
        >
          <code>{source.code}</code>
        </pre>
      )}
    </div>
  );
}
