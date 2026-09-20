export async function covenWikiResponse(key: string, read: () => Promise<unknown>): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const data = await read();
    return data === null
      ? Response.json({ ok: false, error: "Wiki or page not found." }, { status: 404, headers })
      : Response.json({ ok: true, [key]: data }, { headers });
  } catch {
    return Response.json({ ok: false, error: "Couldn't read this wiki. Try again." }, { status: 500, headers });
  }
}
