// src/routes/stock.js
import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import { resolveBranchFilter, resolveBranchForWrite, ensureBranchBelongsToTenant, ensureUserCanAccessBranch } from "../helpers/branchAccess.js";
import { notifyStockMovement } from "../services/stockService.js";

const router = express.Router();

// Middleware para verificar permisos de stock
export function checkStockPermission(action = 'read') {
  return async (req, res, next) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ ok: false, error: "No autenticado" });
    }

    // Admin tiene todos los permisos
    if (user.role === 'admin') {
      return next();
    }

    // Verificar permisos específicos
    let permissions = {};
    console.log(`[checkStockPermission] Usuario ${user.id} (${user.email}) - req.user.permissions tipo:`, typeof user.permissions, `Valor:`, user.permissions);
    
    if (user.permissions) {
      if (typeof user.permissions === "string") {
        try {
          permissions = JSON.parse(user.permissions);
          console.log(`[checkStockPermission] Permisos parseados desde string:`, JSON.stringify(permissions));
        } catch (err) {
          console.error(`[checkStockPermission] Error parseando permisos (string):`, err.message);
          permissions = {};
        }
      } else {
        permissions = user.permissions;
        console.log(`[checkStockPermission] Permisos ya son objeto:`, JSON.stringify(permissions));
      }
    } else {
      console.log(`[checkStockPermission] Usuario ${user.id} no tiene permisos definidos en req.user`);
    }
    
    const stockPerms = permissions.stock || [];
    const requiredPerm = `stock.${action}`;
    
    console.log(`[checkStockPermission] Usuario ${user.id} (${user.email}) - Rol: ${user.role}, Permisos completos:`, JSON.stringify(permissions), `Permisos de stock:`, stockPerms, `Requiere: ${requiredPerm}`);
    
    if (!stockPerms.includes(requiredPerm) && !stockPerms.includes('stock.admin')) {
      console.log(`[checkStockPermission] ❌ Usuario ${user.id} (${user.email}) no tiene permiso ${requiredPerm}. Permisos de stock:`, stockPerms);
      return res.status(403).json({ 
        ok: false, 
        error: `No tienes permiso para ${action} en stock. Contacta al administrador para que te asigne los permisos necesarios.` 
      });
    }

    console.log(`[checkStockPermission] ✅ Usuario ${user.id} (${user.email}) tiene permiso ${requiredPerm}`);
    next();
  };
}

async function checkColumnExists(tableName, columnName) {
  try {
    const [[result]] = await pool.query(
      `SELECT COUNT(*) as count 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ? 
         AND COLUMN_NAME = ?`,
      [tableName, columnName]
    );
    return result?.count > 0;
  } catch {
    return false;
  }
}

function buildBranchWhere(alias, filter) {
  if (!filter || filter.mode === "all") {
    return { clause: "", params: [] };
  }
  // Nota: branch_id puede no existir en algunas tablas, se manejará en las consultas
  return { clause: `AND ${alias}.branch_id = ?`, params: [filter.branchId] };
}

function handleStockError(res, err, fallback) {
  const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  res.status(status).json({ ok: false, error: err?.message || fallback });
}

async function assertProductVisibility(product, filter, hasBranchId = false, tenantId = null) {
  if (!product) return false;
  // Si el filtro es "all", permitir ver todos los productos
  if (filter?.mode === "all") {
    return true;
  }
  // Solo verificar branch_id si existe la columna y el filtro es single
  if (hasBranchId && filter?.mode === "single") {
    // Si el producto tiene el branch_id correcto, permitir
    if (Number(product.branch_id) === filter.branchId) {
      return true;
    }
    // Si no, verificar si tiene movimientos en esa sucursal
    const hasMovementBranchId = await checkColumnExists('stock_movement', 'branch_id');
    if (hasMovementBranchId && tenantId) {
      const [[movementCheck]] = await pool.query(
        `SELECT COUNT(*) as count 
         FROM stock_movement 
         WHERE product_id = ? AND tenant_id = ? AND branch_id = ? 
         LIMIT 1`,
        [product.id, tenantId, filter.branchId]
      );
      if (movementCheck?.count > 0) {
        return true;
      }
    }
    return false;
  }
  return true;
}

