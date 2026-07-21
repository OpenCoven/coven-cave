import { Workspace } from "@/components/workspace";
import { WorkspaceSurfacePreferencesProvider } from "@/lib/surface-preferences";

export default function Home() {
  return (
    <WorkspaceSurfacePreferencesProvider>
      <Workspace />
    </WorkspaceSurfacePreferencesProvider>
  );
}
