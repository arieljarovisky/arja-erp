import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { getPlanFeatureFlags } from "../services/subscriptionPlans.js";
import { getTenantFeatureFlags } from "../services/tenantFeatures.js";
import {
  buildUniqueBranchSlug,
  findTenantBranch,
  getBranchSummary,
  listTenantBranches,
  slugifyBranch,
} from "../services/branches.js";
import { ensureUserCanAccessBranch } from "../helpers/branchAccess.js";

const branches = Router();
branches.use(requireAuth);

async function ensureUniqueSlug(tenantId, baseSlug, db = pool) {
  return buildUniqueBranchSlug(tenantId, baseSlug, db);
}

async function getTenantPlanCode(tenantId) {
  const [[row]] = await pool.query(
    `SELECT plan_code
       FROM platform_subscription
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId]
  );
  return row?.plan_code;
}

async function getBranchLimit(tenantId) {
  const planCode = await getTenantPlanCode(tenantId);
  const planFeatures = getPlanFeatureFlags(planCode);
  const tenantFeatures = await getTenantFeatureFlags(tenantId);
  const multiBranchRaw =
    tenantFeatures.multiBranch ?? tenantFeatures.multi_branch ?? planFeatures.multiBranch;
  const multiBranch = Boolean(multiBranchRaw);
  const overrideMaxRaw = tenantFeatures.maxBranches ?? tenantFeatures.max_branches ?? null;
  const overrideNumber = overrideMaxRaw == null ? null : Number(overrideMaxRaw);
  const parsedOverride =
    overrideNumber != null && Number.isFinite(overrideNumber) ? overrideNumber : null;
  let maxBranches =
    parsedOverride != null ? parsedOverride : planFeatures.maxBranches ?? 1;
  if (!multiBranch) {
    maxBranches = Math.min(1, maxBranches ?? 1);
  }
  return {
    multiBranch,
    maxBranches: maxBranches ?? null,
  };
}

function safeParseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    name: row.name,
    slug: row.slug,
    description: row.description,
    email: row.email,
    phone: row.phone,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    zipCode: row.zip_code,
    country: row.country,
    isPrimary: row.is_primary === 1,
    isActive: row.is_active === 1,
    adminUserId: row.admin_user_id ? Number(row.admin_user_id) : null,
    adminUserEmail: row.admin_user_email || null,
    metadata: safeParseJson(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

branches.get("/catalog", async (req, res) => {
  console.log(`[GET /api/branches/catalog] Llamada recibida - Usuario: ${req.user?.id}, Tenant: ${req.tenant?.id}`);
  try {
    const tenantId = req.tenant?.id;
    if (!tenantId) {
      console.error("[GET /api/branches/catalog] Tenant no identificado");
      return res.status(400).json({ ok: false, error: "Tenant no identificado" });
    }

    if (!req.user?.id) {
      console.error("[GET /api/branches/catalog] Usuario no autenticado");
      return res.status(401).json({ ok: false, error: "Usuario no autenticado" });
    }

    const rows = await listTenantBranches(tenantId, { activeOnly: true });
    console.log(`[GET /api/branches/catalog] Usuario ${req.user.id} (${req.user.email}), rol: ${req.user.role}, total sucursales: ${rows.length}`);
    
    // Los administradores y super admins tienen acceso a todas las sucursales
    const isAdmin = req.user?.role === "admin" || req.user?.is_super_admin;
    
    let filtered = rows;
    if (!isAdmin) {
      const mode = req.user?.branch_access_mode || req.user?.branchAccessMode || "all";
      console.log(`[GET /api/branches/catalog] Usuario ${req.user.id} - modo acceso: ${mode}`);
      
      // Si el modo es "custom", cargar los branch_ids desde la BD si no están en req.user
      let allowedIds = null;
      if (mode === "custom") {
        let branchIds = req.user?.branch_ids || req.user?.branchIds || [];
        console.log(`[GET /api/branches/catalog] Usuario ${req.user.id} - branch_ids en req.user:`, branchIds);
        
        // Si no hay branch_ids cargados, cargarlos desde la BD
        if (!Array.isArray(branchIds) || branchIds.length === 0) {
          const [accessRows] = await pool.query(
            `SELECT branch_id FROM user_branch_access WHERE user_id = ?`,
            [req.user.id]
          );
          branchIds = accessRows.map((row) => Number(row.branch_id));
          console.log(`[GET /api/branches/catalog] Usuario ${req.user.id} - branch_ids desde BD:`, branchIds);
        }
        
        if (branchIds.length > 0) {
          allowedIds = new Set(branchIds.map((id) => Number(id)).filter(id => Number.isFinite(id) && id > 0));
          console.log(`[GET /api/branches/catalog] Usuario ${req.user.id} - allowedIds:`, Array.from(allowedIds));
        } else {
          console.log(`[GET /api/branches/catalog] Usuario ${req.user.id} - no tiene sucursales asignadas, devolviendo array vacío`);
        }
      }
      
      // Filtrar solo las sucursales a las que el usuario tiene acceso
      filtered = allowedIds
        ? rows.filter((row) => allowedIds.has(Number(row.id)))
        : rows; // Si mode es "all", mostrar todas
      
      console.log(`[GET /api/branches/catalog] Usuario ${req.user.id} - sucursales filtradas: ${filtered.length}`);
    }
    
    const result = {
      ok: true,
      data: filtered.map(mapRow),
      currentBranchId: req.user?.current_branch_id || req.user?.currentBranchId || null,
    };
    
    console.log(`[GET /api/branches/catalog] Respuesta para usuario ${req.user.id}: ${result.data.length} sucursales`);
    res.json(result);
  } catch (error) {
    console.error("[GET /api/branches/catalog] error:", error);
    console.error("[GET /api/branches/catalog] error stack:", error.stack);
    // Manejar errores de acceso a sucursal
    const statusCode = error?.statusCode || error?.status;
    if (statusCode === 403 || statusCode === 400) {
      return res.status(statusCode).json({ ok: false, error: error.message || "No se pudieron obtener las sucursales" });
    }
    res.status(500).json({ ok: false, error: error.message || "No se pudieron obtener las sucursales" });
  }
});

branches.post("/current", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const branchId = Number(req.body?.branchId);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return res.status(400).json({ ok: false, error: "Sucursal inválida" });
    }
    const branch = await findTenantBranch(tenantId, branchId, { activeOnly: true });
    if (!branch) {
      return res.status(404).json({ ok: false, error: "Sucursal no encontrada" });
    }
    
    // Cargar branch_ids desde la BD si el modo es "custom"
    // Esto asegura que los permisos estén actualizados incluso si el usuario acaba de recibir acceso
    const isAdmin = req.user?.role === "admin" || req.user?.is_super_admin;
    if (!isAdmin) {
      const mode = req.user?.branch_access_mode || req.user?.branchAccessMode || "all";
      if (mode === "custom") {
        // Siempre cargar los branch_ids desde la BD para tener los datos más recientes
        const [accessRows] = await pool.query(
          `SELECT branch_id FROM user_branch_access WHERE user_id = ?`,
          [req.user.id]
        );
        const branchIds = accessRows.map((row) => Number(row.branch_id));
        
        // Actualizar req.user con los branch_ids cargados
        req.user.branch_ids = branchIds;
        req.user.branchIds = branchIds;
        
        console.log(`[POST /api/branches/current] Usuario ${req.user.id} - branch_ids cargados desde BD:`, branchIds);
      }
    }
    
    ensureUserCanAccessBranch(req.user, branch.id);
    await pool.query(
      `UPDATE users SET current_branch_id = ? WHERE id = ? AND tenant_id = ?`,
      [branchId, req.user.id, tenantId]
    );
    req.user.current_branch_id = branchId;
    req.user.currentBranchId = branchId;
    res.json({ ok: true, branch: mapRow(branch) });
  } catch (error) {
    console.error("[POST /api/branches/current] error:", error);
    
    // Si es un error de permisos (403), devolver 403 en lugar de 500
    if (error.statusCode === 403) {
      return res.status(403).json({ ok: false, error: error.message || "No tenés permisos para esta sucursal" });
    }
    
    res.status(500).json({ ok: false, error: "No se pudo actualizar la sucursal activa" });
  }
});

branches.use(requireRole("admin"));

branches.get("/", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const [rows] = await pool.query(
      `SELECT 
         tb.*,
         u_admin.email AS admin_user_email
       FROM tenant_branch tb
       LEFT JOIN users u_admin ON u_admin.id = tb.admin_user_id AND u_admin.tenant_id = tb.tenant_id
       WHERE tb.tenant_id = ?
       ORDER BY tb.is_primary DESC, tb.name ASC`,
      [tenantId]
    );
    const limitInfo = await getBranchLimit(tenantId);
    res.json({
      ok: true,
      data: rows.map(mapRow),
      limit: limitInfo,
    });
  } catch (error) {
    console.error("[GET /api/branches] error:", error);
    res.status(500).json({ ok: false, error: "No se pudieron obtener las sucursales" });
  }
});

branches.post("/", async (req, res) => {
  const tenantId = req.tenant.id;
  const {
    name,
    slug: customSlug,
    description,
    email,
    phone,
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
    country,
    metadata,
    isPrimary = false,
  } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ ok: false, error: "El nombre de la sucursal es obligatorio" });
  }

  const conn = await pool.getConnection();
  try {
    const limitInfo = await getBranchLimit(tenantId);
    const [[countRow]] = await conn.query(
      `SELECT COUNT(*) AS total
         FROM tenant_branch
        WHERE tenant_id = ?
          AND is_active = 1`,
      [tenantId]
    );
    if (
      limitInfo.maxBranches != null &&
      Number(countRow.total) >= Number(limitInfo.maxBranches)
    ) {
      return res.status(409).json({
        ok: false,
        error: `Alcanzaste el máximo de ${limitInfo.maxBranches} sucursales para tu plan`,
      });
    }

    await conn.beginTransaction();
    const baseSlug = slugifyBranch(customSlug || name) || "sucursal";
    const uniqueSlug = await ensureUniqueSlug(tenantId, baseSlug, conn);

    const [[primaryRow]] = await conn.query(
      `SELECT COUNT(*) AS total
         FROM tenant_branch
        WHERE tenant_id = ?
          AND is_primary = 1`,
      [tenantId]
    );

    const shouldBePrimary = primaryRow.total === 0 ? 1 : isPrimary ? 1 : 0;
    if (shouldBePrimary) {
      await conn.query(`UPDATE tenant_branch SET is_primary = 0 WHERE tenant_id = ?`, [tenantId]);
    }

    const payload = {
      tenant_id: tenantId,
      name: String(name).trim(),
      slug: uniqueSlug,
      description: description ? String(description).trim() : null,
      email: email ? String(email).trim() : null,
      phone: phone ? String(phone).trim() : null,
      address_line1: addressLine1 ? String(addressLine1).trim() : null,
      address_line2: addressLine2 ? String(addressLine2).trim() : null,
      city: city ? String(city).trim() : null,
      state: state ? String(state).trim() : null,
      zip_code: zipCode ? String(zipCode).trim() : null,
      country: country ? String(country).trim() : null,
      is_primary: shouldBePrimary ? 1 : 0,
      metadata: metadata ? JSON.stringify(metadata) : null,
    };

    const columns = Object.keys(payload);
    const values = Object.values(payload);
    const placeholders = columns.map(() => "?").join(", ");
    const [insert] = await conn.query(
      `INSERT INTO tenant_branch (${columns.join(", ")})
       VALUES (${placeholders})`,
      values
    );

    await conn.commit();
    res.json({ ok: true, id: insert.insertId, slug: uniqueSlug });
  } catch (error) {
    await conn.rollback();
    console.error("[POST /api/branches] error:", error);
    res.status(500).json({ ok: false, error: "No se pudo crear la sucursal" });
  } finally {
    conn.release();
  }
});

branches.put("/:id", async (req, res) => {
  const tenantId = req.tenant.id;
  const branchId = Number(req.params.id);
  if (!Number.isInteger(branchId) || branchId <= 0) {
    return res.status(400).json({ ok: false, error: "Sucursal inválida" });
  }

  const {
    name,
    slug: customSlug,
    description,
    email,
    phone,
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
    country,
    metadata,
    isPrimary,
    isActive,
    adminUserId,
  } = req.body || {};

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[branch]] = await conn.query(
      `SELECT * FROM tenant_branch WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [branchId, tenantId]
    );
    if (!branch) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Sucursal no encontrada" });
    }

    const updates = [];
    const params = [];

    if (name !== undefined) {
      if (!String(name).trim()) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "El nombre es obligatorio" });
      }
      updates.push("name = ?");
      params.push(String(name).trim());
    }

    if (customSlug !== undefined) {
      const nextSlug = slugifyBranch(customSlug);
      if (!nextSlug) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "Slug inválido" });
      }
      const uniqueSlug =
        nextSlug === branch.slug ? branch.slug : await ensureUniqueSlug(tenantId, nextSlug, conn);
      updates.push("slug = ?");
      params.push(uniqueSlug);
    }

    if (description !== undefined) {
      updates.push("description = ?");
      params.push(description ? String(description).trim() : null);
    }
    if (email !== undefined) {
      updates.push("email = ?");
      params.push(email ? String(email).trim() : null);
    }
    if (phone !== undefined) {
      updates.push("phone = ?");
      params.push(phone ? String(phone).trim() : null);
    }
    if (addressLine1 !== undefined) {
      updates.push("address_line1 = ?");
      params.push(addressLine1 ? String(addressLine1).trim() : null);
    }
    if (addressLine2 !== undefined) {
      updates.push("address_line2 = ?");
      params.push(addressLine2 ? String(addressLine2).trim() : null);
    }
    if (city !== undefined) {
      updates.push("city = ?");
      params.push(city ? String(city).trim() : null);
    }
    if (state !== undefined) {
      updates.push("state = ?");
      params.push(state ? String(state).trim() : null);
    }
    if (zipCode !== undefined) {
      updates.push("zip_code = ?");
      params.push(zipCode ? String(zipCode).trim() : null);
    }
    if (country !== undefined) {
      updates.push("country = ?");
      params.push(country ? String(country).trim() : null);
    }
    if (metadata !== undefined) {
      updates.push("metadata = ?");
      params.push(metadata ? JSON.stringify(metadata) : null);
    }
    if (isActive !== undefined) {
      const nextActive = isActive ? 1 : 0;
      if (branch.is_primary && nextActive === 0) {
        await conn.rollback();
        return res
          .status(400)
          .json({ ok: false, error: "No podés desactivar la sucursal principal" });
      }
      if (nextActive === 0) {
        const [[activeCount]] = await conn.query(
          `SELECT COUNT(*) AS total
             FROM tenant_branch
            WHERE tenant_id = ?
              AND is_active = 1
              AND id <> ?`,
          [tenantId, branchId]
        );
        if (Number(activeCount.total) === 0) {
          await conn.rollback();
          return res
            .status(400)
            .json({ ok: false, error: "Debe existir al menos una sucursal activa" });
        }
      }
      updates.push("is_active = ?");
      params.push(nextActive);
    }

    if (isPrimary !== undefined) {
      if (isPrimary) {
        await conn.query(`UPDATE tenant_branch SET is_primary = 0 WHERE tenant_id = ?`, [tenantId]);
        updates.push("is_primary = 1");
      } else if (branch.is_primary) {
        await conn.rollback();
        return res
          .status(400)
          .json({ ok: false, error: "Debe existir una sucursal principal activa" });
      }
    }

    if (adminUserId !== undefined) {
      if (adminUserId === null || adminUserId === "") {
        // Permitir eliminar el administrador
        updates.push("admin_user_id = NULL");
      } else {
        const adminUserIdNum = Number(adminUserId);
        if (!Number.isInteger(adminUserIdNum) || adminUserIdNum <= 0) {
          await conn.rollback();
          return res.status(400).json({ ok: false, error: "ID de administrador inválido" });
        }
        // Verificar que el usuario existe y pertenece al tenant
        const [[user]] = await conn.query(
          `SELECT id FROM users WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`,
          [adminUserIdNum, tenantId]
        );
        if (!user) {
          await conn.rollback();
          return res.status(400).json({ ok: false, error: "El usuario especificado no existe o no está activo" });
        }
        updates.push("admin_user_id = ?");
        params.push(adminUserIdNum);
      }
    }

    if (!updates.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "No se enviaron cambios" });
    }

    params.push(branchId, tenantId);
    await conn.query(
      `UPDATE tenant_branch
          SET ${updates.join(", ")},
              updated_at = NOW()
        WHERE id = ?
          AND tenant_id = ?`,
      params
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error("[PUT /api/branches/:id] error:", error);
    res.status(500).json({ ok: false, error: "No se pudo actualizar la sucursal" });
  } finally {
    conn.release();
  }
});

