"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";

type ResearcherComponent = typeof import("./researcher-surface").ResearcherSurface;
let loaded: ResearcherComponent | null = null;
let pending: Promise<ResearcherComponent> | null = null;

function loadResearcher(): Promise<ResearcherComponent> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import("./researcher-surface")
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
  useEffect(() => {
    let active = true;
    void loadResearcher().then(
      (component) => { if (active) setState({ component }); },
      (error: unknown) => { if (active) setState({ component: null, error }); },
    );
    return () => { active = false; };
  }, []);
  if ("error" in state) throw state.error;
  const Component = state.component;
  return Component ? <Component context={context} /> : fallback;
}
