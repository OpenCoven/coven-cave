/** Transport budget, including base64 and JSON overhead. Fits ten 5 MiB
 * images or one 50 MiB media attachment. Per-file validation remains separate.
 * Keep Next's clone buffer and the declared-length refusal in agreement. */
export const MAX_PROXY_BODY_BYTES = 80 * 1024 * 1024;
