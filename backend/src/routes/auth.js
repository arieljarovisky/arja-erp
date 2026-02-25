// src/routes/auth.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { pool } from "../db.js";
import { getBranchSummary, getPrimaryBranchId } from "../services/branches.js";
import { sendEmail } from "../services/email.js";
import { validatePassword, getPasswordErrorMessage } from "../utils/passwordValidation.js";

export const auth = Router();

const superAdminEmails = new Set(
  (process.env.SUPER_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

const ALLOWED_TENANT_STATUSES = new Set(["active", "trial"]);

export async function ensureSuperAdminFlag(userRow) {
  if (!userRow) return false;
  const email = String(userRow.email || "").toLowerCase();
  let isSuper = Boolean(userRow.is_super_admin);

  if (!isSuper && superAdminEmails.has(email)) {
    try {
      await pool.query(`UPDATE users SET is_super_admin = 1 WHERE id = ?`, [userRow.id]);
      isSuper = true;
    } catch (err) {
      console.warn("[ensureSuperAdminFlag] No se pudo actualizar is_super_admin:", err.message);
    }
  }

  return isSuper;
}

function parsePermissions(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && raw !== null) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function buildUserPayload(userRow, { isSuperAdmin, tenantName } = {}) {
  if (!userRow) return null;
  let superAdmin = isSuperAdmin;
  if (superAdmin === undefined) {
    superAdmin = await ensureSuperAdminFlag(userRow);
  }

  if (!userRow.current_branch_id) {
    const branchId = await getPrimaryBranchId(userRow.tenant_id);
    if (branchId) {
      await pool.query(`UPDATE users SET current_branch_id = ? WHERE id = ?`, [
        branchId,
        userRow.id,
      ]);
      userRow.current_branch_id = branchId;
    }
  }

  const branch = await getBranchSummary(userRow.tenant_id, userRow.current_branch_id);

  const accessMode = userRow.branch_access_mode || "all";
  let branchAccessList = [];
  if (accessMode === "custom") {
    const [accessRows] = await pool.query(
      `SELECT uba.branch_id, tb.name
         FROM user_branch_access uba
         JOIN tenant_branch tb ON tb.id = uba.branch_id
        WHERE uba.user_id = ?`,
      [userRow.id]
    );
    branchAccessList = accessRows.map((row) => ({
      id: Number(row.branch_id),
      name: row.name,
    }));
    if (
      branchAccessList.length &&
      !branchAccessList.some((item) => item.id === Number(userRow.current_branch_id))
    ) {
      const fallbackBranchId = branchAccessList[0].id;
      await pool.query(`UPDATE users SET current_branch_id = ? WHERE id = ?`, [
        fallbackBranchId,
        userRow.id,
      ]);
      userRow.current_branch_id = fallbackBranchId;
    }
  }

  return {
    id: userRow.id,
    email: userRow.email,
    role: userRow.role,
    tenantId: userRow.tenant_id,
    isSuperAdmin: Boolean(superAdmin),
    permissions: parsePermissions(userRow.permissions),
    currentBranchId: branch?.id || null,
    currentBranch: branch
      ? {
          id: branch.id,
          name: branch.name,
          slug: branch.slug,
          isPrimary: branch.isPrimary,
        }
      : null,
    branchAccessMode: accessMode,
    branchIds: branchAccessList.map((item) => item.id),
    branchNames: branchAccessList,
  };
}

/* ============================
   Helpers firma/verificación
============================ */
export function signAccessToken({ userId, tenantId, role, email, isSuperAdmin }) {
  return jwt.sign(
    { sub: userId, tenant_id: tenantId, role, email, is_super_admin: Boolean(isSuperAdmin) },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: "8h" }
  );
}

export function signRefreshToken({ userId, tenantId }) {
  return jwt.sign(
    { sub: userId, tenant_id: tenantId, t: "refresh" },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "30d" }
  );
}

export function cookieOpts(persistent = true) {
  const opts = {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production",
  };
  if (persistent) {
    opts.maxAge = 1000 * 60 * 60 * 24 * 30;
  }
  return opts;
}

function clearCookieOpts() {
  return {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production",
    // Express 5 deprecó pasar expires en clearCookie: se expira automáticamente
  };
}

