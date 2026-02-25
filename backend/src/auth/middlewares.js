// src/auth/middlewares.js
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const ENABLE_AUTH_LOGGING = process.env.ENABLE_AUTH_LOGGING === 'true';

export async function requireAuth(req, res, next) {
  if (req.method === "OPTIONS") return next();

  // Usar originalUrl para obtener el path completo
  const fullPath = req.originalUrl || req.url || req.path;
  
  // Permitir rutas públicas sin autenticación
  const publicPaths = [
    '/api/public/',
    '/api/health',
    '/api/mp-webhook',
    '/api/webhooks/',
    '/api/whatsapp',
    '/api/chat',
    '/api/availability',
    '/api/config/whatsapp/callback', // Callback de OAuth de WhatsApp (llamado por Meta sin token)
  ];
  
  // Verificar tanto con el path completo como con req.path (por si acaso)
  const isPublicPath = publicPaths.some(path => 
    fullPath.startsWith(path) || req.path.startsWith(path)
  );
  
  if (isPublicPath) {
    if (ENABLE_AUTH_LOGGING) {
      console.log(`[requireAuth] Ruta pública detectada: ${fullPath} (req.path: ${req.path}) - permitiendo acceso sin token`);
    }
    return next();
  }

  if (ENABLE_AUTH_LOGGING) {
    console.log(`[requireAuth] Ruta protegida: ${fullPath} (req.path: ${req.path}) - verificando token`);
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    if (ENABLE_AUTH_LOGGING) {
      console.log(`[requireAuth] Token faltante para ruta: ${fullPath}`);
    }
    return res.status(401).json({ ok: false, error: "Falta token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    
    // Si es un token de cliente (customer), permitir acceso sin verificar tabla users
    if (payload.type === 'customer') {
      req.user = {
        id: payload.sub,
        tenant_id: payload.tenant_id,
        type: 'customer',
        email: payload.email,
      };
      return next();
    }
    
    // Obtener permisos del usuario desde la BD (para usuarios del sistema)
    let permissions = {};
    let currentBranchId = null;
    let branchAccessMode = "all";
    let branchIds = [];
    if (payload.sub) {
      try {
        // Intentar obtener permisos, pero manejar el caso donde la columna no existe
        const [[user]] = await pool.query(
          `SELECT permissions, current_branch_id, branch_access_mode FROM users WHERE id = ?`,
          [payload.sub]
        );
        if (user?.permissions) {
          try {
            permissions = typeof user.permissions === 'string' 
              ? JSON.parse(user.permissions) 
              : user.permissions;
            if (ENABLE_AUTH_LOGGING) {
              console.log(`[requireAuth] Permisos cargados para usuario ${payload.sub}:`, JSON.stringify(permissions));
              console.log(`[requireAuth] Permisos de stock para usuario ${payload.sub}:`, permissions.stock);
            }
          } catch (err) {
            console.error(`[requireAuth] Error parseando permisos para usuario ${payload.sub}:`, err.message);
            permissions = {};
          }
        } else {
          if (ENABLE_AUTH_LOGGING) {
            console.log(`[requireAuth] Usuario ${payload.sub} no tiene permisos definidos`);
          }
        }
        if (user?.current_branch_id) {
          currentBranchId = Number(user.current_branch_id);
        }
        branchAccessMode = user?.branch_access_mode || "all";
        if (branchAccessMode === "custom") {
          const [accessRows] = await pool.query(
            `SELECT branch_id FROM user_branch_access WHERE user_id = ?`,
            [payload.sub]
          );
          branchIds = accessRows.map((row) => Number(row.branch_id));
        }
      } catch (err) {
        // Si la columna no existe (ER_BAD_FIELD_ERROR), usar permisos vacíos
        if (err.code === 'ER_BAD_FIELD_ERROR' && err.errno === 1054) {
          console.warn("[requireAuth] Columna 'permissions' no existe. Ejecuta la migración 001_multi_business_stock.sql");
          permissions = {};
        } else {
          console.warn("[requireAuth] Error obteniendo permisos:", err.message);
        }
      }
    }
    
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      tenant_id: payload.tenant_id, // ✅ CRÍTICO
      permissions: permissions || {},
      is_super_admin: Boolean(payload.is_super_admin),
      currentBranchId,
      current_branch_id: currentBranchId,
      branch_access_mode: branchAccessMode,
      branchAccessMode,
      branch_ids: branchIds,
      branchIds,
    };
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Token inválido o expirado" });
  }
}

/** ✅ Nueva función para control de roles */
export function requireRole(...roles) {
  return (req, res, next) => {
    // Permitir tokens de tipo 'customer' en rutas específicas de membresías (solo lectura)
    if (req.user?.type === 'customer') {
      const path = req.path || "";
      const fullPath = req.originalUrl || "";
      
      // Permitir a clientes acceder a rutas de membresías de solo lectura
      if (fullPath.includes("/memberships/plans") && req.method === 'GET') {
        if (ENABLE_AUTH_LOGGING) {
          console.log(`[requireRole] Acceso concedido: cliente accediendo a GET /memberships/plans`);
        }
        return next();
      }
      if (fullPath.includes("/memberships/my") && req.method === 'GET') {
        if (ENABLE_AUTH_LOGGING) {
          console.log(`[requireRole] Acceso concedido: cliente accediendo a GET /memberships/my`);
        }
        return next();
      }
      
      // Para otras rutas, denegar acceso a clientes
      console.error("[requireRole] Cliente intentando acceder a ruta no permitida:", fullPath);
      return res.status(403).json({ ok: false, error: "Acceso denegado: esta ruta requiere permisos de administrador" });
    }
    
    if (!req.user?.role) {
      console.error("[requireRole] Usuario no autenticado. req.user:", req.user);
      return res.status(403).json({ ok: false, error: "Usuario no autenticado" });
    }

    if (req.user.is_super_admin) {
      if (ENABLE_AUTH_LOGGING) {
        console.log(`[requireRole] Acceso concedido: usuario super admin`);
      }
      return next();
    }

    // Log para debugging
    if (ENABLE_AUTH_LOGGING) {
      console.log(`[requireRole] Usuario: ${req.user.email}, Rol: ${req.user.role}, Roles requeridos: ${roles.join(", ")}, Permisos:`, JSON.stringify(req.user.permissions));
    }

    // Si el rol es "admin", siempre tiene acceso completo (sin verificar permisos)
    if (req.user.role === "admin") {
      if (ENABLE_AUTH_LOGGING) {
        console.log(`[requireRole] Acceso concedido: usuario es admin`);
      }
      return next();
    }

    // Normalizar roles para comparación (case-insensitive)
    const userRole = String(req.user.role || "").toLowerCase();
    const allowedRoles = roles.map(r => String(r).toLowerCase());
    
    // Si el rol está permitido, dar acceso inmediato
    if (allowedRoles.includes(userRole)) {
      console.log(`[requireRole] Acceso concedido: rol permitido (${req.user.role})`);
      return next();
    }

    // Si el rol no está permitido, verificar permisos específicos
    const permissions = req.user.permissions || {};
    
    // Verificar permisos según el módulo de la ruta
    // Usar originalUrl para obtener la ruta completa (incluye /api/appointments, etc.)
    const originalUrl = req.originalUrl || "";
    const baseUrl = req.baseUrl || "";
    const path = req.path || "";
    const fullPath = originalUrl || baseUrl + path;
    
    if (ENABLE_AUTH_LOGGING) {
      console.log(`[requireRole] Verificando path: originalUrl="${originalUrl}", baseUrl="${baseUrl}", path="${path}", fullPath="${fullPath}"`);
    }
    
    let requiredPermissions = [];
    
    if (fullPath.includes("/appointments") || fullPath.includes("/meta/")) {
      requiredPermissions = ["appointments.read", "appointments.write", "appointments.admin"];
      if (ENABLE_AUTH_LOGGING) {
        console.log(`[requireRole] Ruta requiere permisos de appointments`);
      }
    } else if (fullPath.includes("/customers") || fullPath.includes("/meta/customers")) {
      requiredPermissions = ["customers.read", "customers.write", "customers.admin"];
      if (ENABLE_AUTH_LOGGING) {
        console.log(`[requireRole] Ruta requiere permisos de customers`);
      }
    } else if (fullPath.includes("/classes")) {
      requiredPermissions = ["appointments.read", "appointments.write", "appointments.admin", "classes.read", "classes.write", "classes.admin"];
      if (ENABLE_AUTH_LOGGING) {
        console.log(`[requireRole] Ruta requiere permisos de classes`);
      }
    } else if (fullPath.includes("/branches/catalog")) {
      // El endpoint /branches/catalog es accesible para todos los usuarios autenticados
      // No requiere permisos específicos, solo autenticación
      if (ENABLE_AUTH_LOGGING) {
        console.log(`[requireRole] Ruta /branches/catalog - acceso permitido para usuarios autenticados`);
      }
      return next();
    } else if (fullPath.includes("/branches/current")) {
      // El endpoint /branches/current es accesible para todos los usuarios autenticados
      // La validación de permisos de sucursal se hace dentro del handler
      if (ENABLE_AUTH_LOGGING) {
        console.log(`[requireRole] Ruta /branches/current - acceso permitido para usuarios autenticados`);
      }
      return next();
    } else if (fullPath.includes("/admin/")) {
      requiredPermissions = ["config.admin", "appointments.admin"]; // Admin routes requieren permisos de admin
      if (ENABLE_AUTH_LOGGING) {
        console.log(`[requireRole] Ruta requiere permisos de admin`);
      }
    }
    
    // Verificar si el usuario tiene alguno de los permisos requeridos
    if (requiredPermissions.length > 0) {
      const appointmentsPerms = permissions.appointments || [];
      const customersPerms = permissions.customers || [];
      const configPerms = permissions.config || [];
      const classesPerms = permissions.classes || [];
      
      const allUserPerms = [...appointmentsPerms, ...customersPerms, ...configPerms, ...classesPerms];
      
      // Verificar si tiene algún permiso requerido o admin del módulo
      const hasPermission = requiredPermissions.some(perm => {
        const [module] = perm.split(".");
        return allUserPerms.includes(perm) || 
               allUserPerms.includes(`${module}.admin`) ||
               allUserPerms.includes(`${module}.write`);
      });
      
      if (hasPermission) {
        if (ENABLE_AUTH_LOGGING) {
          console.log(`[requireRole] Permiso concedido por permisos específicos`);
        }
        return next();
      }
    }

    console.error(`[requireRole] Acceso denegado. Usuario: ${req.user.email}, Rol: ${req.user.role}, Path: ${path}, Roles permitidos: ${roles.join(", ")}`);
    return res.status(403).json({ ok: false, error: "Acceso denegado: rol o permisos insuficientes" });
  };
}

/** 🔒 Atajo para admin */
export const requireAdmin = requireRole("admin");
