export const DEVICE_GRANT_HEADER = "x-coven-cave-device-grant";
export const DEVICE_PAIRING_PAGE_HEADER = "x-coven-cave-device-pairing-page";
export const DEVICE_MANAGED_HEADER = "x-coven-cave-device-managed";

export function hasDeviceAccessStamp(value: string | null, secret: string | undefined): boolean {
  return Boolean(secret && value === secret);
}
