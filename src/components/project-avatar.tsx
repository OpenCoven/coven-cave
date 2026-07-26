"use client";

import { useEffect, useState } from "react";
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
}: {
  name: string;
  root?: string | null;
  color?: string | null;
  size?: keyof typeof PX;
  className?: string;
}) {
  const images = useProjectImages();
  const image = root ? images[normalizeProjectRoot(root)] : undefined;
  const [broken, setBroken] = useState(false);
  // A replaced image gets a fresh chance even if the previous one failed.
  useEffect(() => setBroken(false), [image?.dataUrl]);

  const classes = `project-avatar${className ? ` ${className}` : ""}`;
  const style = {
    ["--pa-size" as string]: `${PX[size]}px`,
    ["--tile" as string]: color ?? (root ? projectTint(root) : "var(--accent-presence)"),
  };

  return (
    <span className={classes} style={style} aria-hidden="true">
      {image && !broken ? (
        <img
          src={image.dataUrl}
          alt=""
          className="project-avatar__img"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="project-avatar__monogram">{projectMonogram(name)}</span>
      )}
    </span>
  );
}
