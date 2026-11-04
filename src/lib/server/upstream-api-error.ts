import { githubApiFailure } from "@/lib/github-activity";

type UpstreamProvider = "GitHub" | "Asana";

type UpstreamApiErrorOptions = {
  configured: boolean;
  error: string;
  fallbackStatus?: number;
  responseBody?: unknown;
  details?: Record<string, unknown>;
};

function messageFrom(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("message" in body)) return null;
  return typeof body.message === "string" ? body.message : null;
}

function retryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export function upstreamApiError(
  provider: UpstreamProvider,
  response: Response,
  {
    configured,
    error,
    fallbackStatus = response.status === 403 ? 403 : 502,
    responseBody,
    details = {},
  }: UpstreamApiErrorOptions,
): Response {
  if (response.status === 401 && configured) {
    return Response.json(
      { ...details, ok: false, error: `${provider} rejected the configured token.`, patInvalid: true },
      { status: 401 },
    );
  }

  if (provider === "GitHub") {
    const failure = githubApiFailure({
      status: response.status,
      remaining: Number(response.headers.get("x-ratelimit-remaining") ?? -1),
      retryAfter: response.headers.get("retry-after"),
      rateLimitReset: response.headers.get("x-ratelimit-reset"),
      responseMessage: messageFrom(responseBody),
    });
    if (failure.rateLimited && failure.retryAfterSeconds !== null) {
      return Response.json(
        {
          ...details,
          ok: false,
          error: failure.message,
          rateLimited: true,
          retryAfterSeconds: failure.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": response.headers.get("retry-after") ?? String(failure.retryAfterSeconds),
          },
        },
      );
    }
  } else if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfterSeconds(retryAfter);
    return Response.json(
      {
        ...details,
        ok: false,
        error,
        ...(seconds === null ? {} : { retryAfterSeconds: seconds }),
      },
      { status: 429, headers: retryAfter ? { "Retry-After": retryAfter } : undefined },
    );
  }

  return Response.json(
    { ...details, ok: false, error },
    { status: fallbackStatus },
  );
}
