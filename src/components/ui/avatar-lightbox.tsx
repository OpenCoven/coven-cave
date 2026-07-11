"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "./modal";

type AvatarLightboxProps = {
  /** The small inline avatar to render as the clickable trigger (an <img> or
   *  monogram tile). The caller owns its markup and sizing — this only adds the
   *  zoom affordance and the enlarged view. */
  children: ReactNode;
  /** Full-resolution image src shown enlarged inside the lightbox. */
  src: string;
  /** Subject name — drives the trigger aria-label, breadcrumb, and alt text
   *  (e.g. "Nova", a project name, or the operator's display name). */
  label: string;
  /** Breadcrumb tail and alt qualifier. Defaults to "Avatar". */
  category?: string;
  /** Optional footer actions inside the modal — e.g. an "Edit in Settings →"
   *  link for the operator avatar, whose click previously navigated to
   *  settings. Keeps that path discoverable without stealing the primary
   *  click, which now enlarges like every other avatar surface. */
  footerActions?: ReactNode;
};

/**
 * Shared "peek at the avatar" lightbox. Wrap any avatar image in this to make a
 * click enlarge it into a focus-trapped Modal (Esc / backdrop dismiss handled
 * by Modal). One gesture across every avatar surface — familiar, project, and
 * the operator's own — so behaviour and a11y stay identical everywhere. This is
 * the single home for the pattern; callers must not hand-roll their own
 * button + Modal.
 */
export function AvatarLightbox({
  children,
  src,
  label,
  category = "Avatar",
  footerActions,
}: AvatarLightboxProps) {
  const [enlarged, setEnlarged] = useState(false);
  const noun = category.toLowerCase();

  return (
    <>
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        className="cave-avatar-lightbox-trigger focus-ring"
        aria-label={`Enlarge ${label} ${noun}`}
        title="Click to enlarge"
      >
        {children}
      </button>
      {enlarged ? (
        <Modal
          open
          onClose={() => setEnlarged(false)}
          breadcrumb={[label, category]}
          footerActions={footerActions}
        >
          <div className="grid aspect-square w-full max-w-[320px] place-items-center overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)]">
            <img src={src} alt={`${label} ${noun}`} className="h-full w-full object-cover" />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
