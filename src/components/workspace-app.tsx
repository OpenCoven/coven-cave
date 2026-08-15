"use client";

import { Workspace } from "@/components/workspace";
import { WorkspaceSurfacePreferencesProvider } from "@/lib/surface-preferences";

/** The normal application shell, kept out of first-run startup until setup exits. */
export function WorkspaceApp() {
  return (
    <WorkspaceSurfacePreferencesProvider>
      <Workspace />
    </WorkspaceSurfacePreferencesProvider>
  );
}