// GET /api/stock/products - Listar productos
router.get("/products", requireAuth, identifyTenant, checkStockPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { search, category, min_stock, active_only = true } = req.query;
    
    // Verificar si branch_id existe en la tabla product
    const hasBranchId = await checkColumnExists('product', 'branch_id');
    
    // Permitir forzar modo "all" mediante query parameter para ver stock total
    // Esto permite ver stock total incluso si el usuario solo tiene acceso a una sucursal
    const forceAllMode = req.query.mode === "all";
    let effectiveFilter;
    
    console.log("[GET /api/stock/products] Query params:", { mode: req.query.mode, branchId: req.query.branchId, forceAllMode });
    
    // Log adicional para debugging
    if (req.query.branchId) {
      console.log("[GET /api/stock/products] branchId tipo:", typeof req.query.branchId, "valor:", req.query.branchId, "es array:", Array.isArray(req.query.branchId));
    }
    
    // Limpiar branchId si es "all" o inválido antes de procesar
    // Si es un array, tomar el PRIMER valor válido (no el último)
    if (req.query.branchId) {
      let branchIdStr = null;
      
      if (Array.isArray(req.query.branchId)) {
        // Buscar el primer valor válido (número) en el array, ignorar "all"
        for (let i = 0; i < req.query.branchId.length; i++) {
          const value = String(req.query.branchId[i]).trim();
          const numValue = Number(value);
          // Si es un número válido, usar ese
          if (Number.isFinite(numValue) && numValue > 0) {
            branchIdStr = value;
            break;
          }
        }
        // Si no encontramos un número válido, eliminar branchId
        if (!branchIdStr) {
          delete req.query.branchId;
        } else {
          req.query.branchId = Number(branchIdStr);
        }
      } else {
        branchIdStr = String(req.query.branchId).trim();
        
        if (branchIdStr === "all" || branchIdStr === "" || branchIdStr === "undefined" || branchIdStr === "null") {
          delete req.query.branchId;
        } else {
          // Si es un número válido, normalizarlo
          const branchIdNum = Number(branchIdStr);
          if (Number.isFinite(branchIdNum) && branchIdNum > 0) {
            req.query.branchId = branchIdNum;
          } else {
            delete req.query.branchId;
          }
        }
      }
    }
    
    if (forceAllMode) {
      // Forzar modo "all" para cálculo de stock, no llamar a resolveBranchFilter
      // Esto permite ver todos los productos pero calcular stock total
      effectiveFilter = { mode: "all", branchId: null };
    } else {
      // Resolver filtro de sucursal normalmente
      effectiveFilter = resolveBranchFilter(req, { allowAll: true });
    }
    
    // Verificar si existe la tabla product_stock (nueva estructura)
    const hasProductStock = await checkColumnExists('product_stock', 'product_id');
    
    // Verificar si hay productos en product_stock para esta sucursal (para decidir qué método usar)
    let useProductStockFilter = false;
    if (hasProductStock && effectiveFilter.mode === "single" && effectiveFilter.branchId) {
      try {
        const [stockCount] = await pool.query(
          `SELECT COUNT(*) as count FROM product_stock WHERE tenant_id = ? AND branch_id = ?`,
          [tenantId, effectiveFilter.branchId]
        );
        // Si hay registros en product_stock, usar esa tabla para filtrar
        // Si no hay registros, usar el método anterior (p.branch_id)
        useProductStockFilter = stockCount[0].count > 0;
      } catch (error) {
        console.error("[GET /api/stock/products] Error al verificar product_stock:", error);
        useProductStockFilter = false;
      }
    }
    
    // Cuando mode=all, no aplicar filtro de sucursal en la consulta principal
    // pero sí calcular stock total
    // Si existe product_stock y tiene datos, usar esa tabla para filtrar, sino usar p.branch_id
    let branchClause;
    if (effectiveFilter.mode === "all") {
      branchClause = { clause: "", params: [] };
    } else if (useProductStockFilter && effectiveFilter.mode === "single") {
      // Si existe product_stock y tiene datos, filtrar por esa tabla (usando INNER JOIN, no clause)
      branchClause = { clause: "", params: [] };
    } else if (hasBranchId && effectiveFilter.mode === "single") {
      // Si no existe product_stock o no tiene datos, usar p.branch_id
      branchClause = buildBranchWhere("p", effectiveFilter);
    } else {
      branchClause = { clause: "", params: [] };
    }

    // Determinar si mostrar stock total o por sucursal
    const showTotalStock = effectiveFilter.mode === "all";
    const hasMovementBranchId = await checkColumnExists('stock_movement', 'branch_id');
    
    // Calcular stock según permisos del usuario
    // Si el usuario tiene acceso a todas las sucursales, mostrar stock total
    // Si solo tiene acceso a una sucursal, mostrar stock de esa sucursal
    const branchIdValue = effectiveFilter.branchId ? Number(effectiveFilter.branchId) : null;
    // Por defecto usar product_stock si existe, sino usar stock_quantity (compatibilidad)
    let stockCalculation = hasProductStock 
      ? `COALESCE((
          SELECT SUM(ps.quantity) 
          FROM product_stock ps 
          WHERE ps.product_id = p.id AND ps.tenant_id = p.tenant_id
        ), 0) as stock_quantity`
      : 'COALESCE(p.stock_quantity, 0) as stock_quantity';
    
    // Si existe product_stock, usar esa tabla para el stock
    if (hasProductStock) {
      if (showTotalStock) {
        // Stock total: sumar todas las cantidades de product_stock
        stockCalculation = `(
          SELECT COALESCE(SUM(ps.quantity), 0)
          FROM product_stock ps
          WHERE ps.product_id = p.id AND ps.tenant_id = p.tenant_id
        ) as stock_quantity`;
      } else if (branchIdValue) {
        // Stock por sucursal: usar product_stock.quantity de la sucursal específica
        stockCalculation = `COALESCE((
          SELECT ps.quantity
          FROM product_stock ps
          WHERE ps.product_id = p.id 
            AND ps.branch_id = ${branchIdValue}
            AND ps.tenant_id = p.tenant_id
          LIMIT 1
        ), 0) as stock_quantity`;
      }
    } else if (hasMovementBranchId) {
      // Si no existe product_stock, usar stock_movement (código anterior)
      if (showTotalStock) {
        // Stock total: sumar todos los movimientos sin filtrar por sucursal
        // Las transferencias NO afectan el stock total (son movimientos internos entre sucursales)
        // Solo se consideran entradas/salidas reales al sistema
        stockCalculation = `(
          SELECT COALESCE(SUM(
            CASE 
              WHEN sm.type IN ('entry', 'adjustment') THEN sm.quantity
              WHEN sm.type IN ('exit', 'sale', 'return') THEN -ABS(sm.quantity)
              -- transfer_in y transfer_out se cancelan entre sí, no afectan stock total
              ELSE 0
            END
          ), 0)
          FROM stock_movement sm
          WHERE sm.product_id = p.id AND sm.tenant_id = p.tenant_id
        ) as stock_quantity`;
      } else if (branchIdValue) {
        // Stock por sucursal: solo movimientos de la sucursal del usuario
        // Incluye transferencias entrantes y excluye transferencias salientes
        stockCalculation = `(
          SELECT COALESCE(SUM(
            CASE 
              WHEN sm.type IN ('entry', 'adjustment', 'transfer_in') THEN sm.quantity
              WHEN sm.type IN ('exit', 'sale', 'return', 'transfer_out') THEN -ABS(sm.quantity)
              ELSE 0
            END
          ), 0)
          FROM stock_movement sm
          WHERE sm.product_id = p.id 
            AND sm.tenant_id = p.tenant_id
            AND sm.branch_id = ${branchIdValue}
        ) as stock_quantity`;
      }
    }

    // Construir subconsultas de total_entries y total_exits
    const entriesBranchFilter = !showTotalStock && hasMovementBranchId && branchIdValue 
      ? `AND sm.branch_id = ${branchIdValue}` 
      : '';
    const exitsBranchFilter = !showTotalStock && hasMovementBranchId && branchIdValue 
      ? `AND sm.branch_id = ${branchIdValue}` 
      : '';

    // Cuando se muestra stock total, agrupar por producto para evitar duplicados
    if (showTotalStock && hasBranchId) {
      // Calcular stock total desde product_stock si existe, sino desde movimientos o stock_quantity
      const totalStockCalculation = hasProductStock ? `(
        SELECT COALESCE(SUM(ps.quantity), 0)
        FROM product_stock ps
        WHERE ps.product_id = p.id AND ps.tenant_id = p.tenant_id
      )` : hasMovementBranchId ? `(
        SELECT COALESCE(SUM(
          CASE 
            WHEN sm.type IN ('entry', 'adjustment') THEN sm.quantity
            WHEN sm.type IN ('exit', 'sale', 'return') THEN -ABS(sm.quantity)
            ELSE 0
          END
        ), 0)
        FROM stock_movement sm
        WHERE sm.product_id = p.id AND sm.tenant_id = p.tenant_id
      )` : 'COALESCE(p.stock_quantity, 0)';
      
      // Agrupar por producto (código o nombre) para evitar duplicados en stock total
      // Usamos una vista derivada con JOINs para calcular el stock de forma compatible con only_full_group_by
      const productGroupKey = `COALESCE(NULLIF(p.code, ''), p.name)`;
      const productGroupKeyAlias = `product_key`;
      
      // Primero agrupamos productos, luego calculamos el stock usando JOINs en lugar de subconsultas correlacionadas
      let query = `
        SELECT 
          grouped.id,
          grouped.code,
          grouped.name,
          grouped.description,
          grouped.brand,
          grouped.price,
          grouped.cost,
          grouped.min_stock,
          grouped.max_stock,
          grouped.unit,
          grouped.barcode,
          grouped.sku,
          grouped.image_url,
          grouped.is_active,
          grouped.created_at,
          grouped.updated_at,
          grouped.category,
          grouped.category_name,
          grouped.branch_name,
          grouped.branch_ids,
          COALESCE(stock_summary.stock_quantity, 0) as stock_quantity,
          COALESCE(stock_summary.total_entries, 0) as total_entries,
          COALESCE(stock_summary.total_exits, 0) as total_exits
        FROM (
          SELECT 
            MIN(p.id) as id,
            ${productGroupKey} as ${productGroupKeyAlias},
            ANY_VALUE(COALESCE(NULLIF(p.code, ''), p.name)) as code,
            MAX(p.name) as name,
            MAX(p.description) as description,
            MAX(p.brand) as brand,
            MAX(p.price) as price,
            MAX(p.cost) as cost,
            MAX(p.min_stock) as min_stock,
            MAX(p.max_stock) as max_stock,
            MAX(p.unit) as unit,
            MAX(p.barcode) as barcode,
            MAX(p.sku) as sku,
            MAX(p.image_url) as image_url,
            MAX(p.is_active) as is_active,
            MIN(p.created_at) as created_at,
            MAX(p.updated_at) as updated_at,
            MAX(p.category) as category,
            MAX(pc.name) as category_name,
            GROUP_CONCAT(DISTINCT COALESCE(tb.name, "Sin asignar") SEPARATOR ', ') as branch_name,
            GROUP_CONCAT(DISTINCT p.branch_id) as branch_ids
          FROM product p
          LEFT JOIN product_category pc ON p.category = pc.id AND pc.tenant_id = p.tenant_id
          ${hasBranchId ? 'LEFT JOIN tenant_branch tb ON tb.id = p.branch_id AND tb.tenant_id = p.tenant_id' : ''}
          WHERE p.tenant_id = ?
          ${active_only === 'true' ? ' AND p.is_active = 1' : ''}
          ${search ? ` AND (p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ?)` : ''}
          ${category ? ' AND p.category = ?' : ''}
          GROUP BY ${productGroupKey}
        ) as grouped
        LEFT JOIN (
          SELECT 
            p2.product_key,
            ${hasProductStock ? `
            COALESCE(
              (SELECT SUM(ps.quantity)
               FROM product_stock ps
               INNER JOIN (
                 SELECT id FROM product 
                 WHERE tenant_id = ? 
                   AND COALESCE(NULLIF(code, ''), name) = p2.product_key
               ) p3 ON ps.product_id = p3.id AND ps.tenant_id = ?
              ),
              ${hasMovementBranchId ? `
              (SELECT SUM(
                CASE 
                  WHEN sm.type IN ('entry', 'adjustment') THEN sm.quantity
                  WHEN sm.type IN ('exit', 'sale', 'return') THEN -ABS(sm.quantity)
                  ELSE 0
                END
              )
              FROM stock_movement sm
              INNER JOIN (
                SELECT id FROM product 
                WHERE tenant_id = ? 
                  AND COALESCE(NULLIF(code, ''), name) = p2.product_key
              ) p3 ON sm.product_id = p3.id AND sm.tenant_id = ?
              )` : '0'}
            )` : hasMovementBranchId ? `
            (SELECT SUM(
              CASE 
                WHEN sm.type IN ('entry', 'adjustment') THEN sm.quantity
                WHEN sm.type IN ('exit', 'sale', 'return') THEN -ABS(sm.quantity)
                ELSE 0
              END
            )
            FROM stock_movement sm
            INNER JOIN (
              SELECT id FROM product 
              WHERE tenant_id = ? 
                AND COALESCE(NULLIF(code, ''), name) = p2.product_key
            ) p3 ON sm.product_id = p3.id AND sm.tenant_id = ?
            )` : '0'} as stock_quantity,
            COALESCE(
              (SELECT SUM(sm.quantity)
              FROM stock_movement sm
              INNER JOIN (
                SELECT id FROM product 
                WHERE tenant_id = ? 
                  AND COALESCE(NULLIF(code, ''), name) = p2.product_key
              ) p3 ON sm.product_id = p3.id AND sm.tenant_id = ?
              WHERE sm.type IN ('entry', 'adjustment')
              ), 0
            ) as total_entries,
            COALESCE(
              (SELECT SUM(ABS(sm.quantity))
              FROM stock_movement sm
              INNER JOIN (
                SELECT id FROM product 
                WHERE tenant_id = ? 
                  AND COALESCE(NULLIF(code, ''), name) = p2.product_key
              ) p3 ON sm.product_id = p3.id AND sm.tenant_id = ?
              WHERE sm.type IN ('exit', 'sale')
              ), 0
            ) as total_exits
          FROM (
            SELECT DISTINCT
              COALESCE(NULLIF(p2.code, ''), p2.name) as product_key
            FROM product p2
            WHERE p2.tenant_id = ?
          ) as p2
          GROUP BY p2.product_key
        ) as stock_summary ON stock_summary.product_key = grouped.${productGroupKeyAlias}
        WHERE 1=1
        ${min_stock === 'true' ? ` AND COALESCE(stock_summary.stock_quantity, 0) <= grouped.min_stock AND grouped.min_stock > 0` : ''}
        ORDER BY grouped.name
      `;
      
      const params = [tenantId];
      if (search) {
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }
      if (category) {
        params.push(category);
      }
      // Parámetros para stock_summary
      if (hasProductStock) {
        // Para stock_quantity con product_stock: 2 tenantId
        params.push(tenantId, tenantId);
        if (hasMovementBranchId) {
          // Para el fallback de stock_movement: 2 tenantId
          params.push(tenantId, tenantId);
        }
      } else if (hasMovementBranchId) {
        // Para stock_quantity solo con stock_movement: 2 tenantId
        params.push(tenantId, tenantId);
      }
      // Para total_entries: 2 tenantId
      params.push(tenantId, tenantId);
      // Para total_exits: 2 tenantId
      params.push(tenantId, tenantId);
      // Para la subconsulta principal de p2
      params.push(tenantId);

      const [rows] = await pool.query(query, params);
      
      // Log para debugging
      console.log(`[GET /stock/products] Modo stock total - Productos agrupados:`, rows.length);
      
      res.json({ 
        ok: true, 
        data: rows,
        meta: {
          stock_mode: 'total',
          showing_total: true,
          filter_mode: effectiveFilter.mode,
          grouped: true
        }
      });
      return;
    }

    // Consulta normal cuando NO se muestra stock total (o no hay branch_id)
    // Si existe product_stock y estamos filtrando por sucursal, hacer JOIN con product_stock
    let branchJoinCondition = '';
    let branchNameSelect = hasBranchId ? 'COALESCE(tb.name, "Sin asignar") as branch_name,' : '"Sin asignar" as branch_name,';
    let branchIdSelect = hasBranchId ? 'p.branch_id,' : 'NULL as branch_id,';
    
    if (useProductStockFilter && effectiveFilter.mode === "single" && branchIdValue) {
      // Si existe product_stock y tiene datos, usar product_stock para JOIN y branch_name
      // Usar INNER JOIN para filtrar solo productos que tienen stock en esa sucursal
      branchJoinCondition = `
        INNER JOIN product_stock ps ON ps.product_id = p.id AND ps.branch_id = ? AND ps.tenant_id = p.tenant_id
        LEFT JOIN tenant_branch tb ON tb.id = ps.branch_id AND tb.tenant_id = p.tenant_id
      `;
      branchNameSelect = 'COALESCE(tb.name, "Sin asignar") as branch_name,';
      branchIdSelect = 'ps.branch_id,';
      // Cuando se filtra por sucursal específica, mostrar available_quantity en lugar de quantity
      stockCalculation = `COALESCE(ps.available_quantity, ps.quantity - COALESCE(ps.reserved_quantity, 0), 0) as stock_quantity`;
    } else if (hasBranchId && hasMovementBranchId && effectiveFilter.mode === "single" && branchIdValue) {
      // Incluir productos que tienen el branch_id correcto O que tienen movimientos en esa sucursal
      branchJoinCondition = `
        LEFT JOIN (
          SELECT DISTINCT product_id 
          FROM stock_movement 
          WHERE tenant_id = ? AND branch_id = ?
        ) sm_check ON sm_check.product_id = p.id
      `;
      branchJoinCondition += `\n      ${hasBranchId ? 'LEFT JOIN tenant_branch tb ON tb.id = p.branch_id AND tb.tenant_id = p.tenant_id' : ''}`;
    } else {
      // Sin filtro de sucursal, JOIN normal
      branchJoinCondition = hasBranchId ? 'LEFT JOIN tenant_branch tb ON tb.id = p.branch_id AND tb.tenant_id = p.tenant_id' : '';
    }
    
    let query = `
      SELECT DISTINCT p.*, 
             pc.name as category_name,
             ${branchNameSelect}
             ${branchIdSelect}
             ${stockCalculation},
             (SELECT COALESCE(SUM(sm.quantity), 0)
              FROM stock_movement sm 
              WHERE sm.product_id = p.id 
              AND sm.type IN ('entry', 'adjustment')
              ${entriesBranchFilter}) as total_entries,
             (SELECT COALESCE(SUM(ABS(sm.quantity)), 0)
              FROM stock_movement sm 
              WHERE sm.product_id = p.id 
              AND sm.type IN ('exit', 'sale')
              ${exitsBranchFilter}) as total_exits
      FROM product p
      LEFT JOIN product_category pc ON p.category = pc.id AND pc.tenant_id = p.tenant_id
      ${branchJoinCondition}
      WHERE p.tenant_id = ?
        ${useProductStockFilter && effectiveFilter.mode === "single" && branchIdValue 
          ? ''  // El filtro ya está en el INNER JOIN
          : branchClause.clause}
        ${hasBranchId && hasMovementBranchId && effectiveFilter.mode === "single" && branchIdValue && !hasProductStock
          ? `AND (p.branch_id = ? OR sm_check.product_id IS NOT NULL)` 
          : ''}
    `;
    
    // Construir parámetros: primero los del JOIN si existe, luego tenantId, luego branchClause, luego el branchId final si aplica
    const params = [];
    if (useProductStockFilter && effectiveFilter.mode === "single" && branchIdValue) {
      // Si usamos product_stock, el branchId va en el INNER JOIN
      params.push(branchIdValue); // Para el INNER JOIN product_stock
      params.push(tenantId); // Para WHERE p.tenant_id
    } else {
      if (hasBranchId && hasMovementBranchId && effectiveFilter.mode === "single" && branchIdValue) {
        params.push(tenantId, branchIdValue); // Para el LEFT JOIN sm_check
      }
      params.push(tenantId, ...branchClause.params); // Para WHERE p.tenant_id y branchClause
      if (hasBranchId && hasMovementBranchId && effectiveFilter.mode === "single" && branchIdValue && !hasProductStock) {
        params.push(branchIdValue); // Para la condición final AND (p.branch_id = ? OR ...)
      }
    }

    if (active_only === 'true') {
      query += " AND p.is_active = 1";
    }

    if (search) {
      query += " AND (p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ?)";
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (category) {
      query += " AND p.category = ?";
      params.push(category);
    }

    if (min_stock === 'true') {
      // Filtrar por stock bajo: usar product_stock si existe, sino usar p.stock_quantity
      if (useProductStockFilter && effectiveFilter.mode === "single" && branchIdValue) {
        // Si estamos filtrando por sucursal y usando product_stock, comparar con ps.quantity
        query += " AND ps.quantity <= p.min_stock AND p.min_stock > 0";
      } else if (hasProductStock) {
        // Si existe product_stock pero no estamos filtrando por sucursal, sumar todas las sucursales
        query += ` AND (
          SELECT COALESCE(SUM(ps2.quantity), 0)
          FROM product_stock ps2
          WHERE ps2.product_id = p.id AND ps2.tenant_id = p.tenant_id
        ) <= p.min_stock AND p.min_stock > 0`;
      } else {
        // Fallback: usar product.stock_quantity si existe
        const hasStockQuantityColumn = await checkColumnExists('product', 'stock_quantity');
        if (hasStockQuantityColumn) {
          query += " AND p.stock_quantity <= p.min_stock AND p.min_stock > 0";
        }
      }
    }

    query += " ORDER BY p.name";

    const [rows] = await pool.query(query, params);
    
    // Log para debugging - verificar branch_name y filtros
    console.log(`[GET /stock/products] Filtro efectivo:`, JSON.stringify(effectiveFilter));
    console.log(`[GET /stock/products] useProductStockFilter:`, useProductStockFilter);
    console.log(`[GET /stock/products] hasProductStock:`, hasProductStock);
    console.log(`[GET /stock/products] Branch clause:`, branchClause);
    console.log(`[GET /stock/products] branchJoinCondition:`, branchJoinCondition.substring(0, 200));
    console.log(`[GET /stock/products] Show total stock:`, showTotalStock);
    console.log(`[GET /stock/products] Productos encontrados:`, rows.length);
    if (rows.length > 0) {
      console.log(`[GET /stock/products] Primer producto - branch_id: ${rows[0].branch_id}, branch_name: ${rows[0].branch_name}, stock: ${rows[0].stock_quantity}`);
    } else if (rows.length === 0) {
      console.log(`[GET /stock/products] No se encontraron productos. Query:`, query.substring(0, 300));
      console.log(`[GET /stock/products] Params:`, params);
    }

    res.json({ 
      ok: true, 
      data: rows,
      meta: {
        stock_mode: showTotalStock ? 'total' : 'branch',
        showing_total: showTotalStock,
        filter_mode: effectiveFilter.mode,
        branch_clause: branchClause.clause
      }
    });
  } catch (error) {
    console.error("[GET /api/stock/products] Error:", error);
    handleStockError(res, error, "No se pudieron obtener los productos");
  }
});

