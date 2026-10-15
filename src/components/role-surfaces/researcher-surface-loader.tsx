"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";

import { EmptyState } from "@/components/ui/empty-state";
import type { ResearchCapability } from "@/lib/research-capability";

type ResearcherComponent = ComponentType<{ context: RoleSurfaceContext }>;
let loaded: ResearcherComponent | null = null;
let pending: Promise<ResearcherComponent> | null = null;

function loadResearcher(): Promise<ResearcherComponent> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import("@opencoven/research-client")
    .then((module) => (loaded = module.ResearcherSurface))
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}

/** Keep the heavy room demand-loaded without delaying its first data read
 * behind a Suspense retry. The host still owns role gates and error recovery. */
export function ResearcherSurfaceLoader({ context, fallback }: {
  context: RoleSurfaceContext;
  fallback: ReactNode;
}) {
  const [state, setState] = useState<{ component: ResearcherComponent | null; error?: unknown }>(
    () => ({ component: loaded }),
  );
  const [capability, setCapability] = useState<ResearchCapability | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/research/capability", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Research availability could not be checked");
        return await response.json() as ResearchCapability;
      })
      .then((value) => { if (!controller.signal.aborted) setCapability(value); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ component: null, error });
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!capability?.enabled || state.component) return;
    let active = true;
    void loadResearcher().then(
      (component) => { if (active) setState({ component }); },
      (error: unknown) => { if (active) setState({ component: null, error }); },
    );
    return () => { active = false; };
  }, [capability?.enabled, state.component]);
  if ("error" in state) throw state.error;
  if (capability && !capability.enabled) {
    return <EmptyState
      headline={capability.available ? "Research is disabled" : "Research is not installed"}
      subtitle={capability.available
        ? "Enable Research to open this workspace. Your saved missions and resources stay on this device."
        : "Install Research to open this workspace. Your saved missions and resources stay on this device."}
    />;
  }
  const Component = capability?.enabled ? state.component : null;
  return Component ? <Component context={context} /> : fallback;
}
