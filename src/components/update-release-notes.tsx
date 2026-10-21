"use client";

import "@/styles/update-release-notes.css";

/** Release text is untrusted. React escapes it; no HTML/Markdown execution. */
export function UpdateReleaseNotes({ notes }: { notes?: string }) {
  if (typeof notes !== "string" || !notes.trim()) return null;
  return (
    <details className="update-release-notes">
      <summary className="focus-ring">Release notes</summary>
      <div className="update-release-notes__text" tabIndex={0} role="region" aria-label="Release notes">
        {notes}
      </div>
    </details>
  );
}
