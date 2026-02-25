import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import fetch from "node-fetch";
import { pool } from "../db.js";
import { recommendPlanForSession } from "../services/onboarding.js";
import { getPlanDefinition } from "../services/subscriptionPlans.js";
import { ensurePrimaryBranch, getPrimaryBranchId } from "../services/branches.js";
import { validatePassword, getPasswordErrorMessage } from "../utils/passwordValidation.js";

const router = Router();

const STATUS_ENUM = ["draft", "completed", "abandoned"];
const PLATFORM_MP_TOKEN =
  process.env.MP_ACCESS_TOKEN ||
  process.env.MP_ACCESS_TOKEN ||
  "";
const FRONTEND_BASE =
  process.env.FRONTEND_URL_HTTPS ||
  process.env.FRONTEND_URL ||
  process.env.APP_FRONTEND_URL ||
  process.env.PUBLIC_FRONTEND_URL ||
  "";

function frontendUrl(path = "") {
  const base = FRONTEND_BASE ? String(FRONTEND_BASE).replace(/\/+$/, "") : "";
  if (!base) return "https://arjaerp.com";
  let normalized = base;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  } else if (/^http:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^http:\/\//i, "https://");
  }
  normalized = normalized.replace(/\/+$/, "");
  if (!path) return normalized;
  return `${normalized}${path.startsWith("/") ? path : `/${path}`}`;
}

function parseJSON(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeSession(row) {
  if (!row) return null;
  return {
    id: row.public_id,
    email: row.email,
    ownerName: row.owner_name,
    phone: row.phone,
    business: parseJSON(row.business_data, {}),
    features: parseJSON(row.feature_flags, {}),
    branding: parseJSON(row.branding, {}),
    plan: parseJSON(row.plan_recommendation, {}),
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSessionByPublicId(publicId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT *
     FROM onboarding_session
     WHERE public_id = ?
     LIMIT 1`,
    [publicId]
  );
  return rows[0] || null;
}

async function resolveTenantInfo(sessionRow, connection = pool) {
  if (!sessionRow) return null;
  if (sessionRow.tenant_id) {
    const [rows] = await connection.query(
      `SELECT id, subdomain, name
       FROM tenant
       WHERE id = ?
       LIMIT 1`,
      [sessionRow.tenant_id]
    );
    if (rows.length) return rows[0];
  }
  const branding = parseJSON(sessionRow.branding, {});
  const slug = sessionRow.tenant_slug || branding.subdomain;
  if (slug) {
    const [rows] = await connection.query(
      `SELECT id, subdomain, name
       FROM tenant
       WHERE subdomain = ?
       LIMIT 1`,
      [slug]
    );
    if (rows.length) return rows[0];
  }
  return null;
}

async function ensureSubdomainAvailable(subdomain, excludeTenantId = null) {
  if (!subdomain) return false;
  const [rows] = await pool.query(
    `SELECT id FROM tenant WHERE subdomain = ? ${excludeTenantId ? "AND id <> ?" : ""} LIMIT 1`,
    excludeTenantId ? [subdomain, excludeTenantId] : [subdomain]
  );
  return rows.length === 0;
}

async function tableExists(table) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [table]
  );
  return Number(row?.total || 0) > 0;
}

async function getTableColumns(table) {
  const exists = await tableExists(table);
  if (!exists) return [];
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return rows;
}

function filterDataByColumns(data, columns, { exclude = [] } = {}) {
  if (!data || typeof data !== "object") return {};
  const allowed = new Set(columns.map((col) => col.COLUMN_NAME));
  const excluded = new Set(exclude);
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (!allowed.has(key)) continue;
    if (excluded.has(key)) continue;
    if (value === undefined) continue;
    result[key] = value;
  }
  return result;
}

// Endpoint para verificar si un email ya está registrado
router.get("/check-email", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ ok: false, error: "Email requerido" });
    }
    const emailLower = String(email).trim().toLowerCase();
    
    const [[existingOwner]] = await pool.query(
      `SELECT id, tenant_id FROM users WHERE email = ? LIMIT 1`,
      [emailLower]
    );
    
    if (existingOwner) {
      return res.json({ 
        ok: true, 
        exists: true, 
        error: "Este email ya está registrado como propietario de otro local" 
      });
    }
    
    return res.json({ ok: true, exists: false });
  } catch (error) {
    console.error("[ONBOARDING][CHECK-EMAIL] error:", error);
    res.status(500).json({ ok: false, error: "Error verificando email" });
  }
});

router.post("/start", async (req, res) => {
  try {
    const { email, owner_name, phone } = req.body || {};
    if (!email) {
      return res.status(400).json({ ok: false, error: "Email requerido" });
    }
    const emailLower = String(email).trim().toLowerCase();
    const ownerName = owner_name ? String(owner_name).trim() : null;
    const phoneNorm = phone ? String(phone).trim() : null;

    const [[existing]] = await pool.query(
      `SELECT * FROM onboarding_session WHERE email = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 1`,
      [emailLower]
    );

    if (existing) {
      await pool.query(
        `UPDATE onboarding_session
         SET owner_name = ?, phone = ?, updated_at = NOW()
         WHERE id = ?`,
        [ownerName, phoneNorm, existing.id]
      );
      const session = await getSessionByPublicId(existing.public_id);
      return res.json({ ok: true, session: serializeSession(session) });
    }

    const publicId = randomUUID();
    await pool.query(
      `INSERT INTO onboarding_session (public_id, email, owner_name, phone)
       VALUES (?, ?, ?, ?)`,
      [publicId, emailLower, ownerName, phoneNorm]
    );

    const session = await getSessionByPublicId(publicId);
    res.status(201).json({ ok: true, session: serializeSession(session) });
  } catch (error) {
    console.error("[ONBOARDING][START] error:", error);
    res.status(500).json({ ok: false, error: "Error iniciando onboarding" });
  }
});

router.patch("/:sessionId/business", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionRow = await getSessionByPublicId(sessionId);
    if (!sessionRow || sessionRow.status !== "draft") {
      return res.status(404).json({ ok: false, error: "Sesión no encontrada" });
    }

    const session = serializeSession(sessionRow);
    const business = req.body?.business || {};
    const features = req.body?.features || {};

    const mergedBusiness = { ...(session.business || {}), ...business };
    const mergedFeatures = { ...(session.features || {}), ...features };

    await pool.query(
      `UPDATE onboarding_session
       SET business_data = ?, feature_flags = ?, updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(mergedBusiness), JSON.stringify(mergedFeatures), sessionRow.id]
    );

    const updated = await getSessionByPublicId(sessionId);
    res.json({ ok: true, session: serializeSession(updated) });
  } catch (error) {
    console.error("[ONBOARDING][BUSINESS] error:", error);
    res.status(500).json({ ok: false, error: "Error guardando información del negocio" });
  }
});

