// src/routes/users.js
import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import { getPrimaryBranchId } from "../services/branches.js";
import { validatePassword, getPasswordErrorMessage } from "../utils/passwordValidation.js";

const ACCESS_MODES = new Set(["all", "custom"]);

function normalizeIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function validateBranchIds(conn, tenantId, branchIds) {
  if (!branchIds.length) return [];
  const unique = Array.from(new Set(branchIds));
  const placeholders = unique.map(() => "?").join(",");
  const params = [tenantId, ...unique];
  const [rows] = await conn.query(
    `SELECT id FROM tenant_branch WHERE tenant_id = ? AND id IN (${placeholders})`,
    params
  );
  if (rows.length !== unique.length) {
    throw new Error("Algunas sucursales no pertenecen al negocio.");
  }
  return unique;
}

async function syncUserBranchAccess(conn, userId, mode, branchIds) {
  await conn.query(`DELETE FROM user_branch_access WHERE user_id = ?`, [userId]);
  if (mode === "custom" && branchIds.length) {
    const values = branchIds.flatMap((branchId) => [userId, branchId]);
    const placeholders = branchIds.map(() => "(?, ?)").join(",");
    await conn.query(
      `INSERT INTO user_branch_access (user_id, branch_id)
       VALUES ${placeholders}`,
      values
    );
  }
}

const router = express.Router();