export async function enforceSessionLimit(userId, tenantId, maxSessions = 2) {
  try {
    const [rows] = await pool.query(
      `SELECT token 
       FROM refresh_tokens 
       WHERE user_id = ? AND tenant_id = ?
       ORDER BY created_at DESC`,
      [userId, tenantId]
    );
    if (!Array.isArray(rows) || rows.length <= maxSessions) return;
    const tokensToDelete = rows.slice(maxSessions).map(r => r.token).filter(Boolean);
    if (!tokensToDelete.length) return;
    const placeholders = tokensToDelete.map(() => "?").join(",");
    await pool.query(
      `DELETE FROM refresh_tokens WHERE token IN (${placeholders})`,
      tokensToDelete
    );
  } catch (err) {
    console.warn("[enforceSessionLimit] error:", err.message);
  }
}
/* ============================================
   POST /auth/login
   - Busca usuario por email
   - Si pertenece a 1 tenant → loguea y devuelve token
   - Si pertenece a varios → devuelve lista para elegir
============================================= */
auth.post("/login", async (req, res) => {
  try {
    const { email, password, twoFactorCode, rememberDevice } = req.body || {};
    
    if (!email || !password) {
      return res.status(400).json({ 
        ok: false, 
        error: "Email y password son requeridos" 
      });
    }

    const emailLower = String(email).trim().toLowerCase();

    // Verificar conexión a BD con retry
    let users;
    let retries = 3;
    let lastError;
    
    while (retries > 0) {
      try {
        // Buscar usuario (puede pertenecer a múltiples tenants)
        [users] = await pool.query(
          `SELECT u.id, u.email, u.password_hash, u.role, u.is_active,
                  u.is_super_admin, u.current_branch_id, u.branch_access_mode,
                  u.permissions,
                  u.tenant_id, t.subdomain AS slug, t.status AS tenant_status,
                  t.name AS tenant_name, t.is_system, t.activation_token,
                  u.two_factor_enabled, u.remember_2fa_until
           FROM users u
           JOIN tenant t ON t.id = u.tenant_id
           WHERE u.email = ?`,
          [emailLower]
        );
        break; // Éxito, salir del loop
      } catch (error) {
        lastError = error;
        retries--;
        
        // Si es un error de conexión y quedan reintentos, esperar un poco
        if (retries > 0 && (error.code === 'ECONNREFUSED' || error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ETIMEDOUT')) {
          console.warn(`[LOGIN] Error de conexión a BD, reintentando... (${3 - retries}/3)`);
          await new Promise(resolve => setTimeout(resolve, 500)); // Esperar 500ms antes de reintentar
        } else {
          throw error; // Si no es error de conexión o no quedan reintentos, lanzar error
        }
      }
    }
    
    if (!users) {
      throw lastError || new Error("Error de conexión a base de datos");
    }

    if (!users.length) {
      console.warn("[LOGIN] Usuario no encontrado:", emailLower);
      return res.status(401).json({ 
        ok: false, 
        error: "Credenciales inválidas" 
      });
    }

    // Verificar password (todos los registros tienen el mismo hash)
    const user = users[0];
    const passOK = await bcrypt.compare(password, user.password_hash);
    
    if (!passOK) {
      console.warn("[LOGIN] Password incorrecta:", emailLower);
      return res.status(401).json({ 
        ok: false, 
        error: "Credenciales inválidas" 
      });
    }

    await Promise.all(
      users.map(async (uRecord) => {
        uRecord.is_super_admin = await ensureSuperAdminFlag(uRecord);
      })
    );

    // La activación por email fue deshabilitada: permitir login en estado "trial"

    // Filtrar usuarios activos con tenants en estados permitidos
    const activeUsers = users.filter(
      (u) => {
        if (!u.is_active) return false;
        const status = String(u.tenant_status || "").toLowerCase();
        return ALLOWED_TENANT_STATUSES.has(status);
      }
    );

    if (!activeUsers.length) {
      return res.status(403).json({ 
        ok: false, 
        error: "Cuenta desactivada o tenant inactivo" 
      });
    }

    // ✅ CASO 1: Usuario pertenece a UN SOLO tenant
    if (activeUsers.length === 1) {
      const u = activeUsers[0];
      const isSuperAdmin = Boolean(u.is_super_admin);

      // Verificar 2FA si está activado
      if (u.two_factor_enabled) {
        // Verificar si el dispositivo está "recordado" (no requiere 2FA por 30 días)
        const now = new Date();
        const rememberUntil = u.remember_2fa_until ? new Date(u.remember_2fa_until) : null;
        const isRemembered = rememberUntil && rememberUntil > now;

        if (!isRemembered) {
          // Requiere código 2FA
          if (!twoFactorCode) {
            return res.status(200).json({
              ok: false,
              requiresTwoFactor: true,
              message: "Se requiere código de autenticación de doble factor"
            });
          }

          // Verificar código 2FA
          const [[user2FA]] = await pool.query(
            `SELECT two_factor_secret, two_factor_backup_codes FROM users WHERE id = ? AND tenant_id = ?`,
            [u.id, u.tenant_id]
          );

          if (!user2FA || !user2FA.two_factor_secret) {
            return res.status(400).json({
              ok: false,
              error: "2FA no configurado correctamente"
            });
          }

          // Verificar código TOTP
          const verified = speakeasy.totp.verify({
            secret: user2FA.two_factor_secret,
            encoding: 'base32',
            token: twoFactorCode,
            window: 2 // Permitir ±2 períodos de tiempo (60 segundos cada uno)
          });

          // Si el código TOTP no es válido, verificar códigos de respaldo
          let isValidCode = verified;
          if (!verified && user2FA.two_factor_backup_codes) {
            try {
              const backupCodes = JSON.parse(user2FA.two_factor_backup_codes);
              const codeIndex = backupCodes.indexOf(twoFactorCode);
              if (codeIndex !== -1) {
                // Código de respaldo válido, removerlo
                backupCodes.splice(codeIndex, 1);
                await pool.query(
                  `UPDATE users SET two_factor_backup_codes = ? WHERE id = ? AND tenant_id = ?`,
                  [JSON.stringify(backupCodes), u.id, u.tenant_id]
                );
                isValidCode = true;
              }
            } catch (e) {
              console.error("[LOGIN] Error parseando backup codes:", e);
            }
          }

          if (!isValidCode) {
            return res.status(401).json({
              ok: false,
              error: "Código de autenticación inválido"
            });
          }

          // Si rememberDevice es true, guardar remember_2fa_until por 30 días
          if (rememberDevice) {
            const rememberDate = new Date();
            rememberDate.setDate(rememberDate.getDate() + 30);
            await pool.query(
              `UPDATE users SET remember_2fa_until = ? WHERE id = ? AND tenant_id = ?`,
              [rememberDate, u.id, u.tenant_id]
            );
          }
        }
      }

      const access = signAccessToken({
        userId: u.id,
        tenantId: u.tenant_id,
        role: u.role,
        email: u.email,
        isSuperAdmin,
      });

      const refresh = signRefreshToken({
        userId: u.id,
        tenantId: u.tenant_id
      });

      // Guardar refresh token
      await pool.query(
        `INSERT INTO refresh_tokens (user_id, tenant_id, token, created_at)
         VALUES (?, ?, ?, NOW())`,
        [u.id, u.tenant_id, refresh]
      );

      await enforceSessionLimit(u.id, u.tenant_id, 1);

      // Cookie con refresh token
      res.cookie("rt", refresh, cookieOpts(Boolean(rememberDevice)));

      // Actualizar last_login
      await pool.query(
        "UPDATE users SET last_login = NOW() WHERE id = ? AND tenant_id = ?",
        [u.id, u.tenant_id]
      );

      console.log(`✅ [LOGIN] Usuario ${emailLower} logueado en tenant ${u.tenant_id}`);
      const userPayload = await buildUserPayload(u, {
        isSuperAdmin,
        tenantName: u.tenant_name,
      });

      // Obtener información completa del tenant incluyendo status y created_at
      const [[tenantInfo]] = await pool.query(
        `SELECT id, subdomain AS slug, name, is_system, status, created_at FROM tenant WHERE id = ? LIMIT 1`,
        [u.tenant_id]
      );

      // Obtener logo del tenant desde tenant_settings si existe
      let logoUrl = null;
      try {
        const tableExists = await pool.query(
          `SELECT COUNT(*) as count FROM information_schema.TABLES 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_settings'`
        );
        if (tableExists[0][0]?.count > 0) {
          const [[settings]] = await pool.query(
            `SELECT logo_url FROM tenant_settings WHERE tenant_id = ? LIMIT 1`,
            [u.tenant_id]
          );
          logoUrl = settings?.logo_url || null;
        }
      } catch (err) {
        // Si la tabla no existe o hay error, continuar sin logo
        console.warn("[AUTH/LOGIN] Error obteniendo logo:", err.message);
      }

      return res.json({
        ok: true,
        access,
        user: userPayload,
        tenant: tenantInfo ? {
          id: tenantInfo.id,
          slug: tenantInfo.slug,
          name: tenantInfo.name,
          is_system: Boolean(tenantInfo.is_system),
          status: tenantInfo.status || "active",
          created_at: tenantInfo.created_at,
          logo_url: logoUrl,
        } : {
          id: u.tenant_id,
          slug: u.slug,
          name: u.tenant_name,
          is_system: Boolean(u.is_system),
          status: u.tenant_status || "active",
          logo_url: logoUrl,
        }
      });
    }

    // ✅ CASO 2: Usuario pertenece a MÚLTIPLES tenants
    // Devolver lista para que el frontend permita elegir
    const tenants = activeUsers.map(u => ({
      tenantId: u.tenant_id,
      slug: u.slug,
      role: u.role,
      name: u.tenant_name,
      is_system: Boolean(u.is_system),
    }));

    const isSuperAdmin = activeUsers.some((u) => u.is_super_admin);

    return res.json({
      ok: true,
      multiTenant: true,
      email: emailLower,
      tenants,
      isSuperAdmin,
    });

  } catch (e) {
    console.error("[/auth/login] error:", e);
    return res.status(500).json({ 
      ok: false, 
      error: "Error de servidor" 
    });
  }
});

/* ============================================
   POST /auth/login-tenant
   - Para cuando el email pertenece a varios tenants
   - Body: { email, password, slug }
============================================= */
auth.post("/login-tenant", async (req, res) => {
  try {
    const { email, password, slug, twoFactorCode, rememberDevice } = req.body || {};
    
    if (!email || !password || !slug) {
      return res.status(400).json({ 
        ok: false, 
        error: "Email, password y slug requeridos" 
      });
    }

    const [[u]] = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.role, u.is_active,
              u.is_super_admin, u.current_branch_id, u.branch_access_mode,
              u.permissions,
              u.tenant_id, t.subdomain AS slug, t.status AS tenant_status,
              t.name AS tenant_name, t.is_system, t.activation_token,
              u.two_factor_enabled, u.remember_2fa_until
       FROM users u
       JOIN tenant t ON t.id = u.tenant_id
       WHERE u.email = ? AND t.subdomain = ?
       LIMIT 1`,
      [String(email).trim().toLowerCase(), slug]
    );

    if (!u) {
      return res.status(401).json({ 
        ok: false, 
        error: "Credenciales inválidas" 
      });
    }

    // Verificar si el tenant está en trial y no ha sido activado
    const status = String(u.tenant_status || "").toLowerCase();
    const isUnactivatedTrial = status === "trial" && 
                               u.activation_token != null && 
                               u.activation_token !== "";

    if (!u.is_active) {
      return res.status(403).json({ 
        ok: false, 
        error: "Cuenta desactivada" 
      });
    }

    if (isUnactivatedTrial) {
      return res.status(403).json({ 
        ok: false, 
        error: "Tu cuenta necesita ser activada",
        errorCode: "ACCOUNT_NOT_ACTIVATED",
        message: "Revisá tu correo electrónico y hacé clic en el enlace de activación que te enviamos."
      });
    }

    // Permitir "active" o "trial" que ya fue activado (sin activation_token)
    const isAllowedStatus = ALLOWED_TENANT_STATUSES.has(status) || 
                           (status === "trial" && (!u.activation_token || u.activation_token === ""));

    if (!isAllowedStatus) {
      return res.status(403).json({ 
        ok: false, 
        error: "Tenant inactivo" 
      });
    }

    const passOK = await bcrypt.compare(password, u.password_hash);
    if (!passOK) {
      return res.status(401).json({ 
        ok: false, 
        error: "Credenciales inválidas" 
      });
    }

    // Verificar 2FA si está activado
    if (u.two_factor_enabled) {
      // Verificar si el dispositivo está "recordado" (no requiere 2FA por 30 días)
      const now = new Date();
      const rememberUntil = u.remember_2fa_until ? new Date(u.remember_2fa_until) : null;
      const isRemembered = rememberUntil && rememberUntil > now;

      if (!isRemembered) {
        // Requiere código 2FA
        if (!twoFactorCode) {
          return res.status(200).json({
            ok: false,
            requiresTwoFactor: true,
            message: "Se requiere código de autenticación de doble factor"
          });
        }

        // Verificar código 2FA
        const [[user2FA]] = await pool.query(
          `SELECT two_factor_secret, two_factor_backup_codes FROM users WHERE id = ? AND tenant_id = ?`,
          [u.id, u.tenant_id]
        );

        if (!user2FA || !user2FA.two_factor_secret) {
          return res.status(400).json({
            ok: false,
            error: "2FA no configurado correctamente"
          });
        }

        // Verificar código TOTP
        const verified = speakeasy.totp.verify({
          secret: user2FA.two_factor_secret,
          encoding: 'base32',
          token: twoFactorCode,
          window: 2
        });

        // Si el código TOTP no es válido, verificar códigos de respaldo
        let isValidCode = verified;
        if (!verified && user2FA.two_factor_backup_codes) {
          try {
            const backupCodes = JSON.parse(user2FA.two_factor_backup_codes);
            const codeIndex = backupCodes.indexOf(twoFactorCode);
            if (codeIndex !== -1) {
              // Código de respaldo válido, removerlo
              backupCodes.splice(codeIndex, 1);
              await pool.query(
                `UPDATE users SET two_factor_backup_codes = ? WHERE id = ? AND tenant_id = ?`,
                [JSON.stringify(backupCodes), u.id, u.tenant_id]
              );
              isValidCode = true;
            }
          } catch (e) {
            console.error("[LOGIN-TENANT] Error parseando backup codes:", e);
          }
        }

        if (!isValidCode) {
          return res.status(401).json({
            ok: false,
            error: "Código de autenticación inválido"
          });
        }

        // Si rememberDevice es true, guardar remember_2fa_until por 30 días
        if (rememberDevice) {
          const rememberDate = new Date();
          rememberDate.setDate(rememberDate.getDate() + 30);
          await pool.query(
            `UPDATE users SET remember_2fa_until = ? WHERE id = ? AND tenant_id = ?`,
            [rememberDate, u.id, u.tenant_id]
          );
        }
      }
    }

    const isSuperAdmin = await ensureSuperAdminFlag(u);

    const access = signAccessToken({
      userId: u.id,
      tenantId: u.tenant_id,
      role: u.role,
      email: u.email,
      isSuperAdmin,
    });

    const refresh = signRefreshToken({
      userId: u.id,
      tenantId: u.tenant_id
    });

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, tenant_id, token, created_at)
       VALUES (?, ?, ?, NOW())`,
      [u.id, u.tenant_id, refresh]
    );

    await enforceSessionLimit(u.id, u.tenant_id, 1);

    res.cookie("rt", refresh, cookieOpts(Boolean(rememberDevice)));

    await pool.query(
      "UPDATE users SET last_login = NOW() WHERE id = ? AND tenant_id = ?",
      [u.id, u.tenant_id]
    );

    const userPayload = await buildUserPayload(u, {
      isSuperAdmin,
      tenantName: u.tenant_name,
    });

    // Obtener información completa del tenant incluyendo status y created_at
    const [[tenantInfo]] = await pool.query(
      `SELECT id, subdomain AS slug, name, is_system, status, created_at FROM tenant WHERE id = ? LIMIT 1`,
      [u.tenant_id]
    );

    return res.json({
      ok: true,
      access,
      user: userPayload,
      tenant: tenantInfo ? {
        id: tenantInfo.id,
        slug: tenantInfo.slug,
        name: tenantInfo.name,
        is_system: Boolean(tenantInfo.is_system),
        status: tenantInfo.status || "active",
        created_at: tenantInfo.created_at,
      } : {
        id: u.tenant_id,
        slug: u.slug,
        name: u.tenant_name,
        is_system: Boolean(u.is_system),
        status: u.tenant_status || "active",
      }
    });
  } catch (e) {
    console.error("[/auth/login-tenant] error:", e);
    return res.status(500).json({ 
      ok: false, 
      error: "Error de servidor" 
    });
  }
});

