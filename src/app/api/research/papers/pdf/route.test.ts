import assert from "node:assert/strict";
import { test } from "node:test";

import { arxivPdfUrl } from "./arxiv-url.ts";
import { GET } from "./route.ts";

test("builds the arXiv URL from a valid id", () => {
  assert.equal(arxivPdfUrl("2401.12345"), "https://arxiv.org/pdf/2401.12345");
  assert.equal(arxivPdfUrl("2401.1234"), "https://arxiv.org/pdf/2401.1234");
});

test("refuses anything that is not an arXiv id", () => {
  const bad = [
    "../etc/passwd",
    "2401.1234567",
    "evil.com/x",
    "",
    // The route trims before calling, so the padded form never reaches the
    // helper in production — but the helper itself must still refuse it.
    "2401.12345 ",
    "2401.12345/../../secret",
    "https://evil.com/2401.12345",
    "2401.12345?x=1",
    "2401.12345#frag",
  ];
  for (const value of bad) {
    assert.equal(arxivPdfUrl(value), null, `must refuse ${JSON.stringify(value)}`);
  }
});

// ── the route itself ────────────────────────────────────────────────────────

type FetchCall = { url: string; headers: Headers };

/**
 * Stub `fetch` and record what the route asked upstream for. Responses must
 * carry a `url`: the route reads it to confirm the chain never left arXiv, and
 * a hand-built Response defaults to the empty string.
 */
function stubFetch(reply: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), headers: new Headers(init?.headers) };
    calls.push(call);
    return reply(call);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

function upstreamPdf(
  body: string,
  init: ResponseInit & { url?: string } = {},
): Response {
  const { url = "https://arxiv.org/pdf/2401.12345", ...rest } = init;
  const response = new Response(body, rest);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function request(headers: Record<string, string> = {}, id = "2401.12345") {
  return new Request(`http://localhost:3000/api/research/papers/pdf?id=${id}`, {
    headers: { host: "localhost", ...headers },
  });
}

test("a non-local request is refused before any upstream fetch", async () => {
  const fetched = stubFetch(() => upstreamPdf("%PDF-"));
  try {
    const response = await GET(request({ host: "cave.example.com" }));
    assert.equal(response.status, 403);
    assert.equal(fetched.calls.length, 0, "the guard runs first");
  } finally {
    fetched.restore();
  }
});

test("an invalid id is a 400, with nothing fetched", async () => {
  const fetched = stubFetch(() => upstreamPdf("%PDF-"));
  try {
    for (const id of ["", "..%2Fetc%2Fpasswd", "2401.1234567"]) {
      const response = await GET(request({}, id));
      assert.equal(response.status, 400, `must refuse id ${JSON.stringify(id)}`);
      assert.equal((await response.json()).error, "invalid paper id");
    }
    assert.equal(fetched.calls.length, 0);
  } finally {
    fetched.restore();
  }
});

test("the upstream request asks for an unencoded body", async () => {
  // fetch decompresses transparently but leaves the COMPRESSED content-length
  // on the response, and the route forwards that header — so a gzipped upstream
  // would truncate the document for pdf.js.
  const fetched = stubFetch(() =>
    upstreamPdf("%PDF-1.7", { headers: { "content-length": "8", "accept-ranges": "bytes" } }),
  );
  try {
    const response = await GET(request());
    assert.equal(response.status, 200);
    assert.equal(fetched.calls[0].headers.get("accept-encoding"), "identity");
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("content-length"), "8");
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(await response.text(), "%PDF-1.7");
  } finally {
    fetched.restore();
  }
});

test("a Range request reaches upstream and its 206 is forwarded intact", async () => {
  const fetched = stubFetch(() =>
    upstreamPdf("PDF", {
      status: 206,
      headers: { "content-range": "bytes 0-2/9001", "content-length": "3" },
    }),
  );
  try {
    const response = await GET(request({ range: "bytes=0-2" }));
    assert.equal(fetched.calls[0].headers.get("range"), "bytes=0-2");
    assert.equal(fetched.calls[0].headers.get("accept-encoding"), "identity");
    assert.equal(response.status, 206, "a partial response is not an error");
    assert.equal(response.headers.get("content-range"), "bytes 0-2/9001");
  } finally {
    fetched.restore();
  }
});

test("an unreachable upstream is a 502 and a missing paper is a 404", async () => {
  const thrown = stubFetch(() => {
    throw new Error("ECONNREFUSED");
  });
  try {
    const response = await GET(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "upstream unavailable");
  } finally {
    thrown.restore();
  }

  const missing = stubFetch(() => upstreamPdf("not found", { status: 404 }));
  try {
    const response = await GET(request());
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, "paper not found");
  } finally {
    missing.restore();
  }
});

test("a redirect chain that leaves arXiv is refused, not proxied", async () => {
  // fetch follows up to 20 hops by default, so the safety of the composed
  // request URL says nothing about where the streamed body came from.
  const fetched = stubFetch(() =>
    upstreamPdf("<html>", { url: "https://evil.example.com/2401.12345" }),
  );
  try {
    const response = await GET(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "upstream redirected away");
  } finally {
    fetched.restore();
  }

  const withinArxiv = stubFetch(() =>
    upstreamPdf("%PDF-1.7", { url: "https://export.arxiv.org/pdf/2401.12345" }),
  );
  try {
    const response = await GET(request());
    assert.equal(response.status, 200, "arXiv's own hosts stay allowed");
  } finally {
    withinArxiv.restore();
  }
});
