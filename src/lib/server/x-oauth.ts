import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { createServer } from "node:http";
import { XApiError, type XScope } from "../x-api.ts";
import {
  X_AUTHORIZE_URL,
  X_OAUTH_CALLBACK_PORT,
  X_OAUTH_REDIRECT_URI,
  X_PUBLISH_SCOPES,
  X_RESEARCH_SCOPES,
  getXClientId,
} from "./x-app-config.ts";
import { exchangeXAuthorizationCode, fetchXAccount, type XAccount, type XTokenResult } from "./x-client.ts";
import { xCredentialService, type XCredentialService, type XTokenBundle } from "./x-credentials.ts";

const FLOW_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = "/x/oauth/callback";
const CALLBACK_ORIGIN = "http://127.0.0.1:1456";
const PORT_IN_USE_MESSAGE = "X OAuth callback port 1456 is already in use. Run `lsof -nP -iTCP:1456 -sTCP:LISTEN` to identify the listener.";

type XCapability = "research" | "publish";
type CallbackRequest = { method?: string; url?: string };
type CallbackResponse = { writeHead(status: number, headers?: Record<string, string>): void; end(body?: string): void };
type XOAuthListener = {
  close(): void | Promise<void>;
};

export type XOAuthServiceDependencies = {
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  listen?: (options: {
    host: string;
    port: number;
    onRequest: (request: CallbackRequest, response: CallbackResponse) => Promise<void>;
  }) => Promise<XOAuthListener>;
  exchangeAuthorizationCode?: (input: { code: string; codeVerifier: string }) => Promise<XTokenResult>;
  fetchAccount?: (accessToken: string) => Promise<XAccount>;
  credentialService?: XCredentialService;
  clientId?: string;
};

export type XOAuthStartResult = {
  authorizationUrl: string;
  expiresAt: string;
  requestedScopes: XScope[];
  flowId: string;
};

export type XOAuthFlowStatus = {
  activeFlow: boolean;
  flowId?: string;
  outcome?: "pending" | "succeeded" | "failed";
};

export type XOAuthService = {
  start(input: { capability: XCapability }): Promise<XOAuthStartResult>;
  cancel(): void;
  status(): { activeFlow: boolean };
  flowStatus(): XOAuthFlowStatus;
};

type ActiveFlow = {
  flowId: string;
  state: string;
  verifier: string;
  expiresAt: number;
  requestedScopes: XScope[];
  listener: XOAuthListener;
  expiryTimer: ReturnType<typeof setTimeout>;
  consumed: boolean;
  closed: boolean;
};

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function requestedScopes(capability: XCapability): XScope[] {
  return capability === "publish" ? [...X_PUBLISH_SCOPES] : [...X_RESEARCH_SCOPES];
}

function hasScopes(granted: XScope[] | undefined, requested: XScope[]): granted is XScope[] {
  return Array.isArray(granted) && requested.every((scope) => granted.includes(scope));
}

function callbackHtml(success: boolean): string {
  return success
    ? "<!doctype html><html><body>Connected. Return to Cave.</body></html>"
    : "<!doctype html><html><body>Connection failed. Return to Cave.</body></html>";
}

function parseCallbackTarget(requestTarget: string | undefined): URL | null {
  const target = requestTarget ?? "";
  try {
    const callback = target.startsWith("/") && !target.startsWith("//")
      ? new URL(target, CALLBACK_ORIGIN)
      : new URL(target);
    return callback.origin === CALLBACK_ORIGIN ? callback : null;
  } catch {
    return null;
  }
}

