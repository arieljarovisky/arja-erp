// src/services/tenantFeatures.js
import { pool } from "../db.js";

const CACHE_MS = 60_000;
const featureCache = new Map();

function parseJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function mergeFeatures(base = {}, overrides = {}) {
  return {
    ...base,
    ...overrides,
  };
}

/**
 * Obtiene las banderas de features para un tenant.
 * Combina defaults del tipo de negocio + overrides del tenant.
 */
export async function getTenantFeatureFlags(tenantId) {
  if (!tenantId) {
    throw new Error("tenantId requerido en getTenantFeatureFlags");
  }

  const cached = featureCache.get(tenantId);
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_MS) {
    return cached.data;
  }

  const [[row]] = await pool.query(
    `SELECT 
        t.features_config,
        bt.features AS business_features
     FROM tenant t
     LEFT JOIN business_type bt ON bt.id = t.business_type_id
     WHERE t.id = ?
     LIMIT 1`,
    [tenantId]
  );

  if (!row) {
    featureCache.set(tenantId, { ts: now, data: {} });
    return {};
  }

  const businessFeatures = parseJson(row.business_features);
  const tenantFeatures = parseJson(row.features_config);

  const features = mergeFeatures(businessFeatures, tenantFeatures);
  featureCache.set(tenantId, { ts: now, data: features });
  return features;
}

export function invalidateTenantFeatureFlags(tenantId) {
  featureCache.delete(tenantId);
}

