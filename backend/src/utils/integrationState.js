import crypto from "crypto";

const STATE_SECRET = process.env.INTEGRATION_STATE_SECRET || "change-me";
const STATE_TTL_MS = 15 * 60 * 1000;

function base64UrlEncode(str) {
  return Buffer.from(str).toString("base64url");
}

function base64UrlDecode(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}

export function createIntegrationState(tenantId, provider) {
  const issuedAt = Date.now();
  const payload = `${tenantId}:${provider}:${issuedAt}`;
  const signature = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex");
  return base64UrlEncode(`${payload}:${signature}`);
}

export function parseIntegrationState(state) {
  if (!state) return null;
  try {
    const decoded = base64UrlDecode(state);
    const [tenantId, provider, issuedAtStr, signature] = decoded.split(":");
    if (!tenantId || !provider || !issuedAtStr || !signature) return null;
    const payload = `${tenantId}:${provider}:${issuedAtStr}`;
    const expectedSignature = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex");
    if (expectedSignature !== signature) return null;
    const issuedAt = Number(issuedAtStr);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > STATE_TTL_MS) {
      return null;
    }
    return { tenantId: Number(tenantId), provider };
  } catch (error) {
    console.error("[Integrations] Error parsing state:", error);
    return null;
  }
}

