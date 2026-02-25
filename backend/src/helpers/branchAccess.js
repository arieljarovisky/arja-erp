import { pool } from "../db.js";

function branchError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function branchPermissionError(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

export function isAdminUser(user) {
  if (!user) return false;
  if (user.is_super_admin) return true;
  const role = String(user.role || "").toLowerCase();
  return role === "admin";
}

export function getUserBranchId(user) {
  if (!user) return null;
  const raw = user.current_branch_id ?? user.currentBranchId;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function getUserBranchAccess(user) {
  const mode =
    user?.branch_access_mode ||
    user?.branchAccessMode ||
    "all";
  const rawList = user?.branch_ids || user?.branchIds || [];
  const ids = Array.isArray(rawList)
    ? rawList
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    : [];
  return {
    mode: mode === "custom" ? "custom" : "all",
    branchIds: Array.from(new Set(ids)),
  };
}

export function ensureUserCanAccessBranch(user, branchId) {
  const { mode, branchIds } = getUserBranchAccess(user);
  if (mode === "custom") {
    const numeric = Number(branchId);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw branchPermissionError("No tenés permisos para esta sucursal.");
    }
    if (!branchIds.includes(numeric)) {
      throw branchPermissionError("No tenés permisos para esta sucursal.");
    }
  }
}

export async function ensureBranchBelongsToTenant(tenantId, branchId, conn = pool) {
  if (!tenantId || !branchId) return null;
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, name, slug, is_primary, is_active
       FROM tenant_branch
      WHERE tenant_id = ? AND id = ?
      LIMIT 1`,
    [tenantId, branchId]
  );
  return row || null;
}

export async function resolveBranchForWrite(req, { branchId, conn = pool } = {}) {
  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw branchError("Tenant no identificado");
  }

  const provided =
    branchId != null && branchId !== ""
      ? Number(branchId)
      : null;

  if (provided && (!Number.isFinite(provided) || provided <= 0)) {
    throw branchError("Sucursal inválida");
  }

  const fallback = getUserBranchId(req.user);
  const targetBranchId = provided || fallback;
  if (!targetBranchId) {
    throw branchError("Seleccioná una sucursal activa para continuar");
  }

  const branch = await ensureBranchBelongsToTenant(tenantId, targetBranchId, conn);
  if (!branch) {
    throw branchError("La sucursal indicada no pertenece a este negocio");
  }
  if (!branch.is_active) {
    throw branchError("La sucursal indicada está inactiva");
  }
  
  // Cargar branch_ids desde la BD si el modo es "custom" para asegurar permisos actualizados
  const isAdmin = isAdminUser(req.user);
  if (!isAdmin) {
    const mode = req.user?.branch_access_mode || req.user?.branchAccessMode || "all";
    if (mode === "custom") {
      // Cargar los branch_ids más recientes desde la BD
      const [accessRows] = await conn.query(
        `SELECT branch_id FROM user_branch_access WHERE user_id = ?`,
        [req.user.id]
      );
      const branchIds = accessRows.map((row) => Number(row.branch_id));
      
      // Actualizar req.user con los branch_ids cargados
      req.user.branch_ids = branchIds;
      req.user.branchIds = branchIds;
    }
  }
  
  // Verificar que el usuario tenga acceso a la sucursal
  // Esto permite que usuarios no-admin seleccionen sucursales a las que tienen acceso
  ensureUserCanAccessBranch(req.user, branch.id);
  return branch;
}

export function resolveBranchFilter(req, { allowAll = true } = {}) {
  const isAdmin = isAdminUser(req.user);
  const access = getUserBranchAccess(req.user);
  let requestedRaw = req.query?.branchId;
  
  // Si branchId es un array, tomar el último valor válido (el más reciente)
  if (Array.isArray(requestedRaw)) {
    // Buscar el último valor válido en el array
    for (let i = requestedRaw.length - 1; i >= 0; i--) {
      const value = String(requestedRaw[i]).trim();
      if (value !== "" && value !== "undefined" && value !== "null") {
        requestedRaw = value;
        break;
      }
    }
    // Si todos los valores del array son inválidos, tratarlo como si no existiera
    if (Array.isArray(requestedRaw)) {
      requestedRaw = undefined;
    }
  }
  
  // Si el branchId es una cadena vacía, null, undefined, o "undefined", tratarlo como si no existiera
  if (requestedRaw !== undefined && requestedRaw !== null && String(requestedRaw).trim() !== "" && String(requestedRaw).trim() !== "undefined" && String(requestedRaw).trim() !== "null") {
    const requestedStr = String(requestedRaw).trim();
    
    if (requestedStr.toLowerCase() === "all") {
      if (allowAll && isAdmin && access.mode === "all") {
        return { mode: "all", branchId: null };
      }
      throw branchPermissionError("No tenés acceso a todas las sucursales.");
    }

    const requestedId = Number(requestedStr);
    if (!Number.isFinite(requestedId) || requestedId <= 0 || isNaN(requestedId)) {
      console.error("[resolveBranchFilter] branchId inválido:", { requestedRaw, requestedStr, requestedId, query: req.query });
      throw branchError("Sucursal inválida");
    }
    ensureUserCanAccessBranch(req.user, requestedId);
    return { mode: "single", branchId: requestedId };
  }

  const branchId = getUserBranchId(req.user);
  if (!branchId) {
    throw branchError("Definí una sucursal activa para continuar");
  }
  ensureUserCanAccessBranch(req.user, branchId);
  return { mode: "single", branchId };
}

export async function getPrimaryBranchId(tenantId, conn = pool) {
  if (!tenantId) return null;
  const [[row]] = await conn.query(
    `SELECT id FROM tenant_branch WHERE tenant_id = ? AND is_primary = 1 LIMIT 1`,
    [tenantId]
  );
  return row?.id || null;
}


