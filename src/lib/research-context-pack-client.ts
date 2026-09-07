// Client-safe Context Pack wrapper (Unit 1, cave-6sles.10).
//
// Mirrors the research-resource client style: ordinary no-store fetch over
// the flag-gated API, bounded error mapping, no blob bytes over HTTP.

import type { ContextPackV1 } from "./research-protocol/context-pack.ts";

export type ContextPackApiError = {
  code?: string;
  error: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `context packs request failed (${response.status})`;
    throw new Error(message);
  }
  if (!body) throw new Error("context packs response was empty");
  return body;
}

export async function fetchContextPacks(
  request: typeof fetch = fetch,
): Promise<ContextPackV1[]> {
  const response = await request("/api/research/context-packs", { cache: "no-store" });
  const body = await readJson<{ ok?: boolean; packs?: ContextPackV1[] }>(response);
  return body.packs ?? [];
}

export async function fetchContextPack(
  id: string,
  request: typeof fetch = fetch,
): Promise<ContextPackV1> {
  const response = await request(`/api/research/context-packs/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const body = await readJson<{ ok?: boolean; pack?: ContextPackV1 }>(response);
  if (!body.pack) throw new Error("context pack response was missing the pack");
  return body.pack;
}

export async function sealContextPack(
  selection: unknown,
  redactions: unknown,
  request: typeof fetch = fetch,
): Promise<ContextPackV1> {
  const response = await request("/api/research/context-packs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection, ...(redactions === undefined ? {} : { redactions }) }),
    cache: "no-store",
  });
  const body = await readJson<{ ok?: boolean; pack?: ContextPackV1 }>(response);
  if (!body.pack) throw new Error("context pack seal response was missing the pack");
  return body.pack;
}

export async function deleteContextPack(
  id: string,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const response = await request(`/api/research/context-packs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    cache: "no-store",
  });
  return response.ok;
}