branches.delete("/:id", async (req, res) => {
  const tenantId = req.tenant.id;
  const branchId = Number(req.params.id);
  if (!Number.isInteger(branchId) || branchId <= 0) {
    return res.status(400).json({ ok: false, error: "Sucursal inválida" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[branch]] = await conn.query(
      `SELECT id, tenant_id, is_primary, is_active
         FROM tenant_branch
        WHERE id = ? AND tenant_id = ?
        LIMIT 1`,
      [branchId, tenantId]
    );
    if (!branch) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Sucursal no encontrada" });
    }
    if (branch.is_primary === 1) {
      await conn.rollback();
      return res
        .status(400)
        .json({ ok: false, error: "No podés eliminar la sucursal principal" });
    }
    if (branch.is_active === 0) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "La sucursal ya está inactiva" });
    }
    const [[activeCount]] = await conn.query(
      `SELECT COUNT(*) AS total
         FROM tenant_branch
        WHERE tenant_id = ?
          AND is_active = 1`,
      [tenantId]
    );
    if (Number(activeCount.total) <= 1) {
      await conn.rollback();
      return res
        .status(400)
        .json({ ok: false, error: "Debe existir al menos una sucursal activa" });
    }

    await conn.query(
      `UPDATE tenant_branch
          SET is_active = 0,
              updated_at = NOW()
        WHERE id = ?
          AND tenant_id = ?`,
      [branchId, tenantId]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error("[DELETE /api/branches/:id] error:", error);
    res.status(500).json({ ok: false, error: "No se pudo eliminar la sucursal" });
  } finally {
    conn.release();
  }
});

export default branches;

