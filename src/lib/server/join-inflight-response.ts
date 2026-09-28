/**
 * Join identical concurrent GETs onto one handler run (#5627).
 *
 * A chat's GitHub cards asked `/api/github/checks` and `/api/github/comments`
 * for the same PR several times at once, each ask a set of live GitHub calls
 * (1.6-3.3 s). Requests with the same key while one is in flight share its
 * result; each caller still gets its own Response. Nothing is kept after the
 * run settles, so every later request is answered live.
 */

type Captured = { status: number; headers: [string, string][]; body: ArrayBuffer };

const inflight = new Map<string, Promise<Captured>>();

async function capture(response: Response): Promise<Captured> {
  return {
    status: response.status,
    headers: [...response.headers.entries()],
    body: await response.arrayBuffer(),
  };
}

export async function joinInFlightResponse(key: string, handler: () => Promise<Response>): Promise<Response> {
  let pending = inflight.get(key);
  if (!pending) {
    const run = handler().then(capture);
    pending = run;
    inflight.set(key, run);
    const clear = () => {
      if (inflight.get(key) === run) inflight.delete(key);
    };
    run.then(clear, clear);
  }
  const shared = await pending;
  return new Response(shared.body.slice(0), { status: shared.status, headers: shared.headers });
}
