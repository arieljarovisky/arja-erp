// src/routes/superAdmin.js
import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { getPlanDefinition, listPlans, getPlanFeatureFlags } from "../services/subscriptionPlans.js";
import { requireSuperAdmin } from "../auth/tenant.js";
import { getTenantFeatureFlags, invalidateTenantFeatureFlags } from "../services/tenantFeatures.js";
import { ensurePrimaryBranch, getPrimaryBranchId } from "../services/branches.js";
import {
  getTenantWhatsAppHub,
  upsertTenantWhatsAppCredentials,
  clearTenantWhatsAppCredentials,
} from "../services/whatsappHub.js";

const router = express.Router();

const TEXT_TYPES = new Set(["varchar", "char", "text", "tinytext", "mediumtext", "longtext"]);

const schemaCache = {
  tables: new Map(),
  columns: new Map(),
};

async function tableExists(table) {
  if (schemaCache.tables.has(table)) {
    return schemaCache.tables.get(table);
  }
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const exists = Number(row?.total || 0) > 0;
  schemaCache.tables.set(table, exists);
  return exists;
}

async function getTableColumns(table) {
  if (schemaCache.columns.has(table)) {
    return schemaCache.columns.get(table);
  }

  if (!(await tableExists(table))) {
    schemaCache.columns.set(table, []);
    return [];
  }

  const [rows] = await pool.query(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_TYPE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [table]
  );
  schemaCache.columns.set(table, rows);
  return rows;
}

function isTextColumn(column) {
  const type = String(column?.DATA_TYPE || "").toLowerCase();
  return TEXT_TYPES.has(type);
}

function enumValues(column) {
  const columnType = column?.COLUMN_TYPE;
  if (!columnType || typeof columnType !== "string") return [];
  const match = columnType.match(/^enum\((.*)\)$/i);
  if (!match) return [];
  const raw = match[1];
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim().replace(/^'(.*)'$/, "$1"))
    .filter(Boolean);
}

function filterDataByColumns(data, columns, { exclude = [] } = {}) {
  if (!data || typeof data !== "object") {
    return {};
  }
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

function requiredColumns(columns, { exclude = [] } = {}) {
  const excluded = new Set(exclude);
  return columns
    .filter((col) => {
      if (excluded.has(col.COLUMN_NAME)) return false;
      if (String(col.EXTRA || "").includes("auto_increment")) return false;
      const hasDefault = col.COLUMN_DEFAULT !== null && col.COLUMN_DEFAULT !== undefined;
      return col.IS_NULLABLE === "NO" && !hasDefault;
    })
    .map((col) => col.COLUMN_NAME);
}

function parsePagination(query) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const offset = (page - 1) * limit;
  return { limit, page, offset };
}

