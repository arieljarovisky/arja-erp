// src/routes/businessTypes.js
import express from "express";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../auth/middlewares.js";
import { getPlanDefinition, getPlanFeatureFlags } from "../services/subscriptionPlans.js";

const DEFAULT_FEATURES_BY_CODE = {
  salon: { classes: false },
  gym: { classes: true },
  pilates: { classes: true },
  kinesiology: { classes: false },
  spa: { classes: false },
  other: { classes: false },
};

const DEFAULT_SERVICES_BY_CODE = {
  salon: [
    { name: "Corte de cabello dama", duration_min: 60, price_decimal: 0 },
    { name: "Corte de cabello caballero", duration_min: 45, price_decimal: 0 },
    { name: "Color completo", duration_min: 90, price_decimal: 0 },
    { name: "Peinado y styling", duration_min: 45, price_decimal: 0 },
  ],
  gym: [
    { name: "Clase funcional grupal", duration_min: 60, price_decimal: 0 },
    { name: "Entrenamiento personalizado", duration_min: 60, price_decimal: 0 },
    { name: "Evaluación física", duration_min: 45, price_decimal: 0 },
  ],
  pilates: [
    { name: "Pilates Reformer grupal", duration_min: 60, price_decimal: 0 },
    { name: "Pilates Mat grupal", duration_min: 55, price_decimal: 0 },
    { name: "Pilates individual", duration_min: 60, price_decimal: 0 },
  ],
  kinesiology: [
    { name: "Sesión kinesiológica", duration_min: 45, price_decimal: 0 },
    { name: "Rehabilitación postural", duration_min: 60, price_decimal: 0 },
  ],
  spa: [
    { name: "Masaje descontracturante", duration_min: 60, price_decimal: 0 },
    { name: "Masaje relajante", duration_min: 60, price_decimal: 0 },
    { name: "Tratamiento facial", duration_min: 50, price_decimal: 0 },
  ],
};

async function replaceTenantServices(conn, tenantId, businessCode) {
  const templates = DEFAULT_SERVICES_BY_CODE[businessCode] || [];
  if (!templates.length) {
    // Si no hay templates, solo marcamos todos los servicios como inactivos
    // pero solo los que no tienen turnos asociados
    const [servicesWithAppointments] = await conn.query(
      `SELECT DISTINCT service_id 
       FROM appointment 
       WHERE tenant_id = ? 
         AND service_id IS NOT NULL`,
      [tenantId]
    );
    const idsWithAppointments = new Set(
      servicesWithAppointments.map((row) => row.service_id)
    );

    if (idsWithAppointments.size > 0) {
      await conn.query(
        `UPDATE service 
         SET is_active = 0 
         WHERE tenant_id = ? 
           AND id NOT IN (?)`,
        [tenantId, Array.from(idsWithAppointments)]
      );
    } else {
      // Si no hay turnos, podemos marcar todos como inactivos
      await conn.query(`UPDATE service SET is_active = 0 WHERE tenant_id = ?`, [tenantId]);
    }
    return 0;
  }

  // Obtener servicios existentes del tenant
  const [existingServices] = await conn.query(
    `SELECT id, name, is_active FROM service WHERE tenant_id = ?`,
    [tenantId]
  );

  const existingNames = new Set(existingServices.map((s) => s.name.toLowerCase().trim()));
  const templateNames = new Set(templates.map((t) => t.name.toLowerCase().trim()));

  // Marcar como inactivos los servicios que no están en la lista de templates
  // pero solo si no tienen turnos asociados
  const servicesToDeactivate = existingServices.filter(
    (s) => !templateNames.has(s.name.toLowerCase().trim())
  );

  if (servicesToDeactivate.length > 0) {
    const idsToDeactivate = servicesToDeactivate.map((s) => s.id);
    // Verificar cuáles tienen turnos asociados
    const [servicesWithAppointments] = await conn.query(
      `SELECT DISTINCT service_id 
       FROM appointment 
       WHERE tenant_id = ? 
         AND service_id IS NOT NULL
         AND service_id IN (?)`,
      [tenantId, idsToDeactivate]
    );
    const idsWithAppointments = new Set(
      servicesWithAppointments.map((row) => row.service_id)
    );
    const idsToDeactivateSafe = idsToDeactivate.filter(
      (id) => !idsWithAppointments.has(id)
    );

    if (idsToDeactivateSafe.length > 0) {
      await conn.query(
        `UPDATE service 
         SET is_active = 0 
         WHERE tenant_id = ? 
           AND id IN (?)`,
        [tenantId, idsToDeactivateSafe]
      );
    }
  }

  // Insertar solo los servicios nuevos que no existen
  const newServices = templates.filter(
    (tpl) => !existingNames.has(tpl.name.toLowerCase().trim())
  );

  if (newServices.length > 0) {
    const values = newServices.map((tpl) => [
    tenantId,
    tpl.name,
    tpl.duration_min ?? 60,
    tpl.price_decimal ?? 0,
      1, // is_active
  ]);

  await conn.query(
    `
    INSERT INTO service (tenant_id, name, duration_min, price_decimal, is_active)
    VALUES ?
    `,
    [values]
  );
  }

  // Reactivar servicios existentes que están en la lista de templates
  const servicesToReactivate = existingServices.filter(
    (s) => templateNames.has(s.name.toLowerCase().trim()) && s.is_active === 0
  );

  if (servicesToReactivate.length > 0) {
    const idsToReactivate = servicesToReactivate.map((s) => s.id);
    await conn.query(
      `UPDATE service SET is_active = 1 WHERE tenant_id = ? AND id IN (?)`,
      [tenantId, idsToReactivate]
    );
  }

  return newServices.length;
}