// GET /api/users - Listar usuarios/empleados del tenant
router.get("/", requireAuth, identifyTenant, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { active_only = true } = req.query;

    let query = `
      SELECT u.id,
             u.email,
             u.role,
             u.is_active,
             u.permissions,
             u.is_super_admin,
             u.branch_access_mode,
             u.current_branch_id,
             u.created_at,
             u.last_login_at,
             (SELECT COUNT(*) FROM appointment WHERE instructor_id = u.id) as appointments_count
      FROM users u
      WHERE u.tenant_id = ?
    `;
    const params = [tenantId];

    if (active_only === 'true') {
      query += " AND u.is_active = 1";
    }

    query += " ORDER BY u.created_at DESC";

    const [rows] = await pool.query(query, params);
    
    // Parsear permissions JSON
    const [branchAccessRows] = await pool.query(
      `SELECT uba.user_id, uba.branch_id, tb.name
         FROM user_branch_access uba
         JOIN tenant_branch tb ON tb.id = uba.branch_id
        WHERE tb.tenant_id = ?`,
      [tenantId]
    );
    const branchesByUser = new Map();
    branchAccessRows.forEach((row) => {
      if (!branchesByUser.has(row.user_id)) {
        branchesByUser.set(row.user_id, []);
      }
      branchesByUser.get(row.user_id).push({
        id: Number(row.branch_id),
        name: row.name,
      });
    });

    const users = rows.map((user) => {
      const permissions = typeof user.permissions === "string"
        ? JSON.parse(user.permissions || "{}")
        : user.permissions || {};
      const branchNames = branchesByUser.get(user.id) || [];
      const branchAccessMode = user.branch_access_mode || "all";
      const branchIds = branchNames.map((b) => b.id);
      return {
      ...user,
        permissions,
        branch_access_mode: branchAccessMode,
        branchAccessMode,
        branchNames,
        branchIds,
        currentBranchId: user.current_branch_id || null,
      };
    });

    res.json({ ok: true, data: users });
  } catch (error) {
    console.error("[GET /api/users] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/users/:id - Obtener un usuario
router.get("/:id", requireAuth, identifyTenant, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { id } = req.params;

    const [[user]] = await pool.query(
      `SELECT id,
              email,
              role,
              is_active,
              is_super_admin,
              permissions,
              branch_access_mode,
              current_branch_id,
              created_at,
              last_login_at
       FROM users
       WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (!user) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado" });
    }

    user.permissions = typeof user.permissions === "string"
      ? JSON.parse(user.permissions || "{}")
      : user.permissions || {};

    const [branchRows] = await pool.query(
      `SELECT uba.branch_id, tb.name
         FROM user_branch_access uba
         JOIN tenant_branch tb ON tb.id = uba.branch_id
        WHERE uba.user_id = ?
          AND tb.tenant_id = ?`,
      [id, tenantId]
    );

    const branchAccessMode = user.branch_access_mode || "all";
    const branchNames = branchRows.map((row) => ({ id: Number(row.branch_id), name: row.name }));
    res.json({
      ok: true,
      data: {
        ...user,
        branch_access_mode: branchAccessMode,
        branchAccessMode,
        branchNames,
        branchIds: branchNames.map((item) => item.id),
        currentBranchId: user.current_branch_id || null,
      },
    });
  } catch (error) {
    console.error("[GET /api/users/:id] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/users - Crear nuevo usuario/empleado
router.post("/", requireAuth, identifyTenant, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant_id;
    const {
      email,
      password,
      role,
      permissions,
      is_active = true,
      branchAccessMode = "all",
      branchIds = [],
    } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ 
        ok: false, 
        error: "Email y password son requeridos" 
      });
    }

    // Validar contraseña con restricciones de seguridad
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ 
        ok: false, 
        error: getPasswordErrorMessage(passwordValidation),
        requirements: passwordValidation.requirements
      });
    }

    // Validar email único dentro del tenant
    const [[existing]] = await pool.query(
      `SELECT id FROM users WHERE email = ? AND tenant_id = ? LIMIT 1`,
      [email.toLowerCase(), tenantId]
    );

    if (existing) {
      return res.status(400).json({ 
        ok: false, 
        error: "Este email ya está en uso en este tenant" 
      });
    }

    // Validar role
    const validRoles = ['admin', 'staff', 'user'];
    const finalRole = validRoles.includes(role) ? role : 'user';

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Preparar permissions
    let permissionsJson = {};
    if (permissions && typeof permissions === 'object') {
      permissionsJson = permissions;
    } else if (role === 'admin') {
      // Admin tiene todos los permisos
      permissionsJson = {
        stock: ['admin'],
        invoicing: ['admin'],
        appointments: ['admin'],
        customers: ['admin'],
        config: ['admin'],
        users: ['admin']
      };
    }

    const { finalMode, normalizedBranchIds } = await (async () => {
      const mode = ACCESS_MODES.has(String(branchAccessMode)) ? branchAccessMode : "all";
      if (mode === "custom") {
        if (!branchIds || !branchIds.length) {
          throw new Error("Seleccioná al menos una sucursal para este usuario.");
        }
        const validIds = await validateBranchIds(conn, tenantId, normalizeIdArray(branchIds));
        if (!validIds.length) {
          throw new Error("No se seleccionaron sucursales válidas.");
        }
        return { finalMode: "custom", normalizedBranchIds: validIds };
      }
      return { finalMode: "all", normalizedBranchIds: [] };
    })();

    const primaryBranchId = await getPrimaryBranchId(tenantId);
    const initialBranchId =
      finalMode === "custom" ? normalizedBranchIds[0] || primaryBranchId : primaryBranchId;

    // Crear usuario
    const [result] = await conn.query(
      `INSERT INTO users (tenant_id, current_branch_id, branch_access_mode, email, password_hash, role, permissions, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        initialBranchId,
        finalMode,
        email.toLowerCase(),
        passwordHash,
        finalRole,
        JSON.stringify(permissionsJson),
        is_active ? 1 : 0
      ]
    );

    if (normalizedBranchIds.length) {
      await syncUserBranchAccess(conn, result.insertId, finalMode, normalizedBranchIds);
    }

    await conn.commit();
    res.status(201).json({ 
      ok: true, 
      data: { 
        id: result.insertId,
        email: email.toLowerCase(),
        role: finalRole
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error("[POST /api/users] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    conn.release();
  }
});

// PUT /api/users/:id - Actualizar usuario
router.put("/:id", requireAuth, identifyTenant, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant_id;
    const { id } = req.params;
    const {
      email,
      password,
      role,
      permissions,
      is_active,
      branchAccessMode,
      branchIds = [],
    } = req.body || {};

    // Verificar que el usuario existe y pertenece al tenant
    const [[existingUser]] = await conn.query(
      `SELECT id, role, current_branch_id, branch_access_mode
         FROM users
        WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (!existingUser) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado" });
    }

    // No permitir modificar el último admin
    if (existingUser.role === 'admin' && role !== undefined && role !== 'admin') {
      const [[adminCount]] = await pool.query(
        `SELECT COUNT(*) as count FROM users WHERE tenant_id = ? AND role = 'admin' AND is_active = 1`,
        [tenantId]
      );
      if (adminCount.count <= 1) {
        return res.status(400).json({ 
          ok: false, 
          error: "No se puede modificar el último administrador activo" 
        });
      }
    }

    const updates = [];
    const params = [];

    if (email !== undefined) {
      // Verificar que el email no esté en uso por otro usuario
      const [[existing]] = await pool.query(
        `SELECT id FROM users WHERE email = ? AND tenant_id = ? AND id != ?`,
        [email.toLowerCase(), tenantId, id]
      );
      if (existing) {
        return res.status(400).json({ 
          ok: false, 
          error: "Este email ya está en uso" 
        });
      }
      updates.push("email = ?");
      params.push(email.toLowerCase());
    }

    if (password !== undefined && password !== null && password.trim() !== "") {
      // Validar contraseña con restricciones de seguridad
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ 
          ok: false, 
          error: getPasswordErrorMessage(passwordValidation),
          requirements: passwordValidation.requirements
        });
      }
      
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push("password_hash = ?");
      params.push(passwordHash);
    }

    if (role !== undefined) {
      const validRoles = ['admin', 'staff', 'user'];
      if (validRoles.includes(role)) {
        updates.push("role = ?");
        params.push(role);
      }
    }

    if (permissions !== undefined) {
      // Asegurar que permissions sea un objeto válido
      let permissionsToSave = permissions;
      if (typeof permissions === 'string') {
        try {
          permissionsToSave = JSON.parse(permissions);
        } catch (err) {
          console.error(`[PUT /api/users/:id] Error parseando permisos:`, err.message);
          permissionsToSave = {};
        }
      }
      // Validar que permissionsToSave sea un objeto
      if (typeof permissionsToSave !== 'object' || permissionsToSave === null || Array.isArray(permissionsToSave)) {
        console.error(`[PUT /api/users/:id] Permisos inválidos, debe ser un objeto:`, permissionsToSave);
        permissionsToSave = {};
      }
      const permissionsJson = JSON.stringify(permissionsToSave);
      console.log(`[PUT /api/users/:id] Guardando permisos para usuario ${id}:`, permissionsJson);
      console.log(`[PUT /api/users/:id] Permisos de stock en el objeto:`, permissionsToSave.stock);
      updates.push("permissions = ?");
      params.push(permissionsJson);
    }

    let finalMode = existingUser.branch_access_mode || "all";
    let normalizedBranchIds = [];
    if (branchAccessMode !== undefined) {
      const normalizedMode = ACCESS_MODES.has(String(branchAccessMode))
        ? branchAccessMode
        : "all";
      if (normalizedMode === "custom") {
        const validIds = await validateBranchIds(conn, tenantId, normalizeIdArray(branchIds));
        if (!validIds.length) {
          throw new Error("Seleccioná al menos una sucursal válida.");
        }
        finalMode = "custom";
        normalizedBranchIds = validIds;
      } else {
        finalMode = "all";
      }
      updates.push("branch_access_mode = ?");
      params.push(finalMode);
    }

    if (is_active !== undefined) {
      // No permitir desactivar el último admin
      if (!is_active && existingUser.role === 'admin') {
        const [[adminCount]] = await pool.query(
          `SELECT COUNT(*) as count FROM users WHERE tenant_id = ? AND role = 'admin' AND is_active = 1 AND id != ?`,
          [tenantId, id]
        );
        if (adminCount.count === 0) {
          return res.status(400).json({ 
            ok: false, 
            error: "No se puede desactivar el último administrador activo" 
          });
        }
      }
      updates.push("is_active = ?");
      params.push(is_active ? 1 : 0);
    }

    if (updates.length === 0 && branchAccessMode === undefined) {
      return res.status(400).json({ ok: false, error: "No hay cambios para actualizar" });
    }

    // Ajustar sucursal actual si el modo cambia a custom
    if (branchAccessMode !== undefined) {
      if (finalMode === "custom") {
        const allowed = normalizedBranchIds.length
          ? normalizedBranchIds
          : normalizeIdArray(branchIds);
        const target = allowed[0] || existingUser.current_branch_id;
        if (!allowed.includes(existingUser.current_branch_id)) {
          updates.push("current_branch_id = ?");
          params.push(target);
        }
      } else if (finalMode === "all" && !existingUser.current_branch_id) {
        const primary = await getPrimaryBranchId(tenantId);
        updates.push("current_branch_id = ?");
        params.push(primary);
      }
    }

    if (updates.length) {
      params.push(id, tenantId);
      const [result] = await conn.query(
        `UPDATE users SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`,
        params
      );
      console.log(`[PUT /api/users/:id] Usuario ${id} actualizado. Filas afectadas:`, result.affectedRows);
      
      // Verificar que los permisos se guardaron correctamente
      if (permissions !== undefined) {
        const [[updatedUser]] = await conn.query(
          `SELECT permissions FROM users WHERE id = ? AND tenant_id = ?`,
          [id, tenantId]
        );
        if (updatedUser?.permissions) {
          try {
            const savedPerms = typeof updatedUser.permissions === 'string' 
              ? JSON.parse(updatedUser.permissions) 
              : updatedUser.permissions;
            console.log(`[PUT /api/users/:id] Permisos guardados verificados para usuario ${id}:`, JSON.stringify(savedPerms));
            console.log(`[PUT /api/users/:id] Permisos de stock guardados:`, savedPerms.stock);
          } catch (err) {
            console.error(`[PUT /api/users/:id] Error verificando permisos guardados:`, err.message);
          }
        }
      }
    }

    if (branchAccessMode !== undefined) {
      await syncUserBranchAccess(conn, id, finalMode, normalizedBranchIds);
    }

    await conn.commit();

    res.json({ ok: true, message: "Usuario actualizado" });
  } catch (error) {
    await conn.rollback();
    console.error("[PUT /api/users/:id] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/users/:id - Eliminar usuario (soft delete)
router.delete("/:id", requireAuth, identifyTenant, requireAdmin, async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { id } = req.params;

    // Verificar que el usuario existe
    const [[user]] = await pool.query(
      `SELECT id, role FROM users WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (!user) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado" });
    }

    // No permitir eliminar el último admin
    if (user.role === 'admin') {
      const [[adminCount]] = await pool.query(
        `SELECT COUNT(*) as count FROM users WHERE tenant_id = ? AND role = 'admin' AND is_active = 1`,
        [tenantId]
      );
      if (adminCount.count <= 1) {
        return res.status(400).json({ 
          ok: false, 
          error: "No se puede eliminar el último administrador activo" 
        });
      }
    }

    // Soft delete (desactivar)
    await pool.query(
      `UPDATE user SET is_active = 0 WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    res.json({ ok: true, message: "Usuario eliminado" });
  } catch (error) {
    console.error("[DELETE /api/users/:id] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/users/permissions/list - Listar permisos disponibles
router.get("/permissions/list", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT code, name, description, module, action 
       FROM permission 
       ORDER BY module, action`
    );
    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[GET /api/users/permissions/list] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/users/roles/list - Listar roles del sistema
router.get("/roles/list", requireAuth, identifyTenant, async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    
    // Roles del sistema
    const systemRoles = [
      { id: 'admin', name: 'Administrador', description: 'Acceso completo al sistema', is_system: true },
      { id: 'staff', name: 'Empleado', description: 'Puede gestionar turnos y clientes', is_system: true },
      { id: 'user', name: 'Usuario', description: 'Acceso básico', is_system: true }
    ];

    // Roles personalizados del tenant
    const [customRoles] = await pool.query(
      `SELECT id, name, description, permissions, is_system
       FROM role
       WHERE tenant_id = ?
       ORDER BY name`,
      [tenantId]
    );

    res.json({ 
      ok: true, 
      data: {
        system: systemRoles,
        custom: customRoles.map(r => ({
          ...r,
          permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions
        }))
      }
    });
  } catch (error) {
    console.error("[GET /api/users/roles/list] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;