async function getTenantMetricsFragments({ mode, tenantColumnNames = [] } = {}) {
  const fragments = [];

  if (await tableExists("users")) {
    const userColumns = await getTableColumns("users");
    const hasIsActive = userColumns.some((c) => c.COLUMN_NAME === "is_active");
    const isActiveFilter = hasIsActive ? " AND u.is_active = 1" : "";
    fragments.push(`
      (
        SELECT COUNT(*) FROM users u
        WHERE u.tenant_id = t.id${isActiveFilter}
      ) AS active_users
    `);
  }

  if (mode !== "compact" && (await tableExists("customer"))) {
    fragments.push(`
      (
        SELECT COUNT(*) FROM customer c
        WHERE c.tenant_id = t.id
      ) AS customers_count
    `);
  }

  if (await tableExists("appointment")) {
    if (mode !== "compact") {
      fragments.push(`
        (
          SELECT COUNT(*) FROM appointment a
          WHERE a.tenant_id = t.id AND DATE(a.starts_at) = CURDATE()
        ) AS appointments_today
      `);
    }
    fragments.push(`
      (
        SELECT COUNT(*) FROM appointment a
        WHERE a.tenant_id = t.id AND a.starts_at >= NOW()
      ) AS appointments_upcoming
    `);
  }

  if (await tableExists("platform_subscription")) {
    fragments.push(`
      (
        SELECT ps.status
        FROM platform_subscription ps
        WHERE ps.tenant_id = t.id
        ORDER BY ps.created_at DESC
        LIMIT 1
      ) AS subscription_status
    `);
    if (mode !== "compact") {
      fragments.push(`
        (
          SELECT ps.plan_code
          FROM platform_subscription ps
          WHERE ps.tenant_id = t.id
          ORDER BY ps.created_at DESC
          LIMIT 1
        ) AS subscription_plan_code
      `);
      fragments.push(`
        (
          SELECT ps.activated_at
          FROM platform_subscription ps
          WHERE ps.tenant_id = t.id
          ORDER BY ps.created_at DESC
          LIMIT 1
        ) AS subscription_activated_at
      `);
      fragments.push(`
        (
          SELECT ps.next_charge_at
          FROM platform_subscription ps
          WHERE ps.tenant_id = t.id
          ORDER BY ps.created_at DESC
          LIMIT 1
        ) AS subscription_next_charge_at
      `);
    }
  } else if (await tableExists("subscription")) {
    fragments.push(`
      (
        SELECT s.status
        FROM subscription s
        WHERE s.tenant_id = t.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) AS subscription_status
    `);
    if (mode !== "compact") {
      fragments.push(`
        (
          SELECT s.plan_id
          FROM subscription s
          WHERE s.tenant_id = t.id
          ORDER BY s.created_at DESC
          LIMIT 1
        ) AS subscription_plan_id
      `);
      fragments.push(`
        (
          SELECT s.current_period_end
          FROM subscription s
          WHERE s.tenant_id = t.id
          ORDER BY s.created_at DESC
          LIMIT 1
        ) AS subscription_current_period_end
      `);
    }
  } else if (tenantColumnNames.includes("subscription_status")) {
    fragments.push(`t.subscription_status AS subscription_status`);
  }

  return fragments;
}

function ensureDisplayName(row) {
  if (!row) return row;
  if (typeof row.name === "string") {
    row.name = row.name.replace(/\u0000+$/g, "");
  }
  if (row.name == null && row.subdomain != null) {
    row.name = row.subdomain;
  }
  return row;
}

