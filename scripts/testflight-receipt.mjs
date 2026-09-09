import { createPrivateKey, sign } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { isDirectRun } from "./direct-run.mjs";

const ORIGIN = "https://api.appstoreconnect.apple.com";
const BUNDLE_ID = "ai.opencoven.cave";
const INTERNAL = [
  "PROCESSING", "PROCESSING_EXCEPTION", "MISSING_EXPORT_COMPLIANCE",
  "READY_FOR_BETA_TESTING", "IN_BETA_TESTING", "EXPIRED", "IN_EXPORT_COMPLIANCE_REVIEW",
];
const EXTERNAL = [
  ...INTERNAL, "READY_FOR_BETA_SUBMISSION", "WAITING_FOR_BETA_REVIEW",
  "IN_BETA_REVIEW", "BETA_REJECTED", "BETA_APPROVED", "NOT_APPLICABLE",
];
const BLOCKED = new Set([
  "PROCESSING_EXCEPTION", "MISSING_EXPORT_COMPLIANCE", "EXPIRED",
  "IN_EXPORT_COMPLIANCE_REVIEW", "BETA_REJECTED",
]);

export class ReceiptError extends Error {
  constructor(code, status = null) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function requireValue(condition, code = "INVALID_RESPONSE") {
  if (!condition) throw new ReceiptError(code);
}

export function selectors(version, build) {
  requireValue(typeof version === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version),
    "INVALID_MARKETING_VERSION");
  requireValue(typeof build === "string" && /^\d{1,18}(?:\.\d{1,4}){0,2}$/.test(build),
    "INVALID_BUILD_NUMBER");
  return { bundleId: BUNDLE_ID, marketingVersion: version, buildNumber: build, platform: "IOS" };
}

export function appleUrl(value) {
  let url;
  try {
    url = new URL(value, ORIGIN);
  } catch {
    throw new ReceiptError("UNSAFE_API_URL");
  }
  requireValue(url.origin === ORIGIN && !url.username && !url.password && !url.hash
    && /^\/v1\/(?:apps|preReleaseVersions|builds|betaGroups)(?:\/[A-Za-z0-9-]+(?:\/(?:buildBetaDetail|relationships\/betaTesters))?)?$/.test(url.pathname),
  "UNSAFE_API_URL");
  return url;
}

export function tokenSigner(env) {
  const keyId = env.APPLE_API_KEY;
  const subject = env.APPLE_API_KEY_SUBJECT || "";
  requireValue(typeof keyId === "string" && /^[A-Z0-9]{10}$/.test(keyId), "INVALID_KEY_ID");
  requireValue(subject === "" || subject === "user", "INVALID_KEY_SUBJECT");
  requireValue(subject === "user" || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(env.APPLE_API_ISSUER || ""),
    "INVALID_TEAM_ISSUER");
  const encoded = env.APPLE_API_KEY_BASE64;
  requireValue(typeof encoded === "string" && encoded.length <= 16384
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    && encoded.length > 0, "INVALID_PRIVATE_KEY");
  const bytes = Buffer.from(encoded, "base64");
  let key;
  try {
    key = createPrivateKey({ key: bytes, format: "pem" });
  } catch {
    throw new ReceiptError("INVALID_PRIVATE_KEY");
  } finally {
    bytes.fill(0);
  }
  requireValue(key.asymmetricKeyType === "ec"
    && key.asymmetricKeyDetails?.namedCurve === "prime256v1", "INVALID_PRIVATE_KEY");
  return (url, now = Math.floor(Date.now() / 1000)) => {
    const checked = appleUrl(url);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = encode({ alg: "ES256", kid: keyId, typ: "JWT" });
    const payload = encode({
      ...(subject === "user" ? { sub: "user" } : { iss: env.APPLE_API_ISSUER }),
      iat: now, exp: now + 300, aud: "appstoreconnect-v1",
      scope: [`GET ${checked.pathname}${checked.search}`],
    });
    const input = `${header}.${payload}`;
    const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
    return `${input}.${signature.toString("base64url")}`;
  };
}

