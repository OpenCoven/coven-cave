"use client";

import {
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
} from "@/lib/project-root-guidance";

/** True when a project creation/grant failure carries the out-of-workspace code. */
export function isProjectRootOutsideAllowedWorkspace(code: string | null | undefined): boolean {
  return code === PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE;
}

/**
 * Inline failure surface for project entry points (add-project flow, first-project
 * gate, setup modal, GitHub import). When the server reports the out-of-workspace
 * containment code, the canonical PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR copy
 * is rendered instead of a generic failure message - the error the API already
 * returns is exactly that text, and rendering the constant keeps the client on
 * the same single source of truth as the API routes. Any other failure renders
 * the `error` unchanged, preserving the caller's element and class so existing
 * surfaces keep their styling.
 */
export function ProjectRootWorkspaceNotice({
  code,
  error,
  className,
  as: Tag = "p",
}: {
  code: string | null | undefined;
  /** Generic failure copy shown when `code` is not the workspace restriction. */
  error: string;
  className?: string;
  as?: "p" | "span";
}) {
  return (
    <Tag role="alert" className={className}>
      {isProjectRootOutsideAllowedWorkspace(code) ? PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR : error}
    </Tag>
  );
}
