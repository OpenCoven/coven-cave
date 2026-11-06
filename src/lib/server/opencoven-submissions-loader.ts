import { submissionsAvailable } from "@opencoven/submissions-availability";
import type { SubmissionsActivation } from "./opencoven-submissions-host.ts";

/** Resolves to the implementation or the absent stub, decided at build time. */
export const submissionsActivation: SubmissionsActivation = {
  available: submissionsAvailable,
  load: () => import("@opencoven/submissions-runtime"),
};
