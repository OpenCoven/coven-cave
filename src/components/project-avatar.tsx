"use client";

import { useEffect, useState } from "react";
import { AvatarLightbox } from "./ui/avatar-lightbox";
import { useProjectImages } from "@/lib/cave-project-images";
import { normalizeProjectRoot } from "@/lib/cave-projects-types";
import { projectMonogram, projectTint } from "@/lib/comux-projects";

const PX = { sm: 16, md: 20, lg: 28, xl: 44 } as const;

/**
 * A project's visual identity: the user-uploaded image when one is set,
 * otherwise a colour-tinted monogram tile — the same deterministic tile comux
 * rows have always rendered, so a project looks identical everywhere. The
 * span is decorative (aria-hidden): every call site renders the project name
 * right next to it.
 */
export function ProjectAvatar({
  name,
  root,
  color,
  size = "md",
  className,
  expandable,
}: {
  name: string;
  root?: string | null;
  color?: string | null;
  size?: keyof typeof PX;
  className?: string;
  /** When true and an uploaded image is set, clicking the avatar opens the
   *  full-size lightbox — the same peek affordance as familiar avatars.
   *  Monogram fallbacks stay inert: there is no image to enlarge. */
  expandable?: boolean;
}) {
  const images = useProjectImages();
  const image = root ? images[normalizeProjectRoot(root)] : undefined;
  const [broken, setBroken] = useState(false);
  // A replaced image gets a fresh chance even if the previous one failed.
  useEffect(() => setBroken(false), [image?.dataUrl]);

  const hasImage = Boolean(image && !broken);
  // The caller's className rides on the OUTERMOST element so flex-item
  // utilities (e.g. shrink-0) keep applying: the tile span by default, the
  // lightbox trigger button when expandable + an image exists.
  const outerClass = className ? ` ${className}` : "";
  const style = {
    ["--pa-size" as string]: `${PX[size]}px`,
    ["--tile" as string]: color ?? (root ? projectTint(root) : "var(--accent-presence)"),
  };

  const tile = (
    <span
      className={`project-avatar${expandable && hasImage ? "" : outerClass}`}
      style={style}
      aria-hidden={expandable && hasImage ? undefined : "true"}
    >
      {hasImage ? (
        <img
          src={image!.dataUrl}
          alt=""
          className="project-avatar__img"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="project-avatar__monogram">{projectMonogram(name)}</span>
      )}
    </span>
  );

  if (expandable && hasImage) {
    return (
      <AvatarLightbox src={image!.dataUrl} label={name} category="Project" triggerClassName={className}>
        {tile}
      </AvatarLightbox>
    );
  }

  return tile;
}