// GET /api/stock/products/:id - Obtener un producto
router.get("/products/:id", requireAuth, identifyTenant, checkStockPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { id } = req.params;
    const filter = resolveBranchFilter(req, { allowAll: true });

    // Verificar si branch_id existe
    const hasBranchId = await checkColumnExists('product', 'branch_id');
    
    const [[product]] = await pool.query(
      `SELECT p.*, 
              pc.name as category_name, 
              ${hasBranchId ? 'COALESCE(tb.name, "Sin asignar") as branch_name' : '"Sin asignar" as branch_name'}
       FROM product p
       LEFT JOIN product_category pc ON p.category = pc.id AND pc.tenant_id = p.tenant_id
       ${hasBranchId ? 'LEFT JOIN tenant_branch tb ON tb.id = p.branch_id AND tb.tenant_id = p.tenant_id' : ''}
       WHERE p.id = ? AND p.tenant_id = ?`,
      [id, tenantId]
    );

    if (!product) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado" });
    }

    if (!(await assertProductVisibility(product, filter, hasBranchId, tenantId))) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado" });
    }

    // Obtener historial de movimientos
    const hasMovementBranchId = await checkColumnExists('stock_movement', 'branch_id');
    const movementClause = hasMovementBranchId ? buildBranchWhere("sm", filter) : { clause: "", params: [] };
    const [movements] = await pool.query(
      `SELECT sm.*, u.email as created_by_email
       FROM stock_movement sm
       LEFT JOIN users u ON sm.created_by = u.id
       WHERE sm.product_id = ?
         ${movementClause.clause}
       ORDER BY sm.created_at DESC
       LIMIT 50`,
      [id, ...movementClause.params]
    );

    res.json({ 
      ok: true, 
      data: {
        ...product,
        movements
      }
    });
  } catch (error) {
    console.error("[GET /api/stock/products/:id] Error:", error);
    handleStockError(res, error, "No se pudo obtener el producto");
  }
});