router.get("/business-types", requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, code, name, description, icon, features FROM business_type ORDER BY name ASC`
    );
    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[SUPER_ADMIN] GET /business-types error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get("/tenants", async (req, res) => {
  try {
    const { search, status, mode } = req.query;
    const { limit, page, offset } = parsePagination(req.query);

    const tenantColumns = await getTableColumns("tenant");
    if (!tenantColumns.length) {
      return res.status(500).json({
        ok: false,
        error: "La tabla tenant no está disponible en la base de datos",
      });
    }

    const tenantColumnNames = tenantColumns.map((c) => c.COLUMN_NAME);
    const selectParts = new Set();
    selectParts.add("t.id");
    if (tenantColumnNames.includes("name") && mode !== "compact") {
      selectParts.add("t.name");
    }
    if (tenantColumnNames.includes("subdomain")) {
      selectParts.add("t.subdomain");
    }
    if (tenantColumnNames.includes("status")) {
      selectParts.add("t.status");
    }
  if (tenantColumnNames.includes("is_system")) {
    selectParts.add("t.is_system");
  } else {
    selectParts.add("0 AS is_system");
  }
    if (tenantColumnNames.includes("created_at") && mode !== "compact") {
      selectParts.add("t.created_at");
    }
    if (tenantColumnNames.includes("updated_at") && mode !== "compact") {
      selectParts.add("t.updated_at");
    }

    const metricsFragments = await getTenantMetricsFragments({ mode, tenantColumnNames });
    metricsFragments.forEach((fragment) => selectParts.add(fragment.trim()));

    let joinSettings = "";
    let settingsColumns = [];
    if (mode !== "compact" && (await tableExists("tenant_settings"))) {
      settingsColumns = (await getTableColumns("tenant_settings")).filter(
        (col) => col.COLUMN_NAME !== "tenant_id"
      );
      if (settingsColumns.length) {
        const settingsJson = settingsColumns
          .map((col) => `'${col.COLUMN_NAME}', ts.${col.COLUMN_NAME}`)
          .join(", ");
        joinSettings = "LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id";
        selectParts.add(`JSON_OBJECT(${settingsJson}) AS settings`);
      } else {
        selectParts.add(`JSON_OBJECT() AS settings`);
      }
    } else if (mode === "compact") {
      selectParts.add(`NULL AS settings`);
    }

    const filters = [];
    const params = [];

    if (status && tenantColumnNames.includes("status")) {
      filters.push("t.status = ?");
      params.push(status);
    }

    const textTenantColumns = tenantColumns.filter(isTextColumn).map((c) => c.COLUMN_NAME);
    const textSettingsColumns = settingsColumns.filter(isTextColumn).map((c) => c.COLUMN_NAME);

    if (search) {
      const like = `%${search.trim()}%`;
      const clauses = [];
      for (const column of textTenantColumns) {
        clauses.push(`t.${column} LIKE ?`);
        params.push(like);
      }
      for (const column of textSettingsColumns) {
        clauses.push(`ts.${column} LIKE ?`);
        params.push(like);
      }
      if (!clauses.length && tenantColumnNames.includes("id")) {
        clauses.push("CAST(t.id AS CHAR) LIKE ?");
        params.push(like);
      }
      if (clauses.length) {
        filters.push(`(${clauses.join(" OR ")})`);
      }
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM tenant t
      ${joinSettings}
      ${where}
    `;
    const [[countRow]] = await pool.query(countQuery, params);
    const total = Number(countRow?.total || 0);

    const sortFieldRaw = String(req.query.sort || "").trim();
    const sortField = tenantColumnNames.includes(sortFieldRaw)
      ? `t.${sortFieldRaw}`
      : tenantColumnNames.includes("created_at")
      ? "t.created_at"
      : "t.id";
    const sortDir = String(req.query.sort_dir || "").toLowerCase() === "asc" ? "ASC" : "DESC";

    const dataQuery = `
      SELECT ${Array.from(selectParts).join(", ")}
      FROM tenant t
      ${joinSettings}
      ${where}
      ORDER BY ${sortField} ${sortDir}
      LIMIT ?
      OFFSET ?
    `;
    const dataParams = [...params, limit, offset];
    const [rows] = await pool.query(dataQuery, dataParams);

    const data = rows.map((row) => ensureDisplayName(row));

    res.json({
      ok: true,
      data,
      pagination: {
        page,
        limit,
        total,
        pages: total > 0 ? Math.ceil(total / limit) : 0,
      },
    });
  } catch (error) {
    console.error("[SUPER_ADMIN] GET /tenants error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get("/tenants/:tenantId", async (req, res) => {
  try {
    const tenantId = Number.parseInt(req.params.tenantId, 10);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenantId inválido" });
    }

    const [tenantRows] = await pool.query(
      `SELECT * FROM tenant WHERE id = ? LIMIT 1`,
      [tenantId]
    );
    if (!tenantRows.length) {
      return res.status(404).json({ ok: false, error: "Tenant no encontrado" });
    }

    const tenant = ensureDisplayName({ ...tenantRows[0] });

    let settings = null;
    if (await tableExists("tenant_settings")) {
      const [settingsRows] = await pool.query(
        `SELECT * FROM tenant_settings WHERE tenant_id = ? LIMIT 1`,
        [tenantId]
      );
      if (settingsRows.length) {
        settings = settingsRows[0];
      }
    }

    let subscription = null;
    let plan = null;
    if (await tableExists("platform_subscription")) {
      const [subscriptionRows] = await pool.query(
        `SELECT *
         FROM platform_subscription
         WHERE tenant_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [tenantId]
      );
    if (subscriptionRows.length) {
      const row = subscriptionRows[0];
      subscription = row;
      const planDef = getPlanDefinition(row.plan_code);
      plan = {
        code: planDef.code,
        label: row.plan_label || planDef.label,
        amount: row.amount != null ? Number(row.amount) : planDef.amount,
        currency: row.currency || planDef.currency || "ARS",
        status: row.status,
        mp_status: row.mp_status,
        activated_at: row.activated_at,
        last_payment_at: row.last_payment_at,
        next_charge_at: row.next_charge_at,
        payer_email: row.payer_email,
        features: planDef.features || getPlanFeatureFlags(row.plan_code),
      };
    }
    }

    let business = null;
    const [[businessRow]] = await pool.query(
      `SELECT t.business_type_id, bt.name AS business_type_name, bt.code AS business_type_code, t.features_config
       FROM tenant t
       LEFT JOIN business_type bt ON bt.id = t.business_type_id
       WHERE t.id = ?
       LIMIT 1`,
      [tenantId]
    );
    if (businessRow) {
      business = businessRow;
    }

    const metrics = {};

    if (await tableExists("users")) {
      const userColumns = await getTableColumns("users");
      const hasIsActive = userColumns.some((c) => c.COLUMN_NAME === "is_active");
      const isActiveFilter = hasIsActive ? " AND is_active = 1" : "";
      const [[usersCount]] = await pool.query(
        `SELECT COUNT(*) AS total FROM users WHERE tenant_id = ?${isActiveFilter}`,
        [tenantId]
      );
      metrics.active_users = Number(usersCount?.total || 0);
    }

    if (await tableExists("customer")) {
      const [[customersCount]] = await pool.query(
        `SELECT COUNT(*) AS total FROM customer WHERE tenant_id = ?`,
        [tenantId]
      );
      metrics.customers_count = Number(customersCount?.total || 0);
    }

    if (await tableExists("appointment")) {
      const [[appointmentsToday]] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM appointment
         WHERE tenant_id = ? AND DATE(starts_at) = CURDATE()`,
        [tenantId]
      );
      const [[appointmentsUpcoming]] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM appointment
         WHERE tenant_id = ? AND starts_at >= NOW()`,
        [tenantId]
      );
      metrics.appointments_today = Number(appointmentsToday?.total || 0);
      metrics.appointments_upcoming = Number(appointmentsUpcoming?.total || 0);
    }

    res.json({
      ok: true,
      data: {
        tenant,
        settings,
        subscription,
        metrics,
        business,
        plan,
        availablePlans: listPlans(),
        planFeatures: plan ? getPlanFeatureFlags(plan.code) : getPlanFeatureFlags(),
      },
    });
  } catch (error) {
    console.error("[SUPER_ADMIN] GET /tenants/:tenantId error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post("/tenants", async (req, res) => {
  const { tenant: tenantPayload = {}, settings: settingsPayload = {}, owner: ownerPayload = {} } =
    req.body || {};

  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    const tenantColumns = await getTableColumns("tenant");
    if (!tenantColumns.length) {
      connection.release();
      return res.status(500).json({
        ok: false,
        error: "La tabla tenant no está disponible en la base de datos",
      });
    }

    const tenantData = filterDataByColumns(tenantPayload, tenantColumns, {
      exclude: ["id", "tenant_id", "created_at", "updated_at", "deleted_at"],
    });

    const required = requiredColumns(tenantColumns, {
      exclude: ["id", "tenant_id", "created_at", "updated_at", "deleted_at"],
    });
    const missing = required.filter((column) => tenantData[column] == null);
    if (missing.length) {
      connection.release();
      return res.status(400).json({
        ok: false,
        error: "Faltan campos obligatorios para crear el tenant",
        missing,
      });
    }

    if (Object.keys(tenantData).length === 0) {
      connection.release();
      return res.status(400).json({
        ok: false,
        error: "No se encontraron campos válidos para crear el tenant",
      });
    }

    const statusColumn = tenantColumns.find((col) => col.COLUMN_NAME === "status");
    if (statusColumn && tenantData.status !== undefined) {
      const allowedStatuses = enumValues(statusColumn);
      if (allowedStatuses.length && !allowedStatuses.includes(tenantData.status)) {
        connection.release();
        return res.status(400).json({
          ok: false,
          error: `Estado inválido. Valores permitidos: ${allowedStatuses.join(", ")}`,
        });
      }
    }

    if (tenantData.subdomain) {
      const [[existingTenant]] = await pool.query(
        `SELECT id FROM tenant WHERE subdomain = ? LIMIT 1`,
        [tenantData.subdomain]
      );
      if (existingTenant) {
        connection.release();
        return res.status(409).json({
          ok: false,
          error: "El subdominio ya está en uso por otro tenant",
        });
      }
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const tenantColumnsList = Object.keys(tenantData);
    const tenantValues = tenantColumnsList.map((column) => tenantData[column]);
    const tenantPlaceholders = tenantColumnsList.map(() => "?").join(", ");
    const [tenantResult] = await connection.query(
      `INSERT INTO tenant (${tenantColumnsList.join(", ")})
       VALUES (${tenantPlaceholders})`,
      tenantValues
    );
    const tenantId = tenantResult.insertId;
    await ensurePrimaryBranch(tenantId, tenantData.name || tenantPayload.name || "", connection);

    let ownerUser = null;

    if (settingsPayload && Object.keys(settingsPayload).length && (await tableExists("tenant_settings"))) {
      const tenantSettingsColumns = await getTableColumns("tenant_settings");
      const settingsData = filterDataByColumns(settingsPayload, tenantSettingsColumns, {
        exclude: ["id", "tenant_id", "created_at", "updated_at"],
      });

      if (Object.keys(settingsData).length) {
        const settingsKeys = Object.keys(settingsData);
        const insertColumns = ["tenant_id", ...settingsKeys];
        const insertValues = [tenantId, ...settingsKeys.map((key) => settingsData[key])];
        const settingsPlaceholders = insertColumns.map(() => "?").join(", ");
        const updateAssignments = settingsKeys
          .map((key) => `${key} = VALUES(${key})`)
          .join(", ");

        await connection.query(
          `INSERT INTO tenant_settings (${insertColumns.join(", ")})
           VALUES (${settingsPlaceholders})
           ON DUPLICATE KEY UPDATE ${updateAssignments}`,
          insertValues
        );
      }
    }

    const ownerEmail = ownerPayload?.email ? String(ownerPayload.email).trim().toLowerCase() : null;
    const ownerPassword = ownerPayload?.password ? String(ownerPayload.password) : null;

    if (ownerEmail && ownerPassword && (await tableExists("users"))) {
      const userColumns = await getTableColumns("users");
      const userColumnNames = new Set(userColumns.map((col) => col.COLUMN_NAME));

      // Validar que el email del owner/admin sea único globalmente
      // Solo el email del propietario que crea el tenant debe ser único
      // Los usuarios creados después dentro del tenant pueden tener emails que ya existen en otros tenants
      const existingUserQuery = `
        SELECT id FROM users
        WHERE email = ?
        LIMIT 1
      `;
      const [[existingUser]] = await connection.query(existingUserQuery, [ownerEmail]);
      if (existingUser) {
        throw new Error("Este email ya está registrado como propietario de otro local");
      }

      const defaultPermissions = {
        stock: ["admin"],
        invoicing: ["admin"],
        appointments: ["admin"],
        customers: ["admin"],
        config: ["admin"],
        users: ["admin"],
      };

      const hashedPassword = await bcrypt.hash(ownerPassword, 10);

      const ownerBranchId = await getPrimaryBranchId(
        tenantId,
        tenantData.name || tenantPayload.name || "",
        connection
      );

      const userInsertColumns = [];
      const userInsertValues = [];

      userInsertColumns.push("tenant_id");
      userInsertValues.push(tenantId);

      if (userColumnNames.has("current_branch_id")) {
        userInsertColumns.push("current_branch_id");
        userInsertValues.push(ownerBranchId);
      }

      userInsertColumns.push("email");
      userInsertValues.push(ownerEmail);

      if (userColumnNames.has("password_hash")) {
        userInsertColumns.push("password_hash");
        userInsertValues.push(hashedPassword);
      } else if (userColumnNames.has("password")) {
        userInsertColumns.push("password");
        userInsertValues.push(hashedPassword);
      }

      if (userColumnNames.has("role")) {
        userInsertColumns.push("role");
        userInsertValues.push(ownerPayload.role || "admin");
      }

      if (userColumnNames.has("is_active")) {
        userInsertColumns.push("is_active");
        userInsertValues.push(ownerPayload.is_active === false ? 0 : 1);
      }

      if (userColumnNames.has("permissions")) {
        const permissions =
          ownerPayload.permissions && typeof ownerPayload.permissions === "object"
            ? ownerPayload.permissions
            : defaultPermissions;
        userInsertColumns.push("permissions");
        userInsertValues.push(JSON.stringify(permissions));
      }

      const optionalOwnerData = filterDataByColumns(ownerPayload, userColumns, {
        exclude: [
          "id",
          "tenant_id",
          "email",
          "password",
          "password_hash",
          "role",
          "is_active",
          "permissions",
          "current_branch_id",
          "created_at",
          "updated_at",
          "last_login",
          "last_login_at",
        ],
      });

      for (const [key, value] of Object.entries(optionalOwnerData)) {
        if (!userColumnNames.has(key)) continue;
        userInsertColumns.push(key);
        userInsertValues.push(value);
      }

      const userPlaceholders = userInsertColumns.map(() => "?").join(", ");
      const [userResult] = await connection.query(
        `INSERT INTO users (${userInsertColumns.join(", ")})
         VALUES (${userPlaceholders})`,
        userInsertValues
      );
      ownerUser = { id: userResult.insertId, email: ownerEmail };
    }

    await connection.commit();
    transactionStarted = false;
    res.status(201).json({
      ok: true,
      data: {
        id: tenantId,
        owner: ownerUser,
      },
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("[SUPER_ADMIN] POST /tenants rollback error:", rollbackError);
      }
    }
    console.error("[SUPER_ADMIN] POST /tenants error:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    connection.release();
  }
});

router.patch("/tenants/:tenantId", async (req, res) => {
  const { tenant: tenantPayload = {}, settings: settingsPayload = {} } = req.body || {};

  const tenantId = Number.parseInt(req.params.tenantId, 10);
  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "tenantId inválido" });
  }

  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    const tenantColumns = await getTableColumns("tenant");
    if (!tenantColumns.length) {
      connection.release();
      return res.status(500).json({
        ok: false,
        error: "La tabla tenant no está disponible en la base de datos",
      });
    }

    const tenantData = filterDataByColumns(tenantPayload, tenantColumns, {
      exclude: ["id", "tenant_id", "created_at", "updated_at", "deleted_at", "name"],
    });

    if (tenantData.subdomain) {
      const [[existingTenant]] = await pool.query(
        `SELECT id FROM tenant WHERE subdomain = ? AND id <> ? LIMIT 1`,
        [tenantData.subdomain, tenantId]
      );
      if (existingTenant) {
        connection.release();
        return res.status(409).json({
          ok: false,
          error: "El subdominio ya está asignado a otro tenant",
        });
      }
    }

    const statusColumn = tenantColumns.find((col) => col.COLUMN_NAME === "status");
    if (statusColumn && tenantData.status !== undefined) {
      const allowedStatuses = enumValues(statusColumn);
      if (allowedStatuses.length && !allowedStatuses.includes(tenantData.status)) {
        connection.release();
        return res.status(400).json({
          ok: false,
          error: `Estado inválido. Valores permitidos: ${allowedStatuses.join(", ")}`,
        });
      }
    }

    const updateColumns = Object.keys(tenantData);
    const hasSettings =
      settingsPayload && Object.keys(settingsPayload).length && (await tableExists("tenant_settings"));

    if (!updateColumns.length && !hasSettings) {
      connection.release();
      return res.status(400).json({
        ok: false,
        error: "No se recibieron cambios para aplicar",
      });
    }

    await connection.beginTransaction();
    transactionStarted = true;

    if (updateColumns.length) {
      const assignments = updateColumns.map((column) => `${column} = ?`).join(", ");
      const values = updateColumns.map((column) => tenantData[column]);
      values.push(tenantId);

      await connection.query(
        `UPDATE tenant SET ${assignments} WHERE id = ?`,
        values
      );
    }

    if (hasSettings) {
      const tenantSettingsColumns = await getTableColumns("tenant_settings");
      const settingsData = filterDataByColumns(settingsPayload, tenantSettingsColumns, {
        exclude: ["id", "tenant_id", "created_at", "updated_at"],
      });
      const settingsKeys = Object.keys(settingsData);
      if (settingsKeys.length) {
        const insertColumns = ["tenant_id", ...settingsKeys];
        const insertValues = [tenantId, ...settingsKeys.map((key) => settingsData[key])];
        const placeholders = insertColumns.map(() => "?").join(", ");
        const updates = settingsKeys.map((key) => `${key} = VALUES(${key})`).join(", ");

        await connection.query(
          `INSERT INTO tenant_settings (${insertColumns.join(", ")})
           VALUES (${placeholders})
           ON DUPLICATE KEY UPDATE ${updates}`,
          insertValues
        );
      }
    }

    await connection.commit();
    transactionStarted = false;
    res.json({ ok: true, message: "Tenant actualizado correctamente" });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("[SUPER_ADMIN] PATCH /tenants rollback error:", rollbackError);
      }
    }
    console.error("[SUPER_ADMIN] PATCH /tenants/:tenantId error:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    connection.release();
  }
});

router.patch("/tenants/:tenantId/business", async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    const tenantId = Number.parseInt(req.params.tenantId, 10);
    if (!tenantId) {
      connection.release();
      return res.status(400).json({ ok: false, error: "tenantId inválido" });
    }

    const { business_type_id, features_config } = req.body || {};

    const tenantColumns = await getTableColumns("tenant");
    if (!tenantColumns.length) {
      connection.release();
      return res.status(500).json({ ok: false, error: "La tabla tenant no está disponible" });
    }

    const updates = [];
    const params = [];

    if (business_type_id !== undefined) {
      const normalized = Number(business_type_id);
      if (Number.isNaN(normalized)) {
        connection.release();
        return res.status(400).json({ ok: false, error: "Tipo de negocio inválido" });
      }
      const [[btRow]] = await pool.query(
        `SELECT id FROM business_type WHERE id = ? LIMIT 1`,
        [normalized]
      );
      if (!btRow) {
        connection.release();
        return res.status(400).json({ ok: false, error: "Tipo de negocio no válido" });
      }
      updates.push("business_type_id = ?");
      params.push(normalized);
    }

    if (features_config !== undefined) {
      if (typeof features_config !== "object" || features_config == null) {
        connection.release();
        return res.status(400).json({ ok: false, error: "features_config debe ser objeto" });
      }
      updates.push("features_config = ?");
      params.push(JSON.stringify(features_config));
    }

    if (!updates.length) {
      connection.release();
      return res.status(400).json({ ok: false, error: "No hay cambios para aplicar" });
    }

    await connection.beginTransaction();
    transactionStarted = true;

    params.push(tenantId);
    await connection.query(
      `UPDATE tenant SET ${updates.join(", ")} WHERE id = ?`,
      params
    );

    await connection.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("[SUPER_ADMIN] PATCH /tenants/:tenantId/business rollback error:", rollbackError);
      }
    }
    connection.release();
    console.error("[SUPER_ADMIN] PATCH /tenants/:tenantId/business error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.patch("/tenants/:tenantId/plan", async (req, res) => {
  try {
    const tenantId = Number.parseInt(req.params.tenantId, 10);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenantId inválido" });
    }

    const { plan_code } = req.body || {};
    if (!plan_code) {
      return res.status(400).json({ ok: false, error: "plan_code es requerido" });
    }

    const planDef = getPlanDefinition(plan_code);

    await pool.query(
      `INSERT INTO platform_subscription
        (tenant_id, plan_code, plan_label, currency, amount, status, activated_at)
       VALUES (?, ?, ?, ?, ?, 'authorized', NOW())
       ON DUPLICATE KEY UPDATE
         plan_code = VALUES(plan_code),
         plan_label = VALUES(plan_label),
         currency = VALUES(currency),
         amount = VALUES(amount),
         status = 'authorized',
         updated_at = NOW(),
         activated_at = NOW()`,
      [tenantId, planDef.code, planDef.label, planDef.currency || "ARS", planDef.amount]
    );

    res.json({ ok: true, plan: planDef });
  } catch (error) {
    console.error("[SUPER_ADMIN] PATCH /tenants/:tenantId/plan error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ✅ Habilitar/deshabilitar features del tenant (ej: mobile_app) por super admin
router.patch("/tenants/:tenantId/features", requireSuperAdmin, async (req, res) => {
  try {
    const tenantId = Number.parseInt(req.params.tenantId, 10);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenantId inválido" });
    }

    const { mobile_app } = req.body || {};
    if (mobile_app === undefined) {
      return res.status(400).json({ ok: false, error: "Falta mobile_app en el body" });
    }

    const current = await getTenantFeatureFlags(tenantId);
    const next = { ...current, mobile_app: Boolean(mobile_app) };

    await pool.query(
      `UPDATE tenant SET features_config = ? WHERE id = ? LIMIT 1`,
      [JSON.stringify(next), tenantId]
    );

    invalidateTenantFeatureFlags(tenantId);

    res.json({ ok: true, data: next });
  } catch (error) {
    console.error("[SUPER_ADMIN] PATCH /tenants/:tenantId/features error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get("/tenants/:tenantId/whatsapp", requireSuperAdmin, async (req, res) => {
  try {
    const tenantId = Number.parseInt(req.params.tenantId, 10);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenantId inválido" });
    }

    const hub = await getTenantWhatsAppHub(tenantId);
    if (!hub) {
      return res.json({ ok: true, data: null });
    }

    res.json({
      ok: true,
      data: {
        tenantId: hub.tenantId,
        phoneNumberId: hub.phoneNumberId,
        hasCredentials: hub.hasCredentials,
        phoneDisplay: hub.phoneDisplay,
        isActive: hub.isActive,
        verifyToken: hub.verifyToken,
        refreshToken: hub.refreshToken,
        tokenExpiresAt: hub.tokenExpiresAt,
        managedBy: hub.managedBy,
        managedNotes: hub.managedNotes,
        createdAt: hub.createdAt,
        updatedAt: hub.updatedAt,
      },
    });
  } catch (error) {
    console.error("[SUPER_ADMIN] GET /tenants/:tenantId/whatsapp error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.put("/tenants/:tenantId/whatsapp/credentials", requireSuperAdmin, async (req, res) => {
  try {
    const tenantId = Number.parseInt(req.params.tenantId, 10);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenantId inválido" });
    }

    const payload = req.body || {};
    const managedBy =
      req.user?.email || req.user?.username || (req.user?.id != null ? `user:${req.user.id}` : null);

    const hub = await upsertTenantWhatsAppCredentials(tenantId, {
      phoneNumberId: payload.phoneNumberId,
      accessToken: payload.accessToken,
      verifyToken: payload.verifyToken,
      refreshToken: payload.refreshToken,
      tokenExpiresAt: payload.tokenExpiresAt ? new Date(payload.tokenExpiresAt) : null,
      phoneDisplay: payload.phoneDisplay ?? null,
      isActive: payload.isActive !== undefined ? !!payload.isActive : true,
      managedBy,
      managedNotes: payload.managedNotes ?? null,
    });

    res.json({
      ok: true,
      data: {
        tenantId: hub.tenantId,
        phoneNumberId: hub.phoneNumberId,
        hasCredentials: hub.hasCredentials,
        phoneDisplay: hub.phoneDisplay,
        isActive: hub.isActive,
        tokenExpiresAt: hub.tokenExpiresAt,
        managedBy: hub.managedBy,
        managedNotes: hub.managedNotes,
        createdAt: hub.createdAt,
        updatedAt: hub.updatedAt,
      },
    });
  } catch (error) {
    console.error("[SUPER_ADMIN] PUT /tenants/:tenantId/whatsapp/credentials error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.delete("/tenants/:tenantId/whatsapp/credentials", requireSuperAdmin, async (req, res) => {
  try {
    const tenantId = Number.parseInt(req.params.tenantId, 10);
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: "tenantId inválido" });
    }
    await clearTenantWhatsAppCredentials(tenantId);
    res.json({ ok: true });
  } catch (error) {
    console.error("[SUPER_ADMIN] DELETE /tenants/:tenantId/whatsapp/credentials error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;

