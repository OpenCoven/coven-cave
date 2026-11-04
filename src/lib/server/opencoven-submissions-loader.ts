import type { SubmissionsRoute } from "./opencoven-submissions-host.ts";

/** Resolves to the implementation or the absent stub, decided at build time. */
export const loadSubmissionsRuntime = (): Promise<{
  submissionsContractVersion: number;
  handleSubmissionsRequest: (route: SubmissionsRoute, request: Request) => Promise<Response>;
}> => import("@opencoven/submissions-runtime");
