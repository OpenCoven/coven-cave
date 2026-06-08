const base = (process.env.API_BASE ?? "http://localhost:3000").replace(/\/$/, "");

async function request(path, init) {
  const url = `${base}${path}`;
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`request failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${url} returned non-JSON body: ${text.slice(0, 160)}`);
    }
  }
  return { status: res.status, json };
}

async function check(name, path, expectedStatus, validate, init) {
  const result = await request(path, init);
  if (result.status !== expectedStatus) {
    throw new Error(`${name}: expected HTTP ${expectedStatus}, got ${result.status}`);
  }
  if (validate && !validate(result.json)) {
    throw new Error(`${name}: response body failed validation: ${JSON.stringify(result.json)}`);
  }
  console.log(`ok ${name}`);
}

await check(
  "daemon status",
  "/api/daemon/status",
  200,
  (json) => typeof json?.running === "boolean" && typeof json.workspacePath === "string",
);

await check(
  "memory file requires path",
  "/api/memory/file",
  400,
  (json) => json?.ok === false && json.error === "path required",
);

await check(
  "memory file denies outside paths",
  `/api/memory/file?path=${encodeURIComponent("/etc/passwd")}`,
  403,
  (json) => json?.ok === false && json.error === "path not allowed",
);

await check(
  "project file requires path",
  "/api/project-file",
  400,
  (json) => json?.ok === false && json.error === "missing path param",
);

await check(
  "inbox rejects non-local writes",
  "/api/inbox",
  403,
  (json) => json?.ok === false && typeof json.error === "string" && json.error.startsWith("forbidden"),
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.invalid",
    },
    body: JSON.stringify({ title: "blocked" }),
  },
);

console.log(`api-http-smoke: ${base} passed`);