router.patch("/:sessionId/branding", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionRow = await getSessionByPublicId(sessionId);
    if (!sessionRow || sessionRow.status !== "draft") {
      return res.status(404).json({ ok: false, error: "Sesión no encontrada" });
    }

    const session = serializeSession(sessionRow);
    const branding = req.body?.branding || {};
    const desiredSubdomain = branding.subdomain ? String(branding.subdomain).trim().toLowerCase() : null;

    if (desiredSubdomain) {
      const available = await ensureSubdomainAvailable(desiredSubdomain);
      if (!available) {
        return res.status(409).json({ ok: false, error: "Subdominio no disponible" });
      }
      branding.subdomain = desiredSubdomain;
    }

    const mergedBranding = { ...(session.branding || {}), ...branding };

    await pool.query(
      `UPDATE onboarding_session
       SET branding = ?, updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(mergedBranding), sessionRow.id]
    );

    const updated = await getSessionByPublicId(sessionId);
    res.json({ ok: true, session: serializeSession(updated) });
  } catch (error) {
    console.error("[ONBOARDING][BRANDING] error:", error);
    res.status(500).json({ ok: false, error: "Error guardando personalización" });
  }
});

router.get("/check-subdomain", async (req, res) => {
  try {
    const slug = String(req.query?.slug || "").trim().toLowerCase();
    if (!slug) {
      return res.status(400).json({ ok: false, error: "Slug requerido" });
    }
    const available = await ensureSubdomainAvailable(slug);
    res.json({ ok: true, available });
  } catch (error) {
    console.error("[ONBOARDING][CHECK_SUBDOMAIN] error:", error);
    res.status(500).json({ ok: false, error: "Error verificando subdominio" });
  }
});

router.post("/:sessionId/recommend-plan", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionRow = await getSessionByPublicId(sessionId);
    if (!sessionRow) {
      return res.status(404).json({ ok: false, error: "Sesión no encontrada" });
    }

    const session = serializeSession(sessionRow);
    const recommendation = recommendPlanForSession(session);

    await pool.query(
      `UPDATE onboarding_session
       SET plan_recommendation = ?, updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(recommendation), sessionRow.id]
    );

    res.json({ ok: true, recommendation });
  } catch (error) {
    console.error("[ONBOARDING][RECOMMEND] error:", error);
    res.status(500).json({ ok: false, error: "Error generando recomendación" });
  }
});

