"use client";

import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { EmptyState } from "@/components/ui/empty-state";

export function ResearcherSurface(_props: { context: RoleSurfaceContext }) {
  return <EmptyState headline="Research is not installed" subtitle="Install Research to open this workspace. Your saved missions and resources stay on this device." />;
}