/* ============================================
   POST /auth/refresh
============================================= */
auth.post("/refresh", async (req, res) => {
  try {
    const token = req.cookies?.rt || null;
    if (!token) {
      return res.status(401).json({ 
        ok: false, 
        error: "Sin refresh token" 
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
      if (payload.t !== "refresh") {
        throw new Error("Tipo token inválido");
      }
    } catch {
      return res.status(401).json({ 
        ok: false, 
        error: "Refresh token inválido o expirado" 
      });
    }

    const [[row]] = await pool.query(
      `SELECT user_id, tenant_id FROM refresh_tokens WHERE token = ? LIMIT 1`,
      [token]
    );

    if (!row) {
      return res.status(401).json({ 
        ok: false, 
        error: "Refresh token desconocido" 
      });
    }

    const [[user]] = await pool.query(
      `SELECT id, email, role, is_active, is_super_admin, tenant_id, current_branch_id, branch_access_mode, permissions
       FROM users 
       WHERE id = ? AND tenant_id = ? 
       LIMIT 1`,
      [row.user_id, row.tenant_id]
    );

    if (!user || !user.is_active) {
      return res.status(401).json({ 
        ok: false, 
        error: "Usuario inactivo o inexistente" 
      });
    }

    const isSuperAdmin = await ensureSuperAdminFlag(user);

    const access = signAccessToken({
      userId: user.id,
      tenantId: row.tenant_id,
      role: user.role,
      email: user.email,
      isSuperAdmin,
    });

    const [[t]] = await pool.query(
      `SELECT id, subdomain AS slug, name, is_system, status, created_at FROM tenant WHERE id = ? LIMIT 1`,
      [row.tenant_id]
    );

    const userPayload = await buildUserPayload(user, {
      isSuperAdmin,
      tenantName: t?.name,
    });

    const newRefresh = signRefreshToken({
      userId: user.id,
      tenantId: row.tenant_id
    });

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, tenant_id, token, created_at)
       VALUES (?, ?, ?, NOW())`,
      [user.id, row.tenant_id, newRefresh]
    );

    await pool.query(
      `DELETE FROM refresh_tokens WHERE token = ?`,
      [token]
    );

    await enforceSessionLimit(user.id, row.tenant_id, 1);

    res.cookie("rt", newRefresh, cookieOpts(true));

    return res.json({
      ok: true,
      access,
      user: userPayload,
      tenant: t
        ? {
            id: t.id,
            slug: t.slug,
            name: t.name,
            is_system: Boolean(t.is_system),
            status: t.status || "active",
            created_at: t.created_at,
          }
        : null
    });
  } catch (e) {
    console.error("[/auth/refresh] error:", e);
    return res.status(500).json({ 
      ok: false, 
      error: "Error de servidor" 
    });
  }
});

/* ============================================
   POST /auth/logout
============================================= */
auth.post("/logout", async (req, res) => {
  try {
    const token = req.cookies?.rt || null;
    if (token) {
      await pool.query(`DELETE FROM refresh_tokens WHERE token = ?`, [token]);
    }
    res.clearCookie("rt", clearCookieOpts());
    return res.json({ ok: true });
  } catch (e) {
    console.error("[/auth/logout] error:", e);
    return res.json({ ok: true }); // fail-open
  }
});

/* ============================================
   GET /auth/me
============================================= */
auth.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    
    if (!token) {
      return res.status(401).json({ 
        ok: false, 
        error: "Falta token" 
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch {
      return res.status(401).json({ 
        ok: false, 
        error: "Token inválido o expirado" 
      });
    }

    const [[user]] = await pool.query(
      `SELECT id, email, role, is_active, is_super_admin, tenant_id, current_branch_id, branch_access_mode, permissions
       FROM users 
       WHERE id = ? AND tenant_id = ? 
       LIMIT 1`,
      [payload.sub, payload.tenant_id]
    );

    if (!user || !user.is_active) {
      return res.status(401).json({ 
        ok: false, 
        error: "Usuario inactivo o inexistente" 
      });
    }

    const isSuperAdmin = await ensureSuperAdminFlag(user);

    const [[t]] = await pool.query(
      `SELECT id, subdomain AS slug, name, is_system, status, created_at FROM tenant WHERE id = ? LIMIT 1`,
      [payload.tenant_id]
    );

    // Obtener logo del tenant desde tenant_settings si existe
    let logoUrl = null;
    try {
      const tableExists = await pool.query(
        `SELECT COUNT(*) as count FROM information_schema.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_settings'`
      );
      if (tableExists[0][0]?.count > 0) {
        const [[settings]] = await pool.query(
          `SELECT logo_url FROM tenant_settings WHERE tenant_id = ? LIMIT 1`,
          [payload.tenant_id]
        );
        logoUrl = settings?.logo_url || null;
      }
    } catch (err) {
      // Si la tabla no existe o hay error, continuar sin logo
      console.warn("[AUTH/ME] Error obteniendo logo:", err.message);
    }

    const userPayload = await buildUserPayload(user, {
      isSuperAdmin,
      tenantName: t?.name,
    });

    return res.json({
      ok: true,
      user: userPayload,
      tenant: t
        ? {
            id: t.id,
            slug: t.slug,
            name: t.name,
            is_system: Boolean(t.is_system),
            status: t.status || "active",
            created_at: t.created_at,
            logo_url: logoUrl,
          }
        : null
    });
  } catch (e) {
    console.error("[/auth/me] error:", e);
    return res.status(500).json({ 
      ok: false, 
      error: "Error de servidor" 
    });
  }
});