// POST /api/stock/products - Crear producto
router.post("/products", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const {
      code, name, description, category, brand, price, cost,
      stock_quantity, min_stock, max_stock, unit, barcode, sku, image_url, branchId
    } = req.body;

    if (!name || !price) {
      return res.status(400).json({ ok: false, error: "Nombre y precio son requeridos" });
    }

    const branch = await resolveBranchForWrite(req, { branchId });
    
    // Verificar si branch_id existe en product
    const hasBranchId = await checkColumnExists('product', 'branch_id');

    const branchField = hasBranchId ? 'branch_id,' : '';
    const branchValue = hasBranchId ? branch.id : null;
    const branchPlaceholder = hasBranchId ? '?,' : '';

    // Verificar si stock_quantity existe en product (compatibilidad con migraciones antiguas)
    const hasStockQuantityColumn = await checkColumnExists('product', 'stock_quantity');
    const stockQuantityField = hasStockQuantityColumn ? 'stock_quantity,' : '';
    const stockQuantityPlaceholder = hasStockQuantityColumn ? '?,' : '';
    const stockQuantityValue = hasStockQuantityColumn ? [stock_quantity || 0] : [];

    const [result] = await pool.query(
      `INSERT INTO product (
        tenant_id, ${branchField} code, name, description, category, brand, price, cost,
        ${stockQuantityField} min_stock, max_stock, unit, barcode, sku, image_url
      ) VALUES (?, ${branchPlaceholder} ?, ?, ?, ?, ?, ?, ?, ${stockQuantityPlaceholder} ?, ?, ?, ?, ?, ?)`,
      [
        tenantId, 
        ...(hasBranchId ? [branchValue] : []),
        code || null, name, description || null, category || null,
        brand || null, price, cost || null,
        ...stockQuantityValue,
        min_stock || 0, max_stock || 0, unit || 'unidad',
        barcode || null, sku || null, image_url || null
      ]
    );

    const productId = result.insertId;

    // Crear registro en product_stock si la tabla existe
    const hasProductStock = await checkColumnExists('product_stock', 'product_id');
    if (hasProductStock) {
      try {
        // Si el producto no tiene branch_id asignado (o branch.id es null), crear en todas las sucursales activas
        // Si tiene branch_id, crear solo en esa sucursal
        if (!hasBranchId || !branchValue) {
          // Crear en todas las sucursales activas
          await pool.query(
            `INSERT INTO product_stock (tenant_id, product_id, branch_id, quantity, min_stock, max_stock)
             SELECT ?, ?, tb.id, 
                    CASE WHEN tb.is_primary = 1 THEN ? ELSE 0 END,
                    ?, ?
             FROM tenant_branch tb
             WHERE tb.tenant_id = ? AND tb.is_active = 1
             ON DUPLICATE KEY UPDATE 
               quantity = VALUES(quantity),
               min_stock = VALUES(min_stock),
               max_stock = VALUES(max_stock)`,
            [
              tenantId,
              productId,
              stock_quantity || 0,
              min_stock || 0,
              max_stock || 0,
              tenantId
            ]
          );
        } else {
          // Crear solo en la sucursal específica
          await pool.query(
            `INSERT INTO product_stock (tenant_id, product_id, branch_id, quantity, min_stock, max_stock)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
               quantity = VALUES(quantity),
               min_stock = VALUES(min_stock),
               max_stock = VALUES(max_stock)`,
            [
              tenantId,
              productId,
              branch.id,
              stock_quantity || 0,
              min_stock || 0,
              max_stock || 0
            ]
          );
        }
      } catch (error) {
        console.error("[POST /api/stock/products] Error al crear product_stock:", error);
        // No fallar si product_stock no está disponible todavía
      }
    }

    // Si hay stock inicial, crear movimiento
    if (stock_quantity > 0) {
      const hasMovementBranchId = await checkColumnExists('stock_movement', 'branch_id');
      const movementBranchField = hasMovementBranchId ? 'branch_id,' : '';
      const movementBranchValue = hasMovementBranchId ? branch.id : null;
      const movementBranchPlaceholder = hasMovementBranchId ? '?,' : '';
      
      const [movementResult] = await pool.query(
        `INSERT INTO stock_movement (
          tenant_id, ${movementBranchField} product_id, type, quantity, previous_stock, new_stock,
          notes, created_by
        ) VALUES (?, ${movementBranchPlaceholder} ?, 'entry', ?, 0, ?, 'Stock inicial', ?)`,
        [
          tenantId, 
          ...(hasMovementBranchId ? [movementBranchValue] : []),
          productId, stock_quantity, stock_quantity, req.user.id
        ]
      );

      // Crear notificaciones para usuarios con permisos de stock (no bloqueante)
      Promise.resolve().then(async () => {
        try {
          console.log(`[POST /api/stock/products] Iniciando notificación para movimiento ${movementResult.insertId}...`);
          await notifyStockMovement({
            tenantId,
            productId,
            branchId: movementBranchValue || null,
            type: 'entry',
            quantity: stock_quantity,
            previousStock: 0,
            newStock: stock_quantity,
            notes: 'Stock inicial',
            userId: req.user.id,
            movementId: movementResult.insertId
          });
          console.log(`[POST /api/stock/products] ✅ Notificación enviada para movimiento ${movementResult.insertId}`);
        } catch (err) {
          console.error('[POST /api/stock/products] ❌ Error en notificación (no crítico):', err);
        }
      }).catch(err => {
        console.error('[POST /api/stock/products] Error inesperado en promesa de notificación:', err);
      });
    }

    res.status(201).json({ ok: true, data: { id: productId } });
  } catch (error) {
    console.error("[POST /api/stock/products] Error:", error);
    handleStockError(res, error, "No se pudo crear el producto");
  }
});

