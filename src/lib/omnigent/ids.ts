/** Host chip / runtimeHost ids for Omnigent fleet hosts. */

export const OMNIGENT_HOST_PREFIX = "omnigent:";

export function omnigentHostOptionId(hostId: string): string {
  return `${OMNIGENT_HOST_PREFIX}${hostId}`;
}

/** Returns Omnigent host_id when `id` is an omnigent:… option, else null. */
export function parseOmnigentHostOptionId(id: string | null | undefined): string | null {
  if (typeof id !== "string" || !id.startsWith(OMNIGENT_HOST_PREFIX)) return null;
  const hostId = id.slice(OMNIGENT_HOST_PREFIX.length).trim();
  return hostId || null;
}

export function isOmnigentHostOptionId(id: string | null | undefined): boolean {
  return parseOmnigentHostOptionId(id) !== null;
}