export function appleClient(signer, { fetchImpl = fetch, pause = sleep, now = Date.now } = {}) {
  const deadline = now() + 240_000;
  let requests = 0;
  async function get(value) {
    const url = appleUrl(value);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      requireValue(++requests <= 100 && now() < deadline, "REQUEST_BUDGET_EXCEEDED");
      let response;
      try {
        response = await fetchImpl(url.href, {
          method: "GET", redirect: "error",
          headers: { Authorization: `Bearer ${signer(url.href)}`, Accept: "application/json" },
          signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - now()))),
        });
      } catch {
        throw new ReceiptError("TRANSPORT_ERROR");
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
          await pause(1000 * (attempt + 1));
          continue;
        }
        throw new ReceiptError(
          [401, 403].includes(response.status) ? "APPLE_AUTHORIZATION_DENIED" : "APPLE_HTTP_ERROR",
          response.status,
        );
      }
      let text = "";
      try {
        requireValue(response.body, "INVALID_RESPONSE");
        const decoder = new TextDecoder();
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          requireValue(size <= 1_048_576, "RESPONSE_TOO_LARGE");
          text += decoder.decode(chunk, { stream: true });
        }
        text += decoder.decode();
      } catch (error) {
        if (error instanceof ReceiptError) throw error;
        throw new ReceiptError("TRANSPORT_ERROR");
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new ReceiptError("INVALID_JSON");
      }
    }
    throw new ReceiptError("REQUEST_BUDGET_EXCEEDED");
  }
  async function list(path, params = {}) {
    const first = appleUrl(path);
    first.search = new URLSearchParams({ ...params, limit: "200" }).toString();
    let next = first.href;
    const seen = new Set();
    const data = [];
    while (next) {
      requireValue(seen.size < 10 && !seen.has(next), "PAGINATION_LIMIT");
      seen.add(next);
      const url = appleUrl(next);
      requireValue(url.pathname === first.pathname, "UNSAFE_PAGINATION");
      // A next link may change only the cursor/limit, never our exact selectors.
      const stable = (u) => [...u.searchParams].filter(([k]) => !["cursor", "limit"].includes(k))
        .map(([k, v]) => `${k}=${v}`).sort();
      requireValue(JSON.stringify(stable(url)) === JSON.stringify(stable(first)), "UNSAFE_PAGINATION");
      const page = await get(url.href);
      requireValue(Array.isArray(page?.data) && page.data.length <= 200, "INVALID_RESPONSE");
      data.push(...page.data);
      const link = page.links?.next;
      requireValue(link === undefined || link === null || typeof link === "string", "INVALID_RESPONSE");
      next = link ? appleUrl(link).href : null;
    }
    return data;
  }
  return { get, list };
}

function resource(value, type) {
  requireValue(value?.type === type && typeof value.id === "string"
    && /^[A-Za-z0-9-]{1,100}$/.test(value.id));
  return value;
}

function relationship(value, name, type, id) {
  requireValue(resource(value.relationships?.[name]?.data, type).id === id, "IDENTITY_MISMATCH");
}

function one(values, type) {
  requireValue(values.length <= 1, "AMBIGUOUS_MATCH");
  return values.length ? resource(values[0], type) : null;
}

function state(value, allowed) {
  return allowed.includes(value) ? value : "UNKNOWN";
}

