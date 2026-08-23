import { createHash } from "node:crypto";

export function xArticleContentSha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}