/* ============================================
   POST /auth/forgot-password
   - Solicita recuperación de contraseña
   - Envía email con token
============================================ */
auth.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    
    if (!email) {
      return res.status(400).json({ 
        ok: false, 
        error: "Email requerido" 
      });
    }

    const emailLower = String(email).trim().toLowerCase();

    // Buscar usuario (puede estar en múltiples tenants)
    const [users] = await pool.query(
      `SELECT u.id, u.email, u.tenant_id, t.subdomain AS slug, t.name AS tenant_name, t.status AS tenant_status
       FROM users u
       JOIN tenant t ON t.id = u.tenant_id
       WHERE u.email = ? AND u.is_active = 1
         AND t.status = 'active'`,
      [emailLower]
    );

    // Por seguridad, siempre devolvemos éxito aunque el email no exista
    if (!users.length) {
      console.warn("[FORGOT-PASSWORD] Email no encontrado o inactivo:", emailLower);
      return res.json({ 
        ok: true, 
        message: "Si el email existe, recibirás un correo con instrucciones" 
      });
    }

    // Generar token único para cada tenant del usuario
    const frontendUrl = process.env.FRONTEND_URL || process.env.FRONTEND_URL_HTTPS || "http://localhost:5173";
    
    for (const user of users) {
      // Generar token seguro
      const token = crypto.randomBytes(32).toString("hex");
      
      // Usar DATE_ADD de MySQL para calcular la expiración en el servidor (evita problemas de zona horaria)
      // Válido por 1 hora
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, tenant_id, token, expires_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
        [user.id, user.tenant_id, token]
      );
      
      // Verificar la fecha de expiración guardada
      const [[savedToken]] = await pool.query(
        `SELECT expires_at FROM password_reset_tokens WHERE token = ? LIMIT 1`,
        [token]
      );
      
      if (savedToken) {
        const expiresAt = new Date(savedToken.expires_at);
        const now = new Date();
        const timeUntilExpiry = expiresAt.getTime() - now.getTime();
        console.log(`[FORGOT-PASSWORD] Token creado - expira en: ${expiresAt.toISOString()} (${Math.round(timeUntilExpiry / 1000 / 60)} minutos desde ahora)`);
      }

      // Construir URL de reset
      const resetUrl = `${frontendUrl}/reset-password?token=${token}&email=${encodeURIComponent(emailLower)}`;
      
      // Logo incrustado directamente como SVG (muchos clientes bloquean data URIs)
      // Usar el logo real de la empresa desde el archivo SVG
      const { getEmailLogo } = await import("../utils/emailLogo.js");
      const logoSvg = getEmailLogo('light', 'header'); // 'light' para fondos oscuros, 'dark' para claros, o 'default'
      const footerLogoSvg = getEmailLogo('light', 'footer'); // IDs únicos para evitar colisiones

      // Enviar email (sin await para no bloquear la respuesta)
      // El email se envía en background, si falla se loguea pero no afecta la respuesta
      sendEmail({
        to: emailLower,
        from: "soporte@arjaerp.com.ar",
        subject: "Recuperación de contraseña - ARJA ERP",
        html: `
          <!DOCTYPE html>
          <html lang="es">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Recuperación de contraseña - ARJA ERP</title>
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f7fa;">
            <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f7fa;">
              <tr>
                <td align="center" style="padding: 40px 20px;">
                  <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                    <!-- Header con Logo -->
                    <tr>
                      <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #13b5cf 0%, #0d7fd4 100%); border-radius: 12px 12px 0 0;">
                        <div style="display: inline-block; max-width: 200px; width: 100%;">
                          ${logoSvg}
                        </div>
                      </td>
                    </tr>
                    
                    <!-- Contenido principal -->
                    <tr>
                      <td style="padding: 40px;">
                        <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: #1a202c; line-height: 1.3;">
                          Recuperación de contraseña
                        </h1>
                        
                        <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #4a5568;">
                          Hola,
                        </p>
                        
                        <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #4a5568;">
                          Recibimos una solicitud para restablecer tu contraseña en <strong style="color: #13b5cf;">${user.tenant_name || user.slug}</strong>.
                        </p>
                        
                        <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: #4a5568;">
                          Hacé clic en el botón de abajo para crear una nueva contraseña. Este enlace es válido por <strong>1 hora</strong>.
                        </p>
                        
                        <!-- Botón CTA -->
                        <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 30px 0;">
                          <tr>
                            <td align="center" style="padding: 0;">
                              <a href="${resetUrl}" 
                                 style="display: inline-block; background: linear-gradient(135deg, #13b5cf 0%, #0d7fd4 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(19, 181, 207, 0.3);">
                                Restablecer contraseña
                              </a>
                            </td>
                          </tr>
                        </table>
                        
                        <!-- Link alternativo -->
                        <p style="margin: 30px 0 20px; font-size: 14px; line-height: 1.6; color: #718096;">
                          Si el botón no funciona, copiá y pegá este enlace en tu navegador:
                        </p>
                        <p style="margin: 0 0 30px; font-size: 13px; line-height: 1.5; color: #13b5cf; word-break: break-all; padding: 12px; background-color: #f7fafc; border-radius: 6px; border-left: 3px solid #13b5cf;">
                          ${resetUrl}
                        </p>
                        
                        <!-- Advertencia de seguridad -->
                        <div style="margin: 30px 0; padding: 16px; background-color: #fff5e6; border-radius: 8px; border-left: 4px solid #f59e0b;">
                          <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #92400e;">
                            <strong style="color: #b45309;">⚠️ Importante:</strong> Si no solicitaste este cambio, podés ignorar este correo de forma segura. Tu contraseña no se modificará.
                          </p>
                        </div>
                      </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                      <td style="padding: 30px 40px; background-color: #f7fafc; border-radius: 0 0 12px 12px; border-top: 1px solid #e2e8f0;">
                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                          <tr>
                            <td align="center" style="padding: 0;">
                              <!-- Logo pequeño en el footer -->
                              <div style="display: inline-block; max-width: 120px; width: 100%; margin: 0 auto 16px; opacity: 0.8;">
                                ${footerLogoSvg}
                              </div>
                              <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #1a202c;">
                                ARJA ERP
                              </p>
                              <p style="margin: 0 0 12px; font-size: 13px; color: #718096;">
                                Sistema de Gestión Empresarial
                              </p>
                              <p style="margin: 0; font-size: 12px; color: #a0aec0;">
                                © ${new Date().getFullYear()} ARJA ERP. Todos los derechos reservados.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Footer externo -->
                  <table role="presentation" style="max-width: 600px; width: 100%; margin-top: 20px;">
                    <tr>
                      <td align="center" style="padding: 0;">
                        <p style="margin: 0; font-size: 12px; color: #a0aec0; line-height: 1.5;">
                          Este es un correo automático, por favor no respondas a este mensaje.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `,
        text: `ARJA ERP - Recuperación de contraseña\n\nHola,\n\nRecibimos una solicitud para restablecer tu contraseña en ${user.tenant_name || user.slug}.\n\nHacé clic en este enlace para restablecer tu contraseña:\n${resetUrl}\n\nEste enlace expira en 1 hora.\n\nSi no solicitaste este cambio, podés ignorar este correo de forma segura.\n\n---\nARJA ERP - Sistema de Gestión Empresarial\n© ${new Date().getFullYear()} ARJA ERP. Todos los derechos reservados.`,
        retries: 3,
      }).catch((emailError) => {
        // Log del error pero no bloquear la respuesta
        console.error(`[FORGOT-PASSWORD] Error al enviar email a ${emailLower} (tenant: ${user.tenant_id}):`, emailError.message);
      });
    }

    console.log(`✅ [FORGOT-PASSWORD] Email de recuperación enviado a: ${emailLower} (${users.length} tenant/s)`);

    return res.json({ 
      ok: true, 
      message: "Si el email existe, recibirás un correo con instrucciones" 
    });

  } catch (e) {
    console.error("[/auth/forgot-password] error:", e);
    return res.status(500).json({ 
      ok: false, 
      error: "Error de servidor" 
    });
  }
});