router.post("/:sessionId/finish", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { sessionId } = req.params;
    const { password } = req.body || {};

    // Validar contraseña con restricciones de seguridad
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      connection.release();
      return res.status(400).json({ 
        ok: false, 
        error: getPasswordErrorMessage(passwordValidation),
        requirements: passwordValidation.requirements
      });
    }

    await connection.beginTransaction();

    const [sessionRows] = await connection.query(
      `SELECT * FROM onboarding_session WHERE public_id = ? FOR UPDATE`,
      [sessionId]
    );
    const sessionRow = sessionRows[0];
    if (!sessionRow) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ ok: false, error: "Sesión no encontrada" });
    }
    if (sessionRow.status !== "draft") {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ ok: false, error: "La sesión ya fue completada" });
    }

    const session = serializeSession(sessionRow);
    const branding = session.branding || {};
    const business = session.business || {};
    const features = session.features || {};

    if (!branding.name || !branding.subdomain) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ ok: false, error: "Falta nombre comercial o subdominio" });
    }

    const subdomainAvailable = await ensureSubdomainAvailable(branding.subdomain);
    if (!subdomainAvailable) {
      await connection.rollback();
      connection.release();
      return res.status(409).json({ ok: false, error: "El subdominio ya está en uso" });
    }

    // Validar que el email del owner/admin sea único globalmente
    // Solo el email del propietario que crea el tenant debe ser único
    // Los usuarios creados después dentro del tenant pueden tener emails que ya existen en otros tenants
    const emailLower = String(session.email).trim().toLowerCase();
    const [[existingOwner]] = await connection.query(
      `SELECT id, tenant_id FROM users WHERE email = ? LIMIT 1`,
      [emailLower]
    );
    if (existingOwner) {
      await connection.rollback();
      connection.release();
      return res.status(409).json({ ok: false, error: "Este email ya está registrado como propietario de otro local" });
    }

    const tenantColumns = await getTableColumns("tenant");
    const tenantData = {
      name: branding.name,
      subdomain: branding.subdomain,
      status: "trial",
    };

    const hasBusinessTypeColumn = tenantColumns.some((c) => c.COLUMN_NAME === "business_type_id");
    if (hasBusinessTypeColumn) {
      if (business.business_type_id) {
        const numeric = Number(business.business_type_id);
        if (Number.isFinite(numeric) && numeric > 0) {
          tenantData.business_type_id = numeric;
        }
      }
      if (
        tenantData.business_type_id == null &&
        business.business_type
      ) {
        const [[btRow]] = await connection.query(
          `SELECT id FROM business_type WHERE id = ? OR code = ? LIMIT 1`,
          [Number(business.business_type) || 0, business.business_type]
        );
        if (btRow) {
          tenantData.business_type_id = btRow.id;
        }
      }
    }

    if (tenantColumns.some((c) => c.COLUMN_NAME === "features_config")) {
      tenantData.features_config = JSON.stringify(features || {});
    }

    const insertData = filterDataByColumns(tenantData, tenantColumns, {
      exclude: ["id", "created_at", "updated_at", "deleted_at"],
    });

    if (!insertData.name || !insertData.subdomain) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ ok: false, error: "Datos insuficientes para crear tenant" });
    }

    const tenantColumnsList = Object.keys(insertData);
    const tenantValues = tenantColumnsList.map((key) => insertData[key]);
    const tenantPlaceholders = tenantColumnsList.map(() => "?").join(", ");

    const [tenantResult] = await connection.query(
      `INSERT INTO tenant (${tenantColumnsList.join(", ")}) VALUES (${tenantPlaceholders})`,
      tenantValues
    );

    const tenantId = tenantResult.insertId;
    await ensurePrimaryBranch(tenantId, insertData.name, connection);

    if (await tableExists("tenant_settings") && Object.keys(branding).length) {
      const settingsData = {
        tenant_id: tenantId,
        display_name: branding.name,
        color_primary: branding.color_primary || null,
        color_secondary: branding.color_secondary || null,
        logo_url: branding.logo_url || null,
      };

      const settingsColumns = await getTableColumns("tenant_settings");
      const filteredSettings = filterDataByColumns(settingsData, settingsColumns, {
        exclude: ["id", "created_at", "updated_at"],
      });

      if (Object.keys(filteredSettings).length) {
        const settingsCols = Object.keys(filteredSettings);
        const settingsValues = settingsCols.map((key) => filteredSettings[key]);
        const placeholders = settingsCols.map(() => "?").join(", ");
        await connection.query(
          `INSERT INTO tenant_settings (${settingsCols.join(", ")}) VALUES (${placeholders})`,
          settingsValues
        );
      }
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const basePermissions = {
      config: ["admin"],
      appointments: ["admin"],
      customers: ["admin"],
      users: ["admin"],
      stock: ["admin"],
      invoicing: ["admin"],
    };

    const ownerBranchId = await getPrimaryBranchId(tenantId, insertData.name, connection);
    await connection.query(
      `INSERT INTO users (tenant_id, current_branch_id, email, password_hash, role, permissions, is_active)
       VALUES (?, ?, ?, ?, 'admin', ?, 1)`,
      [tenantId, ownerBranchId, session.email, passwordHash, JSON.stringify(basePermissions)]
    );

    const recommendation = session.plan && session.plan.recommended
      ? session.plan
      : recommendPlanForSession(session);

    await connection.query(
      `UPDATE onboarding_session
       SET status = 'completed',
           completed_at = NOW(),
           plan_recommendation = ?,
           tenant_id = ?,
           tenant_slug = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(recommendation), tenantId, branding.subdomain, sessionRow.id]
    );

    await connection.commit();
    connection.release();

    res.status(201).json({
      ok: true,
      tenant: {
        id: tenantId,
        subdomain: branding.subdomain,
        name: branding.name,
      },
      user: {
        email: session.email,
      },
      plan: recommendation,
      session: {
        id: sessionRow.public_id,
        plan: recommendation?.recommended || null,
      },
      activation: {
        enabled: false
      },
    });
  } catch (error) {
    console.error("[ONBOARDING][FINISH] error:", error);
    try {
      await connection.rollback();
    } catch {
      // ignore rollback errors
    }
    connection.release();
    res.status(500).json({ ok: false, error: "Error finalizando onboarding" });
  }
});

function normalizeMpStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "authorized" || s === "active") return "authorized";
  if (s === "paused") return "paused";
  if (s === "cancelled" || s === "cancelled_by_user") return "cancelled";
  if (s === "pending" || s === "in_process") return "pending";
  return "error";
}

router.post("/:sessionId/create-subscription", async (req, res) => {
  try {
    if (!PLATFORM_MP_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "Plataforma sin token de Mercado Pago configurado",
      });
    }

    const { sessionId } = req.params;
    const sessionRow = await getSessionByPublicId(sessionId);
    if (!sessionRow) {
      return res.status(404).json({ ok: false, error: "Sesión no encontrada" });
    }
    if (sessionRow.status !== "completed") {
      return res.status(400).json({ ok: false, error: "La sesión aún no finalizó el registro" });
    }

    const session = serializeSession(sessionRow);
    const tenantInfo = await resolveTenantInfo(sessionRow);
    if (!tenantInfo) {
      return res.status(404).json({ ok: false, error: "Tenant no encontrado" });
    }

    const planCode = req.body?.plan || session.plan?.recommended || "starter";
    const planDef = getPlanDefinition(planCode);
    const tenantSlug = tenantInfo.subdomain;

    // Cancelar suscripciones pendientes existentes para este tenant antes de crear una nueva
    // Esto asegura que no haya conflictos con suscripciones que tienen payer_email configurado
    try {
      const [pendingSubs] = await pool.query(
        `SELECT id, mp_preapproval_id, status 
         FROM platform_subscription 
         WHERE tenant_id = ? AND status IN ('pending', 'paused') AND mp_preapproval_id IS NOT NULL
         ORDER BY created_at DESC`,
        [tenantInfo.id]
      );

      if (pendingSubs.length > 0) {
        console.log(`[ONBOARDING] Cancelando ${pendingSubs.length} suscripción(es) pendiente(s) para tenant ${tenantInfo.id} antes de crear nueva`);
        
        for (const sub of pendingSubs) {
          try {
            const cancelResp = await fetch(
              `https://api.mercadopago.com/preapproval/${sub.mp_preapproval_id}`,
              {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${PLATFORM_MP_TOKEN}`,
                },
                body: JSON.stringify({ status: "cancelled" }),
              }
            );

            if (cancelResp.ok) {
              await pool.query(
                `UPDATE platform_subscription 
                 SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
                 WHERE id = ?`,
                [sub.id]
              );
              console.log(`[ONBOARDING] Suscripción ${sub.id} cancelada exitosamente`);
            } else {
              const cancelData = await cancelResp.json().catch(() => ({}));
              console.warn(`[ONBOARDING] No se pudo cancelar suscripción ${sub.id}:`, cancelData);
            }
          } catch (cancelError) {
            console.error(`[ONBOARDING] Error cancelando suscripción ${sub.id}:`, cancelError.message);
            // Continuar con el proceso aunque falle la cancelación
          }
        }
      }
    } catch (cleanupError) {
      console.error("[ONBOARDING] Error limpiando suscripciones pendientes:", cleanupError.message);
      // Continuar con la creación de la nueva suscripción aunque falle la limpieza
    }

    const backUrl = frontendUrl(
      `/onboarding/payment/complete?session=${encodeURIComponent(sessionId)}${
        tenantSlug ? `&tenant=${encodeURIComponent(tenantSlug)}` : ""
      }`
    );
    if (!backUrl) {
      return res.status(500).json({
        ok: false,
        error: "FRONTEND_URL no configurado para construir la redirección",
      });
    }

    const body = {
      payer_email: session.email, // Requerido por MP, pero no debería restringir quién puede pagar
      reason: planDef.label,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: Number(planDef.amount),
        currency_id: planDef.currency || "ARS",
      },
      back_url: backUrl,
      status: "pending",
      external_reference: `tenant:${tenantInfo.id}:session:${sessionId}:plan:${planDef.code}`,
    };

    const mpResp = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PLATFORM_MP_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const rawText = await mpResp.text();
    let mpData;
    try {
      mpData = rawText ? JSON.parse(rawText) : {};
    } catch {
      mpData = rawText;
    }
    if (!mpResp.ok || !mpData?.init_point) {
      console.error("[ONBOARDING][SUBSCRIPTION] Mercado Pago error:", mpResp.status, mpData, "backUrl:", backUrl);
      return res.status(502).json({
        ok: false,
        error: mpData?.message || mpData?.error || "No se pudo crear la suscripción en Mercado Pago",
        back_url: backUrl,
        mp: mpData,
      });
    }

    const normalizedStatus = normalizeMpStatus(mpData.status || "pending");
    const nextCharge =
      mpData.auto_recurring?.next_payment_date
        ? new Date(mpData.auto_recurring.next_payment_date)
        : null;
    const lastPayment =
      mpData.auto_recurring?.last_payment_date
        ? new Date(mpData.auto_recurring.last_payment_date)
        : null;
    const activatedAt = normalizedStatus === "authorized" ? new Date() : null;

    await pool.query(
      `INSERT INTO platform_subscription
        (tenant_id, session_public_id, plan_code, plan_label, currency, amount,
         mp_preapproval_id, mp_init_point, mp_status, status, payer_email, created_at, updated_at, activated_at, last_payment_at, next_charge_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?)`,
      [
        tenantInfo.id,
        sessionId,
        planDef.code,
        planDef.label,
        planDef.currency || "ARS",
        planDef.amount,
        mpData.id || null,
        mpData.init_point || mpData.sandbox_init_point || null,
        mpData.status || "pending",
        normalizedStatus,
        session.email,
        activatedAt,
        lastPayment,
        nextCharge,
      ]
    );

    res.json({
      ok: true,
      init_point: mpData.init_point || mpData.sandbox_init_point,
      plan: planDef,
    });
  } catch (error) {
    console.error("[ONBOARDING][CREATE_SUBSCRIPTION] error:", error);
    res.status(500).json({ ok: false, error: "Error creando suscripción" });
  }
});

router.get("/activate", async (req, res) => {
  try {
    return res.json({
      ok: true,
      message: "La activación por email fue deshabilitada. Podés iniciar sesión.",
    });
  } catch (error) {
    console.error("[ONBOARDING][ACTIVATE] error:", error);
    res.status(500).json({ ok: false, error: "Error activando la cuenta" });
  }
});

router.post("/resend-activation", async (req, res) => {
  try {
    return res.json({
      ok: true,
      message: "La activación por email fue deshabilitada. No es necesario reenviar.",
    });
  } catch (error) {
    console.error("[ONBOARDING][RESEND] Error:", error);
    res.status(500).json({ 
      ok: false, 
      error: "Error procesando la solicitud",
      details: error.message 
    });
  }
});

router.get("/:sessionId/subscription-status", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionRow = await getSessionByPublicId(sessionId);
    if (!sessionRow) {
      return res.status(404).json({ ok: false, error: "Sesión no encontrada" });
    }

    const session = serializeSession(sessionRow);
    const tenantInfo = await resolveTenantInfo(sessionRow);

    const [rows] = await pool.query(
      `SELECT *
       FROM platform_subscription
       WHERE session_public_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [sessionId]
    );

    if (!rows.length) {
      return res.json({
        ok: true,
        status: "missing",
        plan: session.plan?.recommended ? getPlanDefinition(session.plan.recommended) : null,
      });
    }

    let subscriptionRow = rows[0];
    let mpStatus = subscriptionRow.mp_status;
    let status = subscriptionRow.status;

    if (subscriptionRow.mp_preapproval_id && PLATFORM_MP_TOKEN) {
      try {
        const mpResp = await fetch(
          `https://api.mercadopago.com/preapproval/${subscriptionRow.mp_preapproval_id}`,
          {
            headers: {
              Authorization: `Bearer ${PLATFORM_MP_TOKEN}`,
            },
          }
        );
        const mpData = await mpResp.json();
        if (mpResp.ok && mpData?.status) {
          mpStatus = mpData.status;
          const normalized = normalizeMpStatus(mpData.status);
          if (normalized !== status || mpStatus !== subscriptionRow.mp_status) {
            status = normalized;
            await pool.query(
              `UPDATE platform_subscription
               SET mp_status = ?, status = ?, updated_at = NOW(),
                   activated_at = CASE WHEN ? = 'authorized' AND activated_at IS NULL THEN NOW() ELSE activated_at END,
                   cancelled_at = CASE WHEN ? IN ('cancelled','error') AND cancelled_at IS NULL THEN NOW() ELSE cancelled_at END
               WHERE id = ?`,
              [mpStatus, status, status, status, subscriptionRow.id]
            );
          }
        }
      } catch (err) {
        console.warn("[ONBOARDING][SUBSCRIPTION_STATUS] Mercado Pago fetch error:", err);
      }
    }

    res.json({
      ok: true,
      status,
      mpStatus,
      plan: {
        code: subscriptionRow.plan_code,
        label: subscriptionRow.plan_label,
        amount: Number(subscriptionRow.amount),
        currency: subscriptionRow.currency,
      },
      init_point: subscriptionRow.mp_init_point,
      tenantSlug: tenantInfo?.subdomain || session.tenantSlug || null,
    });
  } catch (error) {
    console.error("[ONBOARDING][SUBSCRIPTION_STATUS] error:", error);
    res.status(500).json({ ok: false, error: "Error consultando estado de suscripción" });
  }
});

export default router;