// PUT /api/stock/products/:id - Actualizar producto
router.put("/products/:id", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { id } = req.params;
    const updates = req.body || {};

    // Verificar que el producto existe y pertenece al tenant
    const hasBranchId = await checkColumnExists('product', 'branch_id');
    const branchSelect = hasBranchId ? 'p.branch_id, COALESCE(tb.name, "Sin asignar") as branch_name' : 'NULL as branch_id, "Sin asignar" as branch_name';
    const branchJoinCheck = hasBranchId ? 'LEFT JOIN tenant_branch tb ON tb.id = p.branch_id AND tb.tenant_id = p.tenant_id' : '';
    
    const [[exists]] = await pool.query(
      `SELECT p.id, ${branchSelect} 
       FROM product p
       ${branchJoinCheck}
       WHERE p.id = ? AND p.tenant_id = ?`,
      [id, tenantId]
    );

    // Solo verificar que el producto existe y pertenece al tenant
    // No usar assertProductVisibility aquí porque para actualizar no debemos restringir por filtro de sucursal
    if (!exists) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado" });
    }
    
    // Log para debugging
    if (hasBranchId) {
      console.log(`[PUT /stock/products/:id] Producto ${id} - branch_id: ${exists.branch_id}, branch_name: ${exists.branch_name}`);
    }

    // Construir query de actualización
    const allowedFields = [
      "code",
      "name",
      "description",
      "category",
      "brand",
      "price",
      "cost",
      "min_stock",
      "max_stock",
      "unit",
      "barcode",
      "sku",
      "image_url",
      "is_active",
    ];

    const fields = [];
    const values = [];
    let stockQuantityChanged = false;
    let previousStock = null;
    let newStockQuantity = null;

    // Manejar actualización de stock_quantity por separado para crear movimiento
    if (updates.stock_quantity !== undefined) {
      newStockQuantity = Number(updates.stock_quantity);
      
      if (!Number.isFinite(newStockQuantity) || newStockQuantity < 0) {
        return res.status(400).json({ ok: false, error: "El stock debe ser un número mayor o igual a 0" });
      }
      
      // Calcular stock actual desde movimientos (no desde el campo stock_quantity)
      const hasMovementBranchId = await checkColumnExists('stock_movement', 'branch_id');
      const hasProductStock = await checkColumnExists('product_stock', 'product_id');
      const hasBranchId = await checkColumnExists('product', 'branch_id');
      let currentStockFromMovements = 0;
      
      if (hasMovementBranchId && exists.branch_id) {
        // Stock por sucursal desde movimientos
        const [[stockResult]] = await pool.query(
          `SELECT COALESCE(SUM(
            CASE 
              WHEN sm.type IN ('entry', 'adjustment', 'transfer_in') THEN sm.quantity
              WHEN sm.type IN ('exit', 'sale', 'return', 'transfer_out') THEN -ABS(sm.quantity)
              ELSE 0
            END
          ), 0) as stock
          FROM stock_movement sm
          WHERE sm.product_id = ? 
            AND sm.tenant_id = ?
            AND sm.branch_id = ?`,
          [id, tenantId, exists.branch_id]
        );
        currentStockFromMovements = stockResult?.stock || 0;
      } else if (hasMovementBranchId) {
        // Stock total desde movimientos (sin transferencias)
        const [[stockResult]] = await pool.query(
          `SELECT COALESCE(SUM(
            CASE 
              WHEN sm.type IN ('entry', 'adjustment') THEN sm.quantity
              WHEN sm.type IN ('exit', 'sale', 'return') THEN -ABS(sm.quantity)
              ELSE 0
            END
          ), 0) as stock
          FROM stock_movement sm
          WHERE sm.product_id = ? 
            AND sm.tenant_id = ?`,
          [id, tenantId]
        );
        currentStockFromMovements = stockResult?.stock || 0;
      } else {
        // Si no hay branch_id en movimientos, intentar usar product_stock o product.stock_quantity
        if (hasProductStock) {
          // Usar product_stock (suma de todas las sucursales)
          const [[stockResult]] = await pool.query(
            `SELECT COALESCE(SUM(ps.quantity), 0) as stock
            FROM product_stock ps
            WHERE ps.product_id = ? AND ps.tenant_id = ?`,
            [id, tenantId]
          );
          currentStockFromMovements = stockResult?.stock || 0;
        } else {
          // Fallback: usar product.stock_quantity si existe
          const hasStockQuantityColumn = await checkColumnExists('product', 'stock_quantity');
          if (hasStockQuantityColumn) {
            const [[currentProduct]] = await pool.query(
              `SELECT stock_quantity FROM product WHERE id = ? AND tenant_id = ?`,
              [id, tenantId]
            );
            currentStockFromMovements = currentProduct?.stock_quantity || 0;
          } else {
            currentStockFromMovements = 0;
          }
        }
      }
      
      previousStock = currentStockFromMovements;
      stockQuantityChanged = previousStock !== newStockQuantity;
      
      // Actualizar product_stock si existe, sino intentar actualizar product.stock_quantity
      
      if (hasProductStock && hasMovementBranchId && hasBranchId) {
        // Actualizar product_stock para todas las sucursales o la sucursal del producto
        const [[productBranch]] = await pool.query(
          `SELECT branch_id FROM product WHERE id = ? AND tenant_id = ?`,
          [id, tenantId]
        );
        const branchIdForStock = productBranch?.branch_id || null;
        
        if (branchIdForStock) {
          // Actualizar solo la sucursal del producto
          await pool.query(
            `INSERT INTO product_stock (tenant_id, product_id, branch_id, quantity)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`,
            [tenantId, id, branchIdForStock, newStockQuantity]
          );
        }
      } else {
        // Fallback: intentar actualizar product.stock_quantity si existe
        const hasStockQuantityColumn = await checkColumnExists('product', 'stock_quantity');
        if (hasStockQuantityColumn) {
          fields.push("stock_quantity = ?");
          values.push(newStockQuantity);
        }
      }
    }

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(updates[field]);
      }
    }

    if (updates.branchId !== undefined) {
      // hasBranchId ya está declarado arriba
      if (hasBranchId) {
        const branch = await resolveBranchForWrite(req, { branchId: updates.branchId });
        fields.push("branch_id = ?");
        values.push(branch.id);
      }
      // Si branch_id no existe, simplemente ignoramos el update
    }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: "No hay campos para actualizar" });
    }

    values.push(id, tenantId);

    await pool.query(
      `UPDATE product SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      values
    );

    // Si el stock cambió, crear un movimiento de ajuste
    if (stockQuantityChanged && previousStock !== null && newStockQuantity !== null) {
      const hasMovementBranchId = await checkColumnExists('stock_movement', 'branch_id');
      const movementBranchField = hasMovementBranchId ? 'branch_id,' : '';
      const movementBranchValue = hasMovementBranchId ? (exists.branch_id || null) : null;
      const movementBranchPlaceholder = hasMovementBranchId ? '?,' : '';
      
      const adjustmentQuantity = newStockQuantity - previousStock;
      
      const [adjustmentResult] = await pool.query(
        `INSERT INTO stock_movement (
          tenant_id, ${movementBranchField} product_id, type, quantity, previous_stock, new_stock,
          notes, created_by
        ) VALUES (?, ${movementBranchPlaceholder} ?, 'adjustment', ?, ?, ?, ?, ?)`,
        [
          tenantId,
          ...(hasMovementBranchId ? [movementBranchValue] : []),
          id,
          adjustmentQuantity,
          previousStock,
          newStockQuantity,
          `Ajuste manual de stock`,
          req.user.id,
        ]
      );

      // Crear notificaciones para usuarios con permisos de stock (no bloqueante)
      Promise.resolve().then(async () => {
        try {
          console.log(`[PUT /api/stock/products/:id] Iniciando notificación para movimiento ${adjustmentResult.insertId}...`);
          await notifyStockMovement({
            tenantId,
            productId: id,
            branchId: movementBranchValue || null,
            type: 'adjustment',
            quantity: adjustmentQuantity,
            previousStock,
            newStock: newStockQuantity,
            notes: 'Ajuste manual de stock',
            userId: req.user.id,
            movementId: adjustmentResult.insertId
          });
          console.log(`[PUT /api/stock/products/:id] ✅ Notificación enviada para movimiento ${adjustmentResult.insertId}`);
        } catch (err) {
          console.error('[PUT /api/stock/products/:id] ❌ Error en notificación (no crítico):', err);
        }
      }).catch(err => {
        console.error('[PUT /api/stock/products/:id] Error inesperado en promesa de notificación:', err);
      });
    }

    // Devolver el producto actualizado con información de sucursal
    // hasBranchId ya está declarado arriba, reutilizamos la variable
    const branchSelectForResponse = hasBranchId ? 'tb.name as branch_name, p.branch_id' : '"Sin asignar" as branch_name, NULL as branch_id';
    const branchJoin = hasBranchId ? 'LEFT JOIN tenant_branch tb ON tb.id = p.branch_id AND tb.tenant_id = p.tenant_id' : '';
    
    const [[updatedProduct]] = await pool.query(
      `SELECT p.*, 
              pc.name as category_name,
              ${branchSelectForResponse}
       FROM product p
       LEFT JOIN product_category pc ON p.category = pc.id AND pc.tenant_id = p.tenant_id
       ${branchJoin}
       WHERE p.id = ? AND p.tenant_id = ?`,
      [id, tenantId]
    );

    res.json({ 
      ok: true, 
      message: "Producto actualizado",
      data: updatedProduct 
    });
  } catch (error) {
    console.error("[PUT /api/stock/products/:id] Error:", error);
    handleStockError(res, error, "No se pudo actualizar el producto");
  }
});

// DELETE /api/stock/products/:id - Eliminar producto
router.delete("/products/:id", requireAuth, identifyTenant, checkStockPermission('delete'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { id } = req.params;
    const filter = resolveBranchFilter(req, { allowAll: true });

    const hasBranchId = await checkColumnExists('product', 'branch_id');
    const branchSelect = hasBranchId ? 'branch_id' : 'NULL as branch_id';
    
    const [[product]] = await pool.query(
      `SELECT id, ${branchSelect} FROM product WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (!(await assertProductVisibility(product, filter, hasBranchId, tenantId))) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado" });
    }

    const [result] = await pool.query(
      `DELETE FROM product WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado" });
    }

    res.json({ ok: true, message: "Producto eliminado" });
  } catch (error) {
    console.error("[DELETE /api/stock/products/:id] Error:", error);
    handleStockError(res, error, "No se pudo eliminar el producto");
  }
});

// POST /api/stock/movements - Crear movimiento de stock
router.post("/movements", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const {
      product_id, type, quantity, reference_type, reference_id, notes
    } = req.body;
    const filter = resolveBranchFilter(req, { allowAll: true });

    if (!product_id || !type || !quantity) {
      return res.status(400).json({ 
        ok: false, 
        error: "product_id, type y quantity son requeridos" 
      });
    }

    // Obtener stock actual
    const hasBranchId = await checkColumnExists('product', 'branch_id');
    const branchSelect = hasBranchId ? 'branch_id' : 'NULL as branch_id';
    
    const [[product]] = await pool.query(
      `SELECT ${branchSelect} FROM product WHERE id = ? AND tenant_id = ?`,
      [product_id, tenantId]
    );

    if (!(await assertProductVisibility(product, filter, hasBranchId, tenantId))) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado" });
    }

    // Obtener stock actual desde product_stock o stock_movement
    const hasProductStock = await checkColumnExists('product_stock', 'product_id');
    const hasMovementBranchId = await checkColumnExists('stock_movement', 'branch_id');
    let previousStock = 0;

    if (hasProductStock && hasMovementBranchId && branchIdValue) {
      // Si existe product_stock y hay branch_id en movimientos, usar product_stock
      const [[stockResult]] = await pool.query(
        `SELECT COALESCE(ps.quantity, 0) as stock
        FROM product_stock ps
        WHERE ps.product_id = ? 
          AND ps.tenant_id = ?
          AND ps.branch_id = ?`,
        [product_id, tenantId, branchIdValue]
      );
      previousStock = stockResult?.stock || 0;
    } else if (hasMovementBranchId && branchIdValue) {
      // Usar stock_movement si existe branch_id
      const [[stockResult]] = await pool.query(
        `SELECT COALESCE(SUM(
          CASE 
            WHEN sm.type IN ('entry', 'adjustment', 'transfer_in') THEN sm.quantity
            WHEN sm.type IN ('exit', 'sale', 'return', 'transfer_out') THEN -ABS(sm.quantity)
            ELSE 0
          END
        ), 0) as stock
        FROM stock_movement sm
        WHERE sm.product_id = ? 
          AND sm.tenant_id = ?
          AND sm.branch_id = ?`,
        [product_id, tenantId, branchIdValue]
      );
      previousStock = stockResult?.stock || 0;
    }

    let newStock;

    // Calcular nuevo stock según el tipo
    if (type === 'entry' || type === 'adjustment' || type === 'transfer_in') {
      newStock = previousStock + Math.abs(quantity);
    } else if (type === 'exit' || type === 'sale' || type === 'return' || type === 'transfer_out') {
      newStock = previousStock - Math.abs(quantity);
      if (newStock < 0 && type !== 'adjustment') {
        return res.status(400).json({ 
          ok: false, 
          error: "Stock insuficiente" 
        });
      }
    } else {
      return res.status(400).json({ ok: false, error: "Tipo de movimiento inválido" });
    }

    // Crear movimiento
    const movementBranchField = hasMovementBranchId ? 'branch_id,' : '';
    const movementBranchValue = hasMovementBranchId ? (branchIdValue || product.branch_id || null) : null;
    const movementBranchPlaceholder = hasMovementBranchId ? '?,' : '';
    
    const [movementResult] = await pool.query(
      `INSERT INTO stock_movement (
        tenant_id, ${movementBranchField} product_id, type, quantity, previous_stock, new_stock,
        reference_type, reference_id, notes, created_by
      ) VALUES (?, ${movementBranchPlaceholder} ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        ...(hasMovementBranchId ? [movementBranchValue] : []),
        product_id,
        type,
        quantity,
        previousStock,
        newStock,
        reference_type || null,
        reference_id || null,
        notes || null,
        req.user.id,
      ]
    );

    // Actualizar product_stock si existe, sino intentar actualizar product.stock_quantity
    if (hasProductStock && hasMovementBranchId && branchIdValue) {
      // Actualizar product_stock
      await pool.query(
        `INSERT INTO product_stock (tenant_id, product_id, branch_id, quantity)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`,
        [tenantId, product_id, branchIdValue, newStock]
      );
    } else {
      // Fallback: intentar actualizar product.stock_quantity si existe
      const hasStockQuantityColumn = await checkColumnExists('product', 'stock_quantity');
      if (hasStockQuantityColumn) {
        await pool.query(
          `UPDATE product SET stock_quantity = ? WHERE id = ?`,
          [newStock, product_id]
        );
      }
    }

    // Crear notificaciones para usuarios con permisos de stock (no bloqueante)
    Promise.resolve().then(async () => {
      try {
        console.log(`[POST /api/stock/movements] Iniciando notificación para movimiento ${movementResult.insertId}...`);
        await notifyStockMovement({
          tenantId,
          productId: product_id,
          branchId: branchIdValue || null,
          type,
          quantity,
          previousStock,
          newStock,
          notes: notes || null,
          userId: req.user.id,
          movementId: movementResult.insertId
        });
        console.log(`[POST /api/stock/movements] ✅ Notificación enviada para movimiento ${movementResult.insertId}`);
      } catch (err) {
        console.error('[POST /api/stock/movements] ❌ Error en notificación (no crítico):', err);
      }
    }).catch(err => {
      console.error('[POST /api/stock/movements] Error inesperado en promesa de notificación:', err);
    });

    res.status(201).json({ 
      ok: true, 
      data: { 
        id: movementResult.insertId,
        previous_stock: previousStock,
        new_stock: newStock
      }
    });
  } catch (error) {
    console.error("[POST /api/stock/movements] Error:", error);
    handleStockError(res, error, "No se pudo registrar el movimiento");
  }
});