/* ============================================
   POST /auth/reset-password
   - Resetea la contraseña con el token
============================================ */
auth.post("/reset-password", async (req, res) => {
  try {
    const { token, email, password } = req.body || {};
    
    console.log(`[RESET-PASSWORD] Intento de reset - email: ${email ? 'proporcionado' : 'faltante'}, token: ${token ? 'proporcionado' : 'faltante'}, password: ${password ? 'proporcionado' : 'faltante'}`);
    
    if (!token || !email || !password) {
      console.log(`[RESET-PASSWORD] ❌ Faltan campos requeridos - token: ${!!token}, email: ${!!email}, password: ${!!password}`);
      return res.status(400).json({ 
        ok: false, 
        error: "Token, email y nueva contraseña son requeridos" 
      });
    }

    // Validar contraseña con restricciones de seguridad
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      console.log(`[RESET-PASSWORD] ❌ Validación de contraseña falló:`, passwordValidation.requirements);
      return res.status(400).json({ 
        ok: false, 
        error: getPasswordErrorMessage(passwordValidation),
        requirements: passwordValidation.requirements
      });
    }

    const emailLower = String(email).trim().toLowerCase();
    console.log(`[RESET-PASSWORD] Buscando token para email: ${emailLower}`);

    // Buscar token válido
    const [[tokenRow]] = await pool.query(
      `SELECT prt.id, prt.user_id, prt.tenant_id, prt.expires_at, prt.used_at,
              u.email, u.is_active
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token = ? AND u.email = ? AND prt.used_at IS NULL
       LIMIT 1`,
      [token, emailLower]
    );

    if (!tokenRow) {
      console.log(`[RESET-PASSWORD] ❌ Token no encontrado o ya utilizado para email: ${emailLower}`);
      // Verificar si el token existe pero está usado
      const [[usedToken]] = await pool.query(
        `SELECT prt.used_at, prt.expires_at
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
         WHERE prt.token = ? AND u.email = ?
         LIMIT 1`,
        [token, emailLower]
      );
      if (usedToken) {
        if (usedToken.used_at) {
          console.log(`[RESET-PASSWORD] ⚠️  Token ya fue utilizado`);
        } else {
          console.log(`[RESET-PASSWORD] ⚠️  Token existe pero no coincide con email`);
        }
      }
      return res.status(400).json({ 
        ok: false, 
        error: "Token inválido o ya utilizado" 
      });
    }

    console.log(`[RESET-PASSWORD] ✅ Token encontrado - expira: ${tokenRow.expires_at}, usado: ${tokenRow.used_at}`);

    // Verificar expiración
    const now = new Date();
    const expiresAt = new Date(tokenRow.expires_at);
    
    // Asegurar que ambas fechas estén en UTC para comparación correcta
    const nowTime = now.getTime();
    const expiresTime = expiresAt.getTime();
    const timeUntilExpiry = expiresTime - nowTime;
    
    console.log(`[RESET-PASSWORD] Verificación de expiración - ahora: ${now.toISOString()} (${nowTime}), expira: ${expiresAt.toISOString()} (${expiresTime}), tiempo restante: ${timeUntilExpiry}ms (${Math.round(timeUntilExpiry / 1000 / 60)} minutos)`);
    
    if (nowTime > expiresTime) {
      console.log(`[RESET-PASSWORD] ❌ Token expirado - ahora: ${now.toISOString()}, expira: ${expiresAt.toISOString()}, diferencia: ${Math.round((nowTime - expiresTime) / 1000 / 60)} minutos`);
      return res.status(400).json({ 
        ok: false, 
        error: "El token ha expirado. Solicitá uno nuevo" 
      });
    }

    // Hashear nueva contraseña
    const passwordHash = await bcrypt.hash(password, 10);

    // Actualizar contraseña y activar cuenta automáticamente
    // Si el usuario resetea la contraseña, significa que verificó su identidad, así que activamos la cuenta
    await pool.query(
      `UPDATE users 
       SET password_hash = ?, 
           is_active = 1, 
           activation_token = NULL 
       WHERE id = ? AND tenant_id = ?`,
      [passwordHash, tokenRow.user_id, tokenRow.tenant_id]
    );

    // Marcar token como usado
    await pool.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?`,
      [tokenRow.id]
    );

    // Invalidar todos los refresh tokens del usuario (forzar re-login)
    await pool.query(
      `DELETE FROM refresh_tokens WHERE user_id = ? AND tenant_id = ?`,
      [tokenRow.user_id, tokenRow.tenant_id]
    );

    console.log(`✅ [RESET-PASSWORD] Contraseña actualizada para usuario ${emailLower} (tenant ${tokenRow.tenant_id})`);

    return res.json({ 
      ok: true, 
      message: "Contraseña actualizada correctamente" 
    });

  } catch (e) {
    console.error("[/auth/reset-password] error:", e);
    return res.status(500).json({ 
      ok: false, 
      error: "Error de servidor" 
    });
  }
});

/* ============================================
   POST /auth/2fa/setup
   - Genera secreto 2FA y QR code para activar
============================================ */
auth.post("/2fa/setup", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    
    if (!token) {
      return res.status(401).json({ 
        ok: false, 
        error: "Token requerido" 
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch {
      return res.status(401).json({ 
        ok: false, 
        error: "Token inválido o expirado" 
      });
    }

    const [[user]] = await pool.query(
      `SELECT id, email, tenant_id, two_factor_enabled FROM users WHERE id = ? AND tenant_id = ?`,
      [payload.sub, payload.tenant_id]
    );

    if (!user) {
      return res.status(404).json({ 
        ok: false, 
        error: "Usuario no encontrado" 
      });
    }

    // Generar secreto 2FA
    const secret = speakeasy.generateSecret({
      name: `ARJA ERP (${user.email})`,
      length: 32
    });

    // Generar QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Guardar secreto temporalmente (no activar aún)
    await pool.query(
      `UPDATE users SET two_factor_secret = ? WHERE id = ? AND tenant_id = ?`,
      [secret.base32, user.id, user.tenant_id]
    );

    return res.json({
      ok: true,
      secret: secret.base32,
      qrCode: qrCodeUrl,
      manualEntryKey: secret.base32
    });

  } catch (e) {
    console.error("[/auth/2fa/setup] error:", e);
    return res.status(500).json({ 
      ok: false, 
      error: "Error de servidor" 
    });
  }
});

/* ============================================
   POST /auth/2fa/verify
   - Verifica código 2FA y activa 2FA
============================================ */
auth.post("/2fa/verify", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const { code } = req.body || {};
    
    if (!token) {
      return res.status(401).json({ 
        ok: false, 
        error: "Token requerido" 
      });
    }

    if (!code) {
      return res.status(400).json({ 
        ok: false, 
        error: "Código 2FA requerido" 
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch {
      return res.status(401).json({ 
        ok: false, 
        error: "Token inválido o expirado" 
      });
    }

    const [[user]] = await pool.query(
      `SELECT id, email, tenant_id, two_factor_secret FROM users WHERE id = ? AND tenant_id = ?`,
      [payload.sub, payload.tenant_id]
    );

    if (!user || !user.two_factor_secret) {
      return res.status(400).json({ 
        ok: false, 
        error: "2FA no configurado. Ejecutá /2fa/setup primero" 
      });
    }

    // Verificar código
    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 2
    });

    if (!verified) {
      return res.status(401).json({ 
        ok: false, 
        error: "Código inválido" 
      });
    }

    // Generar códigos de respaldo
    const backupCodes = [];
    for (let i = 0; i < 10; i++) {
      backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }

    // Activar 2FA
    await pool.query(
      `UPDATE users 
       SET two_factor_enabled = TRUE, 
           two_factor_backup_codes = ?
       WHERE id = ? AND tenant_id = ?`,
      [JSON.stringify(backupCodes), user.id, user.tenant_id]
    );

    return res.json({
      ok: true,
      message: "2FA activado correctamente",
      backupCodes // Mostrar solo una vez
    });

  } catch (e) {
    console.error("[/auth/2fa/verify] error:", e);
    return res.status(500).json({ 
      ok: false, 
      error: "Error de servidor" 
    });
  }
});

/* ============================================
   POST /auth/2fa/disable
   - Desactiva 2FA
============================================ */
auth.post("/2fa/disable", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const { password } = req.body || {};
    
    if (!token) {
      return res.status(401).json({ 
        ok: false, 
        error: "Token requerido" 
      });
    }

    if (!password) {
      return res.status(400).json({ 
        ok: false, 
        error: "Contraseña requerida para desactivar 2FA" 
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch {
      return res.status(401).json({ 
        ok: false, 
        error: "Token inválido o expirado" 
      });
    }

    const [[user]] = await pool.query(
      `SELECT id, email, tenant_id, password_hash, two_factor_enabled FROM users WHERE id = ? AND tenant_id = ?`,
      [payload.sub, payload.tenant_id]
    );

    if (!user) {
      return res.status(404).json({ 
        ok: false, 
        error: "Usuario no encontrado" 
      });
    }

    if (!user.two_factor_enabled) {
      return res.status(400).json({ 
        ok: false, 
        error: "2FA no está activado" 
      });
    }

    // Verificar contraseña
    const passOK = await bcrypt.compare(password, user.password_hash);
    if (!passOK) {
      return res.status(401).json({ 
        ok: false, 
        error: "Contraseña incorrecta" 
      });
    }

    // Desactivar 2FA
    await pool.query(
      `UPDATE users 
       SET two_factor_enabled = FALSE, 
           two_factor_secret = NULL,
           two_factor_backup_codes = NULL,
           remember_2fa_until = NULL
       WHERE id = ? AND tenant_id = ?`,
      [user.id, user.tenant_id]
    );

    return res.json({
      ok: true,
      message: "2FA desactivado correctamente"
    });

  } catch (e) {
    console.error("[/auth/2fa/disable] error:", e);
    return res.status(500).json({ 
      ok: false, 
      error: "Error de servidor" 
    });
  }
});

/* ============================================
   GET /auth/2fa/status
   - Obtiene estado de 2FA del usuario
============================================ */
auth.get("/2fa/status", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    
    if (!token) {
      return res.status(401).json({ 
        ok: false, 
        error: "Token requerido" 
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch {
      return res.status(401).json({ 
        ok: false, 
        error: "Token inválido o expirado" 
      });
    }

    const [[user]] = await pool.query(
      `SELECT two_factor_enabled, remember_2fa_until FROM users WHERE id = ? AND tenant_id = ?`,
      [payload.sub, payload.tenant_id]
    );

    if (!user) {
      return res.status(404).json({ 
        ok: false, 
        error: "Usuario no encontrado" 
      });
    }

    const now = new Date();
    const rememberUntil = user.remember_2fa_until ? new Date(user.remember_2fa_until) : null;
    const isRemembered = rememberUntil && rememberUntil > now;

    return res.json({
      ok: true,
      enabled: Boolean(user.two_factor_enabled),
      remembered: isRemembered,
      rememberUntil: rememberUntil ? rememberUntil.toISOString() : null
    });

  } catch (e) {
    console.error("[/auth/2fa/status] error:", e);
    return res.status(500).json({ 
      ok: false, 
      error: "Error de servidor" 
    });
  }
});

export default auth;
