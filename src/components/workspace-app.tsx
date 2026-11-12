"use client";

import { Workspace } from "@/components/workspace";
import { FirstUseProvider } from "@/components/first-use-provider";
import { WorkspaceSurfacePreferencesProvider } from "@/lib/surface-preferences";

/** The normal application shell, kept out of first-run startup until setup exits. */
export function WorkspaceApp() {
  return (
    <WorkspaceSurfacePreferencesProvider>
      <FirstUseProvider><Workspace /></FirstUseProvider>
    </WorkspaceSurfacePreferencesProvider>
  );
}