function normalizeFeaturesConfig(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed != null ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

const router = express.Router();

// GET /api/business-types - Listar tipos de negocio disponibles
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, code, name, description, icon, features 
       FROM business_type 
       ORDER BY name`
    );
    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[GET /api/business-types] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/business-types/:code - Obtener un tipo específico
router.get("/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const [[row]] = await pool.query(
      `SELECT id, code, name, description, icon, features 
       FROM business_type 
       WHERE code = ?`,
      [code]
    );
    if (!row) {
      return res.status(404).json({ ok: false, error: "Tipo de negocio no encontrado" });
    }
    res.json({ ok: true, data: row });
  } catch (error) {
    console.error("[GET /api/business-types/:code] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/tenant/business-type - Obtener tipo de negocio del tenant actual
router.get("/tenant/business-type", requireAuth, async (req, res) => {
  try {
    const tenantId = req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    const [[tenant]] = await pool.query(
      `SELECT t.business_type_id, bt.code, bt.name, bt.description, bt.icon, bt.features, t.features_config
       FROM tenant t
       LEFT JOIN business_type bt ON t.business_type_id = bt.id
       WHERE t.id = ?`,
      [tenantId]
    );

    if (!tenant) {
      return res.status(404).json({ ok: false, error: "Tenant no encontrado" });
    }

    let plan = null;
    try {
      const [[subscription]] = await pool.query(
        `SELECT plan_code, plan_label, currency, amount, status, mp_status, activated_at, last_payment_at, next_charge_at, payer_email
         FROM platform_subscription
         WHERE tenant_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [tenantId]
      );
      if (subscription) {
        const planDef = getPlanDefinition(subscription.plan_code);
        plan = {
          code: planDef.code,
          label: subscription.plan_label || planDef.label,
          amount: subscription.amount != null ? Number(subscription.amount) : planDef.amount,
          currency: subscription.currency || planDef.currency || "ARS",
          status: subscription.status,
          mp_status: subscription.mp_status,
          activated_at: subscription.activated_at,
          last_payment_at: subscription.last_payment_at,
          next_charge_at: subscription.next_charge_at,
          payer_email: subscription.payer_email,
          features: planDef.features || getPlanFeatureFlags(subscription.plan_code),
        };
      }
    } catch (error) {
      console.warn("[businessTypes] No se pudo obtener plan activo:", error.message);
    }

    res.json({ ok: true, data: { ...tenant, plan } });
  } catch (error) {
    console.error("[GET /api/business-types/tenant/business-type] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// PUT /api/tenant/business-type - Actualizar tipo de negocio del tenant
router.put("/tenant/business-type", requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { business_type_id, features_config, tenant_id: targetTenant } = req.body || {};
    const isSuperAdmin = req.user?.is_super_admin || req.user?.isSuperAdmin;
    const canUpdateFeatures = Boolean(isSuperAdmin);
    const tenantId = isSuperAdmin && targetTenant != null ? Number(targetTenant) : req.tenant_id || req.user?.tenant_id;

    if (!tenantId || Number.isNaN(tenantId)) {
      conn.release();
      return res.status(403).json({ ok: false, error: "Tenant no identificado" });
    }

    await conn.beginTransaction();

    const [[tenantRow]] = await conn.query(
      `
      SELECT business_type_id
      FROM tenant
      WHERE id = ?
      FOR UPDATE
      `,
      [tenantId]
    );

    if (!tenantRow) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ ok: false, error: "Tenant no encontrado" });
    }

    const currentBusinessTypeId = tenantRow.business_type_id;
    let targetBusinessTypeId = currentBusinessTypeId;
    let businessTypeChanged = false;
    let businessTypeCode = null;

    if (business_type_id !== undefined) {
      const normalized = Number(business_type_id);
      if (Number.isNaN(normalized)) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ ok: false, error: "Tipo de negocio inválido" });
      }

      if (!isSuperAdmin && normalized !== currentBusinessTypeId) {
        await conn.rollback();
        conn.release();
        return res.status(403).json({
          ok: false,
          error: "Solo el dueño del sistema puede cambiar el tipo de negocio. Contactá al equipo comercial.",
        });
      }

      const [[btRow]] = await conn.query(
        `SELECT id, code FROM business_type WHERE id = ? LIMIT 1`,
        [normalized]
      );
      if (!btRow) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ ok: false, error: "Tipo de negocio no válido" });
      }

      targetBusinessTypeId = btRow.id;
      businessTypeCode = btRow.code;
      businessTypeChanged = btRow.id !== currentBusinessTypeId;
    } else {
      if (currentBusinessTypeId != null) {
        const [[btRow]] = await conn.query(
          `SELECT id, code FROM business_type WHERE id = ? LIMIT 1`,
          [currentBusinessTypeId]
        );
        businessTypeCode = btRow?.code || null;
      }
    }

    const updates = [];
    const params = [];

    if (businessTypeChanged) {
      updates.push("business_type_id = ?");
      params.push(targetBusinessTypeId);
    }

    const featuresPayload = canUpdateFeatures ? features_config : undefined;
    const requestedFeatures = normalizeFeaturesConfig(featuresPayload);

    let storedFeatures = null;

    if (featuresPayload !== undefined || businessTypeChanged) {
      const defaultFeatures = businessTypeCode ? (DEFAULT_FEATURES_BY_CODE[businessTypeCode] || {}) : {};
      const mergedFeatures = {
        ...defaultFeatures,
        ...(requestedFeatures || {}),
      };
      updates.push("features_config = ?");
      storedFeatures = mergedFeatures;
      params.push(JSON.stringify(mergedFeatures));
    }

    if (!updates.length) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ ok: false, error: "No hay cambios para actualizar" });
    }

    params.push(tenantId);
    await conn.query(
      `UPDATE tenant SET ${updates.join(", ")} WHERE id = ?`,
      params
    );

    let resetCount = 0;
    if (businessTypeChanged && businessTypeCode) {
      resetCount = await replaceTenantServices(conn, tenantId, businessTypeCode);
    }

    await conn.commit();
    conn.release();

    return res.json({
      ok: true,
      businessTypeChanged,
      features: storedFeatures,
      resetServices: resetCount,
      tenantId,
      message: businessTypeChanged
        ? `Tipo de negocio actualizado. Se cargaron ${resetCount} servicios base.`
        : "Configuración actualizada.",
    });
  } catch (error) {
    await (conn?.rollback?.().catch(() => {}));
    conn?.release?.();
    console.error("[PUT /api/business-types/tenant/business-type] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;