async function defaultListen(options: Parameters<NonNullable<XOAuthServiceDependencies["listen"]>>[0]): Promise<XOAuthListener> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void options.onRequest(req, res).catch(() => {
        if (!res.writableEnded) {
          res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
          res.end(callbackHtml(false));
        }
      });
    });
    server.once("error", reject);
    server.listen({ host: options.host, port: options.port, exclusive: true }, () => {
      server.off("error", reject);
      resolve({ close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

/** Owns exactly one short-lived, loopback-only X OAuth authorization flow. */
export function createXOAuthService(dependencies: XOAuthServiceDependencies = {}): XOAuthService {
  const now = dependencies.now ?? Date.now;
  const randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  const listen = dependencies.listen ?? defaultListen;
  const exchange = dependencies.exchangeAuthorizationCode ?? exchangeXAuthorizationCode;
  const account = dependencies.fetchAccount ?? fetchXAccount;
  const credentials = dependencies.credentialService ?? xCredentialService;
  const configuredClientId = dependencies.clientId;
  let active: ActiveFlow | null = null;
  let starting = false;
  let startGeneration = 0;
  let latestFlow: Omit<XOAuthFlowStatus, "activeFlow"> | null = null;

  function finish(
    flow: ActiveFlow,
    outcome: "succeeded" | "failed" = "failed",
  ): void {
    if (flow.closed) return;
    if (active === flow) active = null;
    clearTimeout(flow.expiryTimer);
    flow.closed = true;
    latestFlow = { flowId: flow.flowId, outcome };
    void Promise.resolve(flow.listener.close()).catch(() => {});
  }

  function consume(flow: ActiveFlow): boolean {
    if (active !== flow || flow.consumed) return false;
    clearTimeout(flow.expiryTimer);
    flow.consumed = true;
    return true;
  }

  function expire(): void {
    if (active && !active.consumed && now() >= active.expiresAt) finish(active);
  }

  async function onCallback(request: CallbackRequest, response: CallbackResponse): Promise<void> {
    const flow = active;
    if (!flow || now() >= flow.expiresAt) {
      if (flow) finish(flow);
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(callbackHtml(false));
      return;
    }

    let valid = request.method === "GET";
    let code = "";
    let state = "";
    const callback = parseCallbackTarget(request.url);
    if (callback) {
      valid = valid && callback.pathname === CALLBACK_PATH;
      code = callback.searchParams.get("code") ?? "";
      state = callback.searchParams.get("state") ?? "";
      valid = valid && Boolean(code) && state === flow.state;
    } else {
      valid = false;
    }
    if (!valid) {
      finish(flow);
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(callbackHtml(false));
      return;
    }

    if (!consume(flow)) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(callbackHtml(false));
      return;
    }

    try {
      const token = await exchange({ code, codeVerifier: flow.verifier });
      if (!token.refreshToken || !hasScopes(token.scopes, flow.requestedScopes)) {
        throw new XApiError("invalid-response", "X authorization response is invalid");
      }
      const identity = await account(token.accessToken);
      if (active !== flow || flow.closed) {
        throw new XApiError("oauth-expired", "X authorization was cancelled");
      }
      const bundle: XTokenBundle = {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
        account: identity,
      };
      credentials.replaceBundle(bundle);
      finish(flow, "succeeded");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(callbackHtml(true));
    } catch {
      finish(flow);
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(callbackHtml(false));
    }
  }

  return {
    async start({ capability }): Promise<XOAuthStartResult> {
      expire();
      if (active || starting) throw new XApiError("oauth-in-progress", "X authorization is already in progress");
      const clientId = configuredClientId ?? getXClientId();
      const scopes = requestedScopes(capability);
      const verifier = base64url(randomBytes(32));
      const state = base64url(randomBytes(32));
      const flowId = createHash("sha256")
        .update(`coven-x-flow:${state}`)
        .digest("base64url");
      const expiresAt = now() + FLOW_TTL_MS;
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const generation = startGeneration;
      let listener: XOAuthListener;
      starting = true;
      try {
        listener = await listen({ host: "127.0.0.1", port: X_OAUTH_CALLBACK_PORT, onRequest: onCallback });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
          throw new XApiError("oauth-port-in-use", PORT_IN_USE_MESSAGE);
        }
        throw new XApiError("upstream-unavailable", "X OAuth callback could not be started");
      } finally {
        starting = false;
      }
      if (generation !== startGeneration) {
        await Promise.resolve(listener.close()).catch(() => {});
        throw new XApiError("oauth-expired", "X authorization was cancelled");
      }
      let flow!: ActiveFlow;
      const expiryTimer = setTimeout(() => {
        if (active === flow) finish(flow);
      }, FLOW_TTL_MS);
      expiryTimer.unref?.();
      flow = {
        flowId,
        state,
        verifier,
        expiresAt,
        requestedScopes: scopes,
        listener,
        expiryTimer,
        consumed: false,
        closed: false,
      };
      active = flow;
      latestFlow = { flowId, outcome: "pending" };
      const authorization = new URL(X_AUTHORIZE_URL);
      authorization.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: X_OAUTH_REDIRECT_URI,
        scope: scopes.join(" "),
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return {
        authorizationUrl: authorization.toString(),
        expiresAt: new Date(expiresAt).toISOString(),
        requestedScopes: [...scopes],
        flowId,
      };
    },

    cancel(): void {
      startGeneration += 1;
      if (active) finish(active);
    },

    status(): { activeFlow: boolean } {
      expire();
      return { activeFlow: active !== null };
    },

    flowStatus(): XOAuthFlowStatus {
      expire();
      return {
        activeFlow: active !== null,
        ...(latestFlow ?? {}),
      };
    },
  };
}

const X_OAUTH_SERVICE_SYMBOL = Symbol.for("opencoven.cave.x-oauth-service");
type XOAuthGlobal = typeof globalThis & { [X_OAUTH_SERVICE_SYMBOL]?: XOAuthService };
const oauthGlobal = globalThis as XOAuthGlobal;
export const xOAuthService = oauthGlobal[X_OAUTH_SERVICE_SYMBOL] ??= createXOAuthService();
