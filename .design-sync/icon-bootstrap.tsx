// design-sync bundle bootstrap: the app's <Icon name="cat"> uses BARE names,
// but the subset registers under prefix "ph" — in the standalone bundle those
// bare lookups miss (the app has its own runtime affordance). Re-register the
// same icon data with no prefix so iconify's simple-name path stores and
// resolves every name symmetrically ("cat" → '' storage, "caret-down" →
// dash-split 'caret' storage — both sides of the lookup use the same parser).
import { addCollection } from "@iconify/react";
import phSubset from "../src/lib/ph-icons-subset.json";

addCollection({ ...(phSubset as Record<string, unknown>), prefix: "" } as Parameters<
  typeof addCollection
>[0]);

export const CovenIconBootstrap = true;
