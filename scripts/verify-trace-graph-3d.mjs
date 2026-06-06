import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { inflateSync } from "node:zlib";

const baseUrl = process.env.CAVE_VERIFY_URL ?? "http://127.0.0.1:3000";
const outDir = "artifacts/trace-graph-3d";

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
const browserMessages = [];

page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) browserMessages.push(`[browser:${msg.type()}] ${msg.text()}`);
});

await page.route("**/api/coven-calls", async (route) => {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      calls: [
        {
          id: "verify-call-1",
          callerFamiliarId: "nova",
          calleeFamiliarId: "cody",
          request: "Verify 3D trace graph rendering",
          status: "running",
          createdAt: new Date().toISOString(),
          sessionId: "verify-session-cody",
        },
        {
          id: "verify-call-2",
          callerFamiliarId: "cody",
          calleeFamiliarId: "sage",
          request: "Research graph behavior",
          status: "completed",
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          sessionId: "verify-session-sage",
        },
      ],
    }),
  });
});

await page.route("**/api/board", async (route) => {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      cards: [
        {
          id: "verify-card-1",
          title: "Inferred handoff for visual verification",
          status: "running",
          lifecycle: "running",
          familiarId: "sage",
          sessionId: "verify-session-cody",
          updatedAt: new Date().toISOString(),
        },
      ],
    }),
  });
});

await page.goto(`${baseUrl}/dev/trace-graph-3d`, { waitUntil: "networkidle" });

const canvas = page.getByTestId("trace-graph-3d-canvas");
await canvas.waitFor({ timeout: 15_000 });
await page.waitForTimeout(1400);

const box = await canvas.boundingBox();
if (!box || box.width < 320 || box.height < 320) {
  throw new Error(`trace graph canvas has invalid bounds: ${JSON.stringify(box)}`);
}

const canvasPng = await canvas.screenshot();
const nonBlank = countLitPngPixels(canvasPng) > 120;

if (!nonBlank) throw new Error("trace graph canvas appears blank");

await canvas.click({ position: { x: Math.min(220, box.width - 20), y: Math.min(220, box.height - 20) } });
await page.keyboard.press("ArrowRight");
await page.keyboard.press("Enter");

await page.screenshot({ path: `${outDir}/desktop.png`, fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await canvas.waitFor({ timeout: 10_000 });
await page.screenshot({ path: `${outDir}/mobile.png`, fullPage: true });

await browser.close();

for (const message of browserMessages) console.log(message);
console.log(`Trace graph visual verification passed: ${outDir}/desktop.png and ${outDir}/mobile.png`);

function countLitPngPixels(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error("canvas screenshot is not a PNG");

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`unsupported PNG format: bitDepth=${bitDepth} colorType=${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let src = 0;
  let lit = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[src++];
    for (let x = 0; x < stride; x++) {
      const raw = inflated[src++];
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      if (filter === 0) current[x] = raw;
      else if (filter === 1) current[x] = (raw + left) & 255;
      else if (filter === 2) current[x] = (raw + up) & 255;
      else if (filter === 3) current[x] = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) current[x] = (raw + paeth(left, up, upLeft)) & 255;
      else throw new Error(`unsupported PNG filter: ${filter}`);
    }
    for (let x = 0; x < stride; x += channels) {
      if (current[x] + current[x + 1] + current[x + 2] > 32) lit++;
    }
    current.copy(previous);
  }

  return lit;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
