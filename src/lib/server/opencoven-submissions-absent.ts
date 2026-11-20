import type { SubmissionsRoute } from "./opencoven-submissions-host.ts";

/** What a build without the Submissions implementation resolves to (#6401). */
export const submissionsContractVersion: number = 1;

export async function handleSubmissionsRequest(_route: SubmissionsRoute, _request: Request): Promise<Response> {
  return Response.json(
    { ok: false, code: "submissions-not-installed", error: "Submissions isn't included in this build." },
    { status: 503 },
  );
}
