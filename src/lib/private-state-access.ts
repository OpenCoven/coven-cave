/**
 * Client-safe pieces of the private-state grant rule (#6451). A registered
 * project whose folder holds Cave's private state can't be given Write: the
 * grants store refuses it with `cave_private_state_write`, and a Write grant
 * made before that rule blocks Claude Build turns until someone narrows it.
 */
export const PRIVATE_STATE_WRITE_CODE = "cave_private_state_write";

/** Why a grant can't be Write here, for titles and labels. */
export const PRIVATE_STATE_WRITE_NOTE =
  "This folder holds Cave’s private state, so familiars can’t get write access to it. While one can write here, its Claude Build turns are refused. Change it to Read.";

/** Why a folder that nobody writes to yet only offers Read. */
export const PRIVATE_STATE_READ_ONLY_NOTE =
  "This folder holds Cave’s private state, so access here is Read only.";

/** The server's reason when it refused a Write grant, or null for any other failure. */
export async function privateStateRefusal(res: Response): Promise<string | null> {
  if (res.status !== 409) return null;
  const data = (await res.clone().json().catch(() => null)) as { code?: unknown; error?: unknown } | null;
  return data?.code === PRIVATE_STATE_WRITE_CODE && typeof data.error === "string" && data.error.trim()
    ? data.error
    : null;
}

/** `privateStateProjectIds` from a `/api/project-grants` listing. */
export function privateStateProjectIdsFrom(data: unknown): Set<string> {
  const ids = (data as { privateStateProjectIds?: unknown } | null)?.privateStateProjectIds;
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
}
