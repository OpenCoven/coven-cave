/** Only appended local notices may merge into a pending history response.
 * Sends, edits and explicit resets retain ownership even after a run settles. */
export function pendingHistorySystemTurns<T extends { role: string }>(
  painted: readonly T[],
  current: readonly T[],
): T[] | null {
  if (painted === current) return [];
  if (current.length <= painted.length || painted.some((turn, index) => current[index] !== turn)) {
    return null;
  }
  const additions = current.slice(painted.length);
  return additions.every((turn) => turn.role === "system") ? additions : null;
}

/** Start revalidation and decryption together. Cache may paint only before the
 * network settles; a failed network caller can await durable for its fallback.
 * Ownership/live-generation checks belong to the caller's paint callback. */
export function startChatTranscriptLoad<T>({
  loadNetwork,
  loadDurable,
  onPendingDurable,
}: {
  loadNetwork: () => Promise<T | null>;
  loadDurable: () => Promise<T | null>;
  onPendingDurable: (payload: T) => void;
}): { network: Promise<T | null>; durable: Promise<T | null> } {
  let networkSettled = false;
  const network = loadNetwork().then(
    (payload) => {
      networkSettled = true;
      return payload;
    },
    (error: unknown) => {
      networkSettled = true;
      throw error;
    },
  );
  const durable = loadDurable().then(
    (payload) => {
      if (payload !== null && !networkSettled) onPendingDurable(payload);
      return payload;
    },
    (error: unknown) => {
      console.warn("[chat] Offline transcript cache unavailable", error);
      return null;
    },
  );
  return { network, durable };
}
