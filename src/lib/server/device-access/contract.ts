export interface DevicePeer {
  tailnet: string;
  nodeId: string;
  userId: string;
  loginName: string;
  deviceName: string;
}

export interface DeviceRecord {
  id: string;
  installationId: string;
  label: string;
  peer: DevicePeer;
  status: "pending" | "allowed" | "denied" | "revoked" | "expired";
  createdAt: number;
  pairingExpiresAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

export interface DeviceAuditEvent {
  id: string;
  at: number;
  deviceId: string | null;
  actor: string;
  event: string;
  requestId: string | null;
  method: string | null;
  path: string | null;
  /** 0 means authorized admission; 100-599 is an HTTP outcome; null is non-access audit. */
  status: number | null;
}

export interface DeviceAccessSnapshot {
  /** Once enabled by a local policy save, an empty allowlist still denies all. */
  enabled: boolean;
  allowedTailnets: string[];
  devices: DeviceRecord[];
  /** Most recent first; equal timestamps retain reverse commit order. */
  events: DeviceAuditEvent[];
}

export const DEVICE_ACCESS_COOKIE = "cave_device_access";
export const DEVICE_ACCESS_HEADER = "x-coven-cave-device-access";
export const DEVICE_CREDENTIAL_PREFIX = "cave-device-v1.";