// NOTA: Las transferencias se manejan en stockTransfers.js
// Esta ruta fue eliminada para evitar conflictos con /api/stock/transfers

// GET /api/stock/products/:id/stock/:branchId - Obtener stock disponible de un producto en una sucursal específica
router.get("/products/:id/stock/:branchId", requireAuth, identifyTenant, checkStockPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const productId = Number(req.params.id);
    const branchId = Number(req.params.branchId);

    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ ok: false, error: "ID de producto inválido" });
    }

    if (!Number.isFinite(branchId) || branchId <= 0) {
      return res.status(400).json({ ok: false, error: "ID de sucursal inválido" });
    }

    // Verificar que el producto existe
    const [[product]] = await pool.query(
      `SELECT id FROM product WHERE id = ? AND tenant_id = ?`,
      [productId, tenantId]
    );

    if (!product) {
      return res.status(404).json({ ok: false, error: "Producto no encontrado" });
    }

    // Verificar que la sucursal existe y pertenece al tenant
    const branch = await ensureBranchBelongsToTenant(tenantId, branchId);
    if (!branch) {
      return res.status(404).json({ ok: false, error: "Sucursal no encontrada" });
    }
    if (!branch.is_active) {
      return res.status(400).json({ ok: false, error: "La sucursal está inactiva" });
    }
    // Verificar que el usuario tiene acceso a esta sucursal
    ensureUserCanAccessBranch(req.user, branchId);

    // Calcular stock disponible en la sucursal
    // Prioridad: product_stock > stock_movement > product.stock_quantity
    const hasProductStock = await checkColumnExists('product_stock', 'product_id');
    let availableStock = 0;

    if (hasProductStock) {
      // Usar product_stock que ya tiene available_quantity calculado
      const [[stockResult]] = await pool.query(
        `SELECT 
          COALESCE(ps.quantity, 0) as stock,
          COALESCE(ps.available_quantity, ps.quantity, 0) as available_stock,
          COALESCE(ps.reserved_quantity, 0) as reserved
        FROM product_stock ps
        WHERE ps.product_id = ? 
          AND ps.tenant_id = ?
          AND ps.branch_id = ?`,
        [productId, tenantId, branchId]
      );
      // Si existe available_quantity, usarlo (ya descuenta reservas)
      // Si no, usar quantity - reserved
      if (stockResult) {
        availableStock = stockResult.available_stock ?? (stockResult.stock - (stockResult.reserved || 0));
      } else {
        // Si no existe registro en product_stock, el stock es 0
        availableStock = 0;
      }
    } else {
      // Fallback: usar stock_movement o product.stock_quantity
      const hasMovementBranchId = await checkColumnExists('stock_movement', 'branch_id');
      if (hasMovementBranchId) {
        const [[stockResult]] = await pool.query(
          `SELECT COALESCE(SUM(
            CASE 
              WHEN sm.type IN ('entry', 'adjustment', 'transfer_in') THEN sm.quantity
              WHEN sm.type IN ('exit', 'sale', 'return', 'transfer_out') THEN -ABS(sm.quantity)
              ELSE 0
            END
          ), 0) as stock
          FROM stock_movement sm
          WHERE sm.product_id = ? 
            AND sm.tenant_id = ?
            AND sm.branch_id = ?`,
          [productId, tenantId, branchId]
        );
        availableStock = stockResult?.stock || 0;
        
        // Descontar reservas si existen
        const hasStockReservation = await checkColumnExists('stock_reservation', 'product_id');
        if (hasStockReservation) {
          const [[reservedResult]] = await pool.query(
            `SELECT COALESCE(SUM(quantity), 0) as reserved
            FROM stock_reservation
            WHERE product_id = ?
              AND tenant_id = ?
              AND branch_id = ?
              AND status IN ('pending', 'confirmed')`,
            [productId, tenantId, branchId]
          );
          const reserved = reservedResult?.reserved || 0;
          availableStock = Math.max(0, availableStock - reserved);
        }
      } else {
        // Si no hay branch_id en stock_movement, usar el stock del producto
        const hasStockQuantityColumn = await checkColumnExists('product', 'stock_quantity');
        if (hasStockQuantityColumn) {
          const [[productRow]] = await pool.query(
            `SELECT stock_quantity FROM product WHERE id = ? AND tenant_id = ?`,
            [productId, tenantId]
          );
          availableStock = productRow?.stock_quantity || 0;
        } else {
          availableStock = 0;
        }
      }
    }

    res.json({
      ok: true,
      data: {
        product_id: productId,
        branch_id: branchId,
        branch_name: branch.name,
        available_stock: availableStock
      }
    });
  } catch (error) {
    console.error("[GET /api/stock/products/:id/stock/:branchId] Error:", error);
    handleStockError(res, error, "No se pudo obtener el stock disponible");
  }
});

