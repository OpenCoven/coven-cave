import {
  caveHomeReconciliationStatus,
  type CaveHomeReconciliationStatus,
} from "./cave-home-reconciliation.ts";
import { CAVE_HOME_MIGRATIONS } from "./cave-home-migration.ts";

/** Backward-compatible status shape plus detailed review metadata. */
export type CaveHomeMigrationStatus = CaveHomeReconciliationStatus;

/** Central qualification/status check shared by startup, API, and UI. */
export async function caveHomeMigrationStatus(): Promise<CaveHomeMigrationStatus> {
  return caveHomeReconciliationStatus(CAVE_HOME_MIGRATIONS);
}