export async function collectReceipt(receipt, api) {
  const target = receipt.target;
  const app = one(await api.list("/v1/apps", {
    "filter[bundleId]": BUNDLE_ID, "fields[apps]": "bundleId",
  }), "apps");
  if (!app) return "ABSENT";
  requireValue(app.attributes?.bundleId === BUNDLE_ID, "IDENTITY_MISMATCH");
  receipt.appId = app.id;
  const version = one(await api.list("/v1/preReleaseVersions", {
    "filter[app]": app.id, "filter[version]": target.marketingVersion, "filter[platform]": "IOS",
    include: "app", "fields[preReleaseVersions]": "version,platform,app", "fields[apps]": "bundleId",
  }), "preReleaseVersions");
  if (!version) return "ABSENT";
  requireValue(version.attributes?.version === target.marketingVersion
    && version.attributes?.platform === "IOS", "IDENTITY_MISMATCH");
  relationship(version, "app", "apps", app.id);
  receipt.preReleaseVersionId = version.id;
  const build = one(await api.list("/v1/builds", {
    "filter[app]": app.id, "filter[preReleaseVersion]": version.id, "filter[version]": target.buildNumber,
    include: "app,preReleaseVersion",
    "fields[builds]": "version,processingState,expired,expirationDate,app,preReleaseVersion",
    "fields[apps]": "bundleId", "fields[preReleaseVersions]": "version,platform",
  }), "builds");
  if (!build) return "ABSENT";
  requireValue(build.attributes?.version === target.buildNumber, "IDENTITY_MISMATCH");
  relationship(build, "app", "apps", app.id);
  relationship(build, "preReleaseVersion", "preReleaseVersions", version.id);
  receipt.buildId = build.id;
  receipt.processingState = state(build.attributes.processingState, ["PROCESSING", "VALID", "FAILED", "INVALID"]);
  if (receipt.processingState === "PROCESSING") return "PROCESSING_PENDING";
  if (["FAILED", "INVALID"].includes(receipt.processingState)) return "BLOCKED";
  if (receipt.processingState !== "VALID") return "UNKNOWN";
  requireValue(typeof build.attributes.expired === "boolean", "INVALID_RESPONSE");
  receipt.expired = build.attributes.expired;
  const expiration = Date.parse(build.attributes.expirationDate);
  requireValue(Number.isFinite(expiration), "INVALID_RESPONSE");
  receipt.expirationDate = new Date(expiration).toISOString();
  const detail = resource((await api.get(`/v1/builds/${build.id}/buildBetaDetail?${new URLSearchParams({
    include: "build", "fields[buildBetaDetails]": "internalBuildState,externalBuildState,build",
    "fields[builds]": "version",
  })}`)).data, "buildBetaDetails");
  relationship(detail, "build", "builds", build.id);
  receipt.buildBetaDetailId = detail.id;
  receipt.internalBuildState = state(detail.attributes?.internalBuildState, INTERNAL);
  receipt.externalBuildState = state(detail.attributes?.externalBuildState, EXTERNAL);
  const groups = await api.list("/v1/betaGroups", {
    "filter[app]": app.id, "filter[builds]": build.id, include: "app",
    "fields[betaGroups]": "isInternalGroup,app", "fields[apps]": "bundleId",
  });
  const groupIds = new Set();
  for (const raw of groups) {
    const group = resource(raw, "betaGroups");
    requireValue(!groupIds.has(group.id), "INVALID_RESPONSE");
    groupIds.add(group.id);
    relationship(group, "app", "apps", app.id);
    requireValue(typeof group.attributes?.isInternalGroup === "boolean", "INVALID_RESPONSE");
    const testers = await api.list(`/v1/betaGroups/${group.id}/relationships/betaTesters`);
    const testerIds = new Set(testers.map((tester) => resource(tester, "betaTesters").id));
    const lane = group.attributes.isInternalGroup ? receipt.internalBuildState : receipt.externalBuildState;
    receipt.groups.push({
      id: group.id, isInternalGroup: group.attributes.isInternalGroup,
      buildState: lane, testerCount: testerIds.size,
      testerAvailable: lane === "IN_BETA_TESTING" && testerIds.size > 0
        && !receipt.expired && expiration > Date.now(),
    });
  }
  if (receipt.expired || expiration <= Date.now()) return "BLOCKED";
  if (receipt.groups.some((group) => group.testerAvailable)) return "TESTER_AVAILABLE";
  if (receipt.groups.some((group) => group.buildState === "UNKNOWN")
    || (!receipt.groups.length && [receipt.internalBuildState, receipt.externalBuildState].includes("UNKNOWN"))) return "UNKNOWN";
  if (receipt.groups.some((group) => BLOCKED.has(group.buildState))) return "BLOCKED";
  return "VALID_NOT_AVAILABLE";
}

export async function runReceipt(env, dependencies = {}) {
  const receipt = {
    schemaVersion: 1, queryStartedAt: new Date().toISOString(), target: null,
    verdict: "UNKNOWN", groups: [], error: null,
    limitation: "Apple API snapshot only. Group membership is not proof of invitation acceptance, device eligibility, or installation.",
  };
  try {
    receipt.target = selectors(env.TESTFLIGHT_MARKETING_VERSION, env.TESTFLIGHT_BUILD_NUMBER);
    const api = dependencies.api ?? appleClient(tokenSigner(env));
    receipt.verdict = await collectReceipt(receipt, api);
  } catch (error) {
    // The sole reporting boundary must never serialize arbitrary SDK/crypto/network errors.
    receipt.error = error instanceof ReceiptError
      ? { code: error.code, httpStatus: error.status }
      : { code: "INTERNAL_ERROR", httpStatus: null };
    receipt.verdict = "UNKNOWN";
  }
  receipt.queryCompletedAt = new Date().toISOString();
  return receipt;
}

export function receiptSummary(receipt) {
  return `## TestFlight availability receipt\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n`;
}

if (isDirectRun(import.meta.url)) {
  const receipt = await runReceipt(process.env);
  writeFileSync("testflight-receipt.json", `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, receiptSummary(receipt));
  console.log(`TestFlight receipt: ${receipt.verdict}${receipt.error ? ` (${receipt.error.code})` : ""}`);
  process.exitCode = receipt.verdict === "TESTER_AVAILABLE" ? 0 : 1;
}
