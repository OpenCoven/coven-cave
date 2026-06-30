function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function stripSelfReportJsonFence(raw: string): string {
  let text = raw.trim();

  if (text.startsWith("```")) {
    let body = text.slice(3);
    if (body.slice(0, 4).toLowerCase() === "json") {
      body = body.slice(4);
    }
    text = body.trimStart();
  }

  if (text.endsWith("```")) {
    text = text.slice(0, -3).trimEnd();
  }

  return text;
}

export function parseSelfReportJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(stripSelfReportJsonFence(raw)) as unknown;
  if (!isRecord(parsed)) throw new Error("response was not an object");
  return parsed;
}