// GET /api/stock/movements - Listar movimientos
router.get("/movements", requireAuth, identifyTenant, checkStockPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { product_id, type, limit = 100 } = req.query;
    const filter = resolveBranchFilter(req, { allowAll: true });
    
    // Verificar si branch_id existe en stock_movement
    const hasMovementBranchId = await checkColumnExists('stock_movement', 'branch_id');
    const branchClause = hasMovementBranchId ? buildBranchWhere("sm", filter) : { clause: "", params: [] };

    // Agregar información de sucursales si existe branch_id
    const branchSelect = hasMovementBranchId 
      ? 'tb.name as branch_name, sm.branch_id,'
      : 'NULL as branch_name, NULL as branch_id,';
    const branchJoin = hasMovementBranchId
      ? 'LEFT JOIN tenant_branch tb ON tb.id = sm.branch_id AND tb.tenant_id = sm.tenant_id'
      : '';

    let query = `
      SELECT sm.*, p.name as product_name, p.code as product_code,
             ${branchSelect}
             u.email as created_by_email
      FROM stock_movement sm
      JOIN product p ON sm.product_id = p.id
      LEFT JOIN users u ON sm.created_by = u.id
      ${branchJoin}
      WHERE sm.tenant_id = ?
        ${branchClause.clause}
    `;
    const params = [tenantId, ...branchClause.params];

    if (product_id) {
      query += " AND sm.product_id = ?";
      params.push(product_id);
    }

    if (type) {
      query += " AND sm.type = ?";
      params.push(type);
    }

    query += " ORDER BY sm.created_at DESC LIMIT ?";
    params.push(Number(limit));

    const [rows] = await pool.query(query, params);
    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[GET /api/stock/movements] Error:", error);
    handleStockError(res, error, "No se pudieron obtener los movimientos");
  }
});

