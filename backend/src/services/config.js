// src/services/config.js — MULTI-TENANT con cache separada
import { pool } from "../db.js";

const CACHE_MS = 30_000; // 30 segundos
const tenantCache = new Map(); // tenant_id -> { ts, data }

function parseValue(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (!Number.isNaN(Number(v)) && v.trim() !== "") return Number(v);
  return v;
}

/**
 * ✅ Carga config de un tenant específico
 */
async function loadAllForTenant(tenantId) {
  if (!tenantId) {
    throw new Error("tenantId requerido en loadAllForTenant");
  }
  
  const [rows] = await pool.query(
    "SELECT config_key, config_value FROM system_config WHERE tenant_id = ?",
    [tenantId]
  );
  
  const obj = {};
  for (const r of rows) {
    obj[r.config_key] = parseValue(String(r.config_value ?? ""));
  }
  
  return obj;
}

/**
 * ✅ Obtiene snapshot de config (con cache por tenant)
 */
export async function getConfigSnapshot(force = false, tenantId) {
  if (!tenantId) {
    throw new Error("tenantId requerido en getConfigSnapshot");
  }
  
  const now = Date.now();
  const cached = tenantCache.get(tenantId);
  
  // ✅ Usar cache si es reciente
  if (!force && cached && (now - cached.ts < CACHE_MS)) {
    return cached.data;
  }
  
  // ✅ Cargar desde DB
  const data = await loadAllForTenant(tenantId);
  tenantCache.set(tenantId, { ts: now, data });
  
  return data;
}

/**
 * ✅ Obtiene una sección de config
 */
export async function getSection(section, tenantId) {
  if (!tenantId) {
    throw new Error("tenantId requerido en getSection");
  }
  
  const all = await getConfigSnapshot(false, tenantId);
  const out = {};
  const prefix = `${section}.`;
  
  for (const k of Object.keys(all)) {
    if (k.startsWith(prefix)) {
      out[k.slice(prefix.length)] = all[k];
    }
  }
  
  return out;
}

/**
 * ✅ Helpers tipados
 */
export async function cfgNumber(key, def, tenantId) {
  if (!tenantId) {
    throw new Error("tenantId requerido en cfgNumber");
  }
  
  const all = await getConfigSnapshot(false, tenantId);
  const v = all[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : def;
}

export async function cfgBool(key, def, tenantId) {
  if (!tenantId) {
    throw new Error("tenantId requerido en cfgBool");
  }
  
  const all = await getConfigSnapshot(false, tenantId);
  const v = all[key];
  return typeof v === "boolean" ? v : def;
}

export async function cfgString(key, def, tenantId) {
  if (!tenantId) {
    throw new Error("tenantId requerido en cfgString");
  }
  
  const all = await getConfigSnapshot(false, tenantId);
  const v = all[key];
  return typeof v === "string" ? v : def;
}

/**
 * ✅ Invalida cache de un tenant (llamar después de UPDATE)
 */
export function invalidateTenantCache(tenantId) {
  tenantCache.delete(tenantId);
}