// Browser side of the passkey ceremonies (cave-brksh).
//
// This is the caller that makes the server half real today. On iOS Safari,
// `navigator.credentials` with `userVerification: "required"` puts the private
// key in the Secure Enclave and gates its USE behind Face ID — which is exactly
// the property the server verifies. The native Swift path
// (ASAuthorizationPlatformPublicKeyCredentialProvider) speaks the same protocol
// against the same endpoints; it is a second front end, not a second design.
//
// Everything crosses the wire as base64url, because that is what WebAuthn's own
// structures use and it survives JSON without a second encoding layer.

export type PasskeySupport = "supported" | "no-webauthn" | "insecure-context";

export type PasskeyCredentialSummary = {
  credentialId: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  attestationFormat: string;
};

export class PasskeyError extends Error {
  readonly kind: "unsupported" | "cancelled" | "server" | "device";
  constructor(kind: PasskeyError["kind"], message: string) {
    super(message);
    this.name = "PasskeyError";
    this.kind = kind;
  }
}

function encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * WebAuthn requires a secure context. Loopback counts as secure even over
 * plain http, which is why the check is not simply `protocol === "https:"` —
 * getting that wrong would report the desktop dev server as unsupported.
 */
export function passkeySupport(scope: {
  PublicKeyCredential?: unknown;
  isSecureContext?: boolean;
} = globalThis as never): PasskeySupport {
  if (typeof scope.PublicKeyCredential === "undefined") return "no-webauthn";
  if (scope.isSecureContext === false) return "insecure-context";
  return "supported";
}

type ChallengeResponse = {
  ok: boolean;
  challenge: string;
  rpId: string;
  allowCredentials: string[];
  error?: string;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !payload) {
    throw new PasskeyError("server", payload?.error ?? `request failed (${res.status})`);
  }
  return payload;
}

async function startCeremony(purpose: "register" | "assert"): Promise<ChallengeResponse> {
  return postJson<ChallengeResponse>("/api/passkey/challenge", { purpose });
}

/**
 * `userVerification: "required"` is not a preference here. The server rejects
 * any assertion whose UV flag is clear, so asking for anything weaker would
 * produce a credential that always fails — better to fail in the picker, where
 * the message can say why.
 */
export async function registerPasskey(
  label: string,
  scope: { credentials?: CredentialsContainer } = navigator,
): Promise<PasskeyCredentialSummary> {
  if (passkeySupport() !== "supported") {
    throw new PasskeyError("unsupported", "this browser cannot create passkeys");
  }
  const ceremony = await startCeremony("register");

  let credential: PublicKeyCredential | null;
  try {
    credential = (await scope.credentials!.create({
      publicKey: {
        challenge: decode(ceremony.challenge) as unknown as BufferSource,
        rp: { id: ceremony.rpId, name: "Coven Cave" },
        // The user handle is per-install, not per-person: this server has a
        // single operator, and a stable random id keeps the platform from
        // silently overwriting one credential with another.
        user: {
          id: decode(ceremony.challenge).slice(0, 16) as unknown as BufferSource,
          name: label || "Coven Cave",
          displayName: label || "Coven Cave",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
        timeout: 60_000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw new PasskeyError("cancelled", err instanceof Error ? err.message : "cancelled");
  }
  if (!credential) throw new PasskeyError("cancelled", "no credential was created");

  const response = credential.response as AuthenticatorAttestationResponse;
  const result = await postJson<{ credential: PasskeyCredentialSummary }>(
    "/api/passkey/register",
    {
      challenge: ceremony.challenge,
      clientDataJSON: encode(response.clientDataJSON),
      attestationObject: encode(response.attestationObject),
      label,
    },
  );
  return result.credential;
}

/**
 * Prove presence. Resolves with the expiry the server minted so a caller can
 * schedule a re-prompt rather than discovering the lapse through a 401.
 */
export async function provePasskeyPresence(
  scope: { credentials?: CredentialsContainer } = navigator,
): Promise<{ expiresAt: number }> {
  if (passkeySupport() !== "supported") {
    throw new PasskeyError("unsupported", "this browser cannot use passkeys");
  }
  const ceremony = await startCeremony("assert");
  if (ceremony.allowCredentials.length === 0) {
    throw new PasskeyError("device", "no passkey is enrolled for this device");
  }

  let credential: PublicKeyCredential | null;
  try {
    credential = (await scope.credentials!.get({
      publicKey: {
        challenge: decode(ceremony.challenge) as unknown as BufferSource,
        rpId: ceremony.rpId,
        allowCredentials: ceremony.allowCredentials.map((id) => ({
          type: "public-key" as const,
          id: decode(id) as unknown as BufferSource,
        })),
        userVerification: "required",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw new PasskeyError("cancelled", err instanceof Error ? err.message : "cancelled");
  }
  if (!credential) throw new PasskeyError("cancelled", "no assertion was produced");

  const response = credential.response as AuthenticatorAssertionResponse;
  return postJson<{ expiresAt: number }>("/api/passkey/assert", {
    challenge: ceremony.challenge,
    credentialId: encode(credential.rawId),
    clientDataJSON: encode(response.clientDataJSON),
    authenticatorData: encode(response.authenticatorData),
    signature: encode(response.signature),
  });
}

export async function listPasskeys(): Promise<PasskeyCredentialSummary[]> {
  const res = await fetch("/api/passkey/credentials", { credentials: "same-origin" });
  if (!res.ok) return [];
  const payload = (await res.json().catch(() => null)) as
    | { credentials?: PasskeyCredentialSummary[] }
    | null;
  return payload?.credentials ?? [];
}

export async function deletePasskey(credentialId: string): Promise<boolean> {
  const res = await fetch(
    `/api/passkey/credentials?credentialId=${encodeURIComponent(credentialId)}`,
    { method: "DELETE", credentials: "same-origin" },
  );
  return res.ok;
}

// Exported for tests; the encoding is the contract between this file and the
// server, so it is worth pinning directly rather than only through a ceremony.
export const __base64Url = { encode, decode };
