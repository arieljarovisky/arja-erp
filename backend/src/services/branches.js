import { pool } from "../db.js";

export function slugifyBranch(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function buildUniqueBranchSlug(tenantId, baseValue, db = pool) {
  const base = slugifyBranch(baseValue) || "sucursal";
  let attempt = base;
  let counter = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [[existing]] = await db.query(
      `SELECT id FROM tenant_branch WHERE tenant_id = ? AND slug = ? LIMIT 1`,
      [tenantId, attempt]
    );
    if (!existing) {
      return attempt;
    }
    counter += 1;
    attempt = `${base}-${counter}`;
  }
}

export async function ensurePrimaryBranch(tenantId, tenantName = "", db = pool) {
  if (!tenantId) return null;
  const [[existing]] = await db.query(
    `SELECT * FROM tenant_branch WHERE tenant_id = ? AND is_primary = 1 LIMIT 1`,
    [tenantId]
  );
  if (existing) return existing;

  const fallbackName = tenantName?.trim()
    ? `${tenantName.trim()} - Principal`
    : "Sucursal Principal";
  const slug = await buildUniqueBranchSlug(tenantId, "principal", db);

  const [result] = await db.query(
    `INSERT INTO tenant_branch (tenant_id, name, slug, is_primary, is_active)
     VALUES (?, ?, ?, 1, 1)`,
    [tenantId, fallbackName, slug]
  );

  return {
    id: result.insertId,
    tenant_id: tenantId,
    name: fallbackName,
    slug,
    is_primary: 1,
    is_active: 1,
  };
}

export async function getPrimaryBranchId(tenantId, tenantName = "", db = pool) {
  const branch = await ensurePrimaryBranch(tenantId, tenantName, db);
  return branch?.id || null;
}

export async function getBranchSummary(tenantId, branchId, db = pool) {
  if (!tenantId || !branchId) return null;
  const [[row]] = await db.query(
    `SELECT id, tenant_id, name, slug, is_primary, is_active
       FROM tenant_branch
      WHERE tenant_id = ? AND id = ?
      LIMIT 1`,
    [tenantId, branchId]
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    name: row.name,
    slug: row.slug,
    isPrimary: row.is_primary === 1,
    isActive: row.is_active === 1,
  };
}

export async function findTenantBranch(
  tenantId,
  branchId,
  { activeOnly = false } = {},
  db = pool
) {
  if (!tenantId || !branchId) return null;
  const [rows] = await db.query(
    `SELECT *
       FROM tenant_branch
      WHERE tenant_id = ?
        AND id = ?
        ${activeOnly ? "AND is_active = 1" : ""}
      LIMIT 1`,
    [tenantId, branchId]
  );
  return rows[0] || null;
}

export async function listTenantBranches(tenantId, { activeOnly = false } = {}, db = pool) {
  if (!tenantId) return [];
  const [rows] = await db.query(
    `SELECT *
       FROM tenant_branch
      WHERE tenant_id = ?
        ${activeOnly ? "AND is_active = 1" : ""}
      ORDER BY is_primary DESC, name ASC`,
    [tenantId]
  );
  return rows;
}


