// Run the generated Next server in this process so Playwright owns its lifetime.
// Build first with pnpm build; never fall back to a live compiler after failure.
import { cpSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parsePort } from "./ports.mjs";

const port = parsePort(process.argv[2]);
if (port === null) throw new Error("Usage: node scripts/start-playwright-production.mjs <port>");

const root = process.cwd();
const standalone = path.join(root, ".next/standalone");
// Next's standalone output intentionally omits these CDN-served assets.
// Copy them from the same build before exposing the readiness endpoint.
cpSync(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
process.env.NODE_ENV = "production";
process.env.HOSTNAME = "127.0.0.1";
process.env.PORT = String(port);
await import(pathToFileURL(path.join(standalone, "server.js")).href);
