import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

const CLIENT_V1_ADMIN_HEADER = "x-coven-client-v1-admin";
const PAIRING_SECRET_HEADER = "x-coven-pairing-secret";
const E2E_LOCAL_PEER_SECRET = "cave-e2e-local-peer-fixture";

type CleanupState = {
  appName: string;
  installationId: string;
  pairingId: string | null;
  pairingSecret: string | null;
  credentialId: string | null;
  token: string | null;
};

type AdminCredentialsResponse = {
  ok: true;
  credentials: Array<{
    id: string;
    appName: string;
    installationId: string;
    revokedAt: number | null;
  }>;
};

function adminHeaders(): Record<string, string> {
  return {
    [CLIENT_V1_ADMIN_HEADER]: E2E_LOCAL_PEER_SECRET,
    "idempotency-key": randomUUID(),
  };
}

async function revokeCredential(request: APIRequestContext, credentialId: string): Promise<void> {
  const response = await request.delete(`/api/client/v1/admin/credentials/${credentialId}`, {
    headers: adminHeaders(),
  });
  expect([200, 404]).toContain(response.status());
}

async function cleanupCredentialByIdentity(
  request: APIRequestContext,
  state: CleanupState,
): Promise<void> {
  const response = await request.get("/api/client/v1/admin/credentials", {
    headers: { [CLIENT_V1_ADMIN_HEADER]: E2E_LOCAL_PEER_SECRET },
  });
  if (!response.ok()) return;
  const body = (await response.json()) as AdminCredentialsResponse;
  const matches = body.credentials.filter((credential) =>
    credential.revokedAt === null
    && credential.appName === state.appName
    && credential.installationId === state.installationId
  );
  for (const credential of matches) {
    await revokeCredential(request, credential.id);
  }
}

async function cleanupPairing(request: APIRequestContext, state: CleanupState): Promise<void> {
  if (!state.pairingId || !state.pairingSecret) return;
  const headers = { [PAIRING_SECRET_HEADER]: state.pairingSecret };
  const status = await request.get(`/api/client/v1/pairing/requests/${state.pairingId}`, {
    headers,
  });
  if (status.status() === 200) {
    const body = (await status.json()) as {
      pairing: { status: "pending" | "approved" | "denied" };
    };
    if (body.pairing.status === "pending") {
      await request.post(`/api/client/v1/admin/pairing-requests/${state.pairingId}/decision`, {
        headers: {
          ...adminHeaders(),
          "content-type": "application/json",
        },
        data: { decision: "deny" },
      });
      return;
    }
    if (body.pairing.status === "approved") {
      const exchange = await request.post(
        `/api/client/v1/pairing/requests/${state.pairingId}/exchange`,
        {
          headers: {
            ...headers,
            "idempotency-key": randomUUID(),
          },
        },
      );
      if (exchange.status() === 200) {
        const exchangeBody = (await exchange.json()) as {
          credential: { id: string };
        };
        await revokeCredential(request, exchangeBody.credential.id);
      }
    }
  }
}

async function cleanupClientAccessArtifacts(
  request: APIRequestContext,
  state: CleanupState,
): Promise<void> {
  if (state.credentialId) {
    await revokeCredential(request, state.credentialId);
  } else {
    await cleanupCredentialByIdentity(request, state);
  }
  await cleanupPairing(request, state);
}

