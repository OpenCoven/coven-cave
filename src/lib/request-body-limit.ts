/** Transport budget, including base64 and JSON overhead. Fits the largest
 * allowed mix: 40 images at 5 MiB and 10 other files at 50 MiB (about
 * 934 MiB encoded). Per-file validation remains separate.
 * Keep Next's clone buffer and the declared-length refusal in agreement. */
export const MAX_PROXY_BODY_BYTES = 1024 * 1024 * 1024;