// GET /api/stock/categories - Listar categorías
router.get("/categories", requireAuth, identifyTenant, checkStockPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const [rows] = await pool.query(
      `SELECT * FROM product_category 
       WHERE tenant_id = ? AND is_active = 1 
       ORDER BY name`,
      [tenantId]
    );
    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[GET /api/stock/categories] Error:", error);
    handleStockError(res, error, "No se pudieron obtener las categorías");
  }
});

// POST /api/stock/categories - Crear categoría
router.post("/categories", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { name, description, parent_id } = req.body;

    if (!name) {
      return res.status(400).json({ ok: false, error: "Nombre es requerido" });
    }

    const [result] = await pool.query(
      `INSERT INTO product_category (tenant_id, name, description, parent_id)
       VALUES (?, ?, ?, ?)`,
      [tenantId, name, description || null, parent_id || null]
    );

    res.status(201).json({ ok: true, data: { id: result.insertId } });
  } catch (error) {
    console.error("[POST /api/stock/categories] Error:", error);
    handleStockError(res, error, "No se pudo crear la categoría");
  }
});

// PUT /api/stock/categories/:id - Actualizar categoría
router.put("/categories/:id", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { id } = req.params;
    const { name, description, parent_id, is_active } = req.body;

    const fields = [];
    const values = [];

    if (name !== undefined) {
      if (!name) {
        return res.status(400).json({ ok: false, error: "Nombre no puede estar vacío" });
      }
      fields.push("name = ?");
      values.push(name);
    }

    if (description !== undefined) {
      fields.push("description = ?");
      values.push(description || null);
    }

    if (parent_id !== undefined) {
      fields.push("parent_id = ?");
      values.push(parent_id || null);
    }

    if (is_active !== undefined) {
      fields.push("is_active = ?");
      values.push(is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: "No hay campos para actualizar" });
    }

    values.push(id, tenantId);

    const [result] = await pool.query(
      `UPDATE product_category SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Categoría no encontrada" });
    }

    res.json({ ok: true, message: "Categoría actualizada" });
  } catch (error) {
    console.error("[PUT /api/stock/categories/:id] Error:", error);
    handleStockError(res, error, "No se pudo actualizar la categoría");
  }
});

// DELETE /api/stock/categories/:id - Desactivar categoría
router.delete("/categories/:id", requireAuth, identifyTenant, checkStockPermission('delete'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { id } = req.params;

    const [result] = await pool.query(
      `UPDATE product_category SET is_active = 0 WHERE id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Categoría no encontrada" });
    }

    res.json({ ok: true, message: "Categoría eliminada" });
  } catch (error) {
    console.error("[DELETE /api/stock/categories/:id] Error:", error);
    handleStockError(res, error, "No se pudo eliminar la categoría");
  }
});

// GET /api/stock/low-stock - Productos con stock bajo
router.get("/low-stock", requireAuth, identifyTenant, checkStockPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const filter = resolveBranchFilter(req, { allowAll: true });
    
    // Verificar si branch_id existe
    const hasBranchId = await checkColumnExists('product', 'branch_id');
    const hasProductStock = await checkColumnExists('product_stock', 'product_id');
    const branchClause = hasBranchId ? buildBranchWhere("p", filter) : { clause: "", params: [] };
    
    // Usar product_stock si existe para calcular stock bajo
    let stockCondition = '';
    let orderByStock = '';
    
    if (hasProductStock) {
      if (filter?.mode === "single" && filter?.branchId) {
        // Si estamos filtrando por sucursal, usar product_stock de esa sucursal
        stockCondition = `AND EXISTS (
          SELECT 1 FROM product_stock ps 
          WHERE ps.product_id = p.id 
            AND ps.tenant_id = p.tenant_id
            AND ps.branch_id = ?
            AND ps.quantity <= p.min_stock
        )`;
        orderByStock = `(SELECT COALESCE(ps.quantity, 0) FROM product_stock ps WHERE ps.product_id = p.id AND ps.tenant_id = p.tenant_id AND ps.branch_id = ? LIMIT 1) - p.min_stock`;
      } else {
        // Si no estamos filtrando por sucursal, sumar todas las sucursales
        stockCondition = `AND (
          SELECT COALESCE(SUM(ps.quantity), 0)
          FROM product_stock ps
          WHERE ps.product_id = p.id AND ps.tenant_id = p.tenant_id
        ) <= p.min_stock`;
        orderByStock = `(SELECT COALESCE(SUM(ps.quantity), 0) FROM product_stock ps WHERE ps.product_id = p.id AND ps.tenant_id = p.tenant_id) - p.min_stock`;
      }
    } else {
      // Fallback: usar product.stock_quantity si existe
      const hasStockQuantityColumn = await checkColumnExists('product', 'stock_quantity');
      if (hasStockQuantityColumn) {
        stockCondition = 'AND p.stock_quantity <= p.min_stock';
        orderByStock = 'p.stock_quantity - p.min_stock';
      }
    }
    
    const params = [tenantId];
    if (hasProductStock && filter?.mode === "single" && filter?.branchId) {
      params.push(filter.branchId, filter.branchId); // Para stockCondition y orderByStock
    }
    params.push(...branchClause.params);
    
    const [rows] = await pool.query(
      `SELECT p.*, ${hasBranchId ? 'tb.name AS branch_name' : 'NULL AS branch_name'}
       FROM product p
       ${hasBranchId ? 'LEFT JOIN tenant_branch tb ON tb.id = p.branch_id AND tb.tenant_id = p.tenant_id' : ''}
       WHERE p.tenant_id = ? 
         AND p.is_active = 1
         ${branchClause.clause}
         ${stockCondition}
         AND p.min_stock > 0
       ORDER BY (${orderByStock}) ASC`,
      params
    );
    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[GET /api/stock/low-stock] Error:", error);
    handleStockError(res, error, "No se pudo obtener el stock bajo");
  }
});

export default router;