test("Client Access approves, exchanges, and revokes a standalone Chat pairing", async ({
  page,
  request,
}) => {
  const installationId = randomUUID();
  const appName = `OpenCoven Chat E2E ${installationId.slice(0, 8)}`;
  const cleanupState: CleanupState = {
    appName,
    installationId,
    pairingId: null,
    pairingSecret: null,
    credentialId: null,
    token: null,
  };

  try {
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {},
      });
    });

    await page.goto("/settings#clientAccess");
    await expect(
      page.getByRole("heading", { name: "Client Access", exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    const createResponse = await request.post("/api/client/v1/pairing/requests", {
      headers: { "idempotency-key": randomUUID() },
      data: {
        appName,
        installationId,
        scopes: ["chat:read"],
      },
    });
    expect(createResponse.status()).toBe(201);
    const createBody = await createResponse.json() as {
      pairing: { id: string; secret: string; status: string };
    };
    expect(createBody.pairing.status).toBe("pending");
    cleanupState.pairingId = createBody.pairing.id;
    cleanupState.pairingSecret = createBody.pairing.secret;

    const pairingSecretHeaders = {
      [PAIRING_SECRET_HEADER]: createBody.pairing.secret,
    };

    const pendingResponse = await request.get(
      `/api/client/v1/pairing/requests/${createBody.pairing.id}`,
      { headers: pairingSecretHeaders },
    );
    expect(pendingResponse.status()).toBe(200);
    expect(
      ((await pendingResponse.json()) as { pairing: { status: string } }).pairing.status,
    ).toBe("pending");

    const approveButton = page.getByRole("button", {
      name: `Approve pairing request from ${appName}`,
      exact: true,
    });
    await expect(approveButton).toBeVisible({ timeout: 30_000 });
    await approveButton.click();
    await expect(approveButton).toBeHidden({ timeout: 30_000 });

    await expect
      .poll(async () => {
        const response = await request.get(
          `/api/client/v1/pairing/requests/${createBody.pairing.id}`,
          { headers: pairingSecretHeaders },
        );
        const body = await response.json() as {
          pairing?: { status?: string };
          error?: { code?: string };
        };
        return response.ok() ? body.pairing?.status : body.error?.code;
      })
      .toBe("approved");

    const exchangeIdempotencyKey = randomUUID();
    const exchangeResponse = await request.post(
      `/api/client/v1/pairing/requests/${createBody.pairing.id}/exchange`,
      {
        headers: {
          ...pairingSecretHeaders,
          "idempotency-key": exchangeIdempotencyKey,
        },
      },
    );
    expect(exchangeResponse.status()).toBe(200);
    const exchangeBody = await exchangeResponse.json() as {
      token: string;
      credential: { id: string; appName: string; scopes: string[] };
    };
    expect(exchangeBody.credential.appName).toBe(appName);
    expect(exchangeBody.credential.scopes).toEqual(["chat:read"]);
    cleanupState.credentialId = exchangeBody.credential.id;
    cleanupState.token = exchangeBody.token;

    const replayResponse = await request.post(
      `/api/client/v1/pairing/requests/${createBody.pairing.id}/exchange`,
      {
        headers: {
          ...pairingSecretHeaders,
          "idempotency-key": exchangeIdempotencyKey,
        },
      },
    );
    expect(replayResponse.status()).toBe(409);
    const replayBody = await replayResponse.json() as {
      error: {
        code: string;
        details: {
          credential: { id: string; appName: string; installationId: string };
        };
      };
    };
    expect(replayBody.error.code).toBe("pairing_already_exchanged");
    expect(replayBody.error.details.credential.id).toBe(exchangeBody.credential.id);
    expect(replayBody.error.details.credential.appName).toBe(appName);
    expect(replayBody.error.details.credential.installationId).toBe(installationId);

    const scopedRead = await request.get("/api/client/v1/projects", {
      headers: { authorization: `Bearer ${exchangeBody.token}` },
    });
    expect(scopedRead.status()).toBe(200);
    const scopedReadBody = await scopedRead.json() as {
      ok: boolean;
      projects: Array<{ id: string }>;
    };
    expect(scopedReadBody.ok).toBe(true);
    expect(scopedReadBody.projects.map((project) => project.id)).toContain("e2e-project");

    const revokeButton = page.getByRole("button", {
      name: `Revoke access for ${appName}`,
      exact: true,
    });
    await expect(revokeButton).toBeVisible({ timeout: 30_000 });
    await revokeButton.click();
    await expect(revokeButton).toBeHidden({ timeout: 30_000 });
    cleanupState.credentialId = null;

    await expect
      .poll(async () => {
        const response = await request.get("/api/client/v1/projects", {
          headers: { authorization: `Bearer ${exchangeBody.token}` },
        });
        return response.status();
      })
      .toBe(401);
  } finally {
    await cleanupClientAccessArtifacts(request, cleanupState);
  }
});
