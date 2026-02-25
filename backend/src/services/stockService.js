// src/services/stockService.js
// Servicio centralizado para gestión de stock con la nueva estructura

import { pool } from "../db.js";

/**
 * Obtiene usuarios con permisos de stock en un tenant
 */
async function getUsersWithStockPermissions(tenantId, conn = pool) {
  const [users] = await conn.query(
    `SELECT id, email, role, permissions
     FROM users
     WHERE tenant_id = ? AND is_active = 1`,
    [tenantId]
  );

  const usersWithPermissions = users.filter(user => {
    // Admin tiene todos los permisos
    if (user.role === 'admin') {
      return true;
    }

    // Verificar permisos específicos
    let permissions = {};
    if (user.permissions) {
      if (typeof user.permissions === "string") {
        try {
          permissions = JSON.parse(user.permissions);
        } catch {
          return false;
        }
      } else {
        permissions = user.permissions;
      }
    }

    const stockPerms = permissions.stock || [];
    // Usuario tiene permisos de stock si tiene stock.read, stock.write o stock.admin
    return stockPerms.some(perm => 
      perm.startsWith('stock.') || perm === 'stock.admin'
    );
  });

  return usersWithPermissions.map(u => u.id);
}

/**
 * Obtiene el administrador de una sucursal (el único que puede confirmar transferencias)
 */
async function getBranchAdmin(tenantId, branchId, conn = pool) {
  const [[branch]] = await conn.query(
    `SELECT admin_user_id FROM tenant_branch 
     WHERE id = ? AND tenant_id = ? AND is_active = 1`,
    [branchId, tenantId]
  );
  
  if (!branch || !branch.admin_user_id) {
    return null;
  }
  
  // Verificar que el usuario existe y está activo
  const [[user]] = await conn.query(
    `SELECT id FROM users 
     WHERE id = ? AND tenant_id = ? AND is_active = 1`,
    [branch.admin_user_id, tenantId]
  );
  
  return user ? branch.admin_user_id : null;
}

/**
 * Crea notificaciones para usuarios con permisos de stock
 * @public - Exportada para ser usada desde otros lugares que insertan movimientos directamente
 */
export async function notifyStockMovement({
  tenantId,
  productId,
  branchId,
  type,
  quantity,
  previousStock,
  newStock,
  notes,
  userId,
  movementId
}, conn = pool) {
  try {
    // Obtener información del producto y sucursal
    const [[product]] = await conn.query(
      `SELECT name, code FROM product WHERE id = ? AND tenant_id = ?`,
      [productId, tenantId]
    );

    let branchName = 'Sucursal no especificada';
    if (branchId) {
      const [[branch]] = await conn.query(
        `SELECT name FROM tenant_branch WHERE id = ? AND tenant_id = ?`,
        [branchId, tenantId]
      );
      if (branch) {
        branchName = branch.name;
      }
    }

    if (!product) return; // Producto no encontrado, no crear notificación

    const productName = product.name || 'Producto';
    const productCode = product.code ? ` (${product.code})` : '';

    // Obtener nombre del usuario que hizo el movimiento
    let userName = 'Usuario desconocido';
    if (userId) {
      const [[user]] = await conn.query(
        `SELECT email FROM users WHERE id = ?`,
        [userId]
      );
      if (user) {
        userName = user.email;
      }
    }

    // Definir título y mensaje según el tipo de movimiento
    let title, message;
    const quantityAbs = Math.abs(quantity);
    const stockDiff = Math.abs(newStock - previousStock);

    switch (type) {
      case 'entry':
        title = `📥 Ingreso de Stock`;
        message = `${productName}${productCode}: Se ingresaron ${quantityAbs} unidades en ${branchName}. Stock: ${previousStock} → ${newStock}`;
        break;
      case 'exit':
        title = `📤 Salida de Stock`;
        message = `${productName}${productCode}: Se retiraron ${quantityAbs} unidades de ${branchName}. Stock: ${previousStock} → ${newStock}`;
        break;
      case 'sale':
        title = `💰 Venta de Stock`;
        message = `${productName}${productCode}: Se vendieron ${quantityAbs} unidades en ${branchName}. Stock: ${previousStock} → ${newStock}`;
        break;
      case 'return':
        title = `🔄 Devolución de Stock`;
        message = `${productName}${productCode}: Se devolvieron ${quantityAbs} unidades en ${branchName}. Stock: ${previousStock} → ${newStock}`;
        break;
      case 'adjustment':
        title = `⚙️ Ajuste de Stock`;
        message = `${productName}${productCode}: Se ajustó el stock en ${branchName}. Stock: ${previousStock} → ${newStock} (diferencia: ${stockDiff})`;
        break;
      case 'transfer_in':
        title = `📦 Transferencia Recibida`;
        message = `${productName}${productCode}: Se recibieron ${quantityAbs} unidades por transferencia en ${branchName}. Stock: ${previousStock} → ${newStock}`;
        break;
      case 'transfer_out':
        title = `🚚 Transferencia Enviada`;
        message = `${productName}${productCode}: Se enviaron ${quantityAbs} unidades por transferencia desde ${branchName}. Stock: ${previousStock} → ${newStock}`;
        break;
      default:
        title = `📊 Movimiento de Stock`;
        message = `${productName}${productCode}: Movimiento de stock en ${branchName}. Stock: ${previousStock} → ${newStock}`;
    }

    if (notes) {
      message += ` | Nota: ${notes}`;
    }

    message += ` | Realizado por: ${userName}`;

    // Obtener usuarios con permisos de stock
    const userIds = await getUsersWithStockPermissions(tenantId, conn);

    if (userIds.length === 0) {
      return; // No hay usuarios a notificar
    }

    // Crear notificaciones para cada usuario (excepto el que hizo el movimiento si está definido)
    const targetUserIds = userIds.filter(id => id !== userId);

    if (targetUserIds.length === 0) {
      return;
    }

    for (const targetUserId of targetUserIds) {
      try {
        await conn.query(
          `INSERT INTO notifications (tenant_id, user_id, type, title, message, data, is_read)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
          [
            tenantId,
            targetUserId,
            'stock_movement',
            title,
            message,
            JSON.stringify({
              productId,
              branchId,
              movementId,
              type,
              quantity,
              previousStock,
              newStock,
              createdBy: userId
            })
          ]
        );
      } catch (err) {
        console.error(`[NOTIF] Error al crear notificación de movimiento de stock:`, err.message);
      }
    }
  } catch (error) {
    // No lanzar error si falla la notificación, solo loguear
    console.error('[notifyStockMovement] Error al crear notificaciones:', error);
  }
}

/**
 * Obtiene el stock disponible de un producto en una sucursal
 */
export async function getProductStock(productId, branchId, tenantId) {
  const [rows] = await pool.query(
    `SELECT 
      ps.*,
      ps.available_quantity as available,
      p.name as product_name,
      p.code as product_code,
      tb.name as branch_name
    FROM product_stock ps
    INNER JOIN product p ON p.id = ps.product_id
    INNER JOIN tenant_branch tb ON tb.id = ps.branch_id
    WHERE ps.product_id = ? AND ps.branch_id = ? AND ps.tenant_id = ?`,
    [productId, branchId, tenantId]
  );
  return rows[0] || null;
}

/**
 * Obtiene el stock total de un producto (suma de todas las sucursales)
 */
export async function getProductTotalStock(productId, tenantId) {
  const [rows] = await pool.query(
    `SELECT 
      p.id,
      p.code,
      p.name,
      COALESCE(SUM(ps.quantity), 0) as total_quantity,
      COALESCE(SUM(ps.reserved_quantity), 0) as total_reserved,
      COALESCE(SUM(ps.available_quantity), 0) as total_available
    FROM product p
    LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.tenant_id = p.tenant_id
    WHERE p.id = ? AND p.tenant_id = ?
    GROUP BY p.id, p.code, p.name`,
    [productId, tenantId]
  );
  return rows[0] || null;
}

/**
 * Actualiza el stock de un producto en una sucursal
 */
export async function updateProductStock(productId, branchId, tenantId, quantity, conn = pool) {
  // Asegurar que existe el registro
  await conn.query(
    `INSERT INTO product_stock (product_id, branch_id, tenant_id, quantity)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`,
    [productId, branchId, tenantId, quantity]
  );
  
  // Actualizar last_movement_at
  await conn.query(
    `UPDATE product_stock 
     SET last_movement_at = NOW()
     WHERE product_id = ? AND branch_id = ? AND tenant_id = ?`,
    [productId, branchId, tenantId]
  );
}

/**
 * Registra un movimiento de stock
 */
export async function recordStockMovement({
  productId,
  branchId,
  tenantId,
  type,
  quantity,
  unitCost = null,
  notes = null,
  referenceType = null,
  referenceId = null,
  transferId = null,
  userId = null
}, conn = pool) {
  // Obtener stock actual antes del movimiento
  const [[stockResult]] = await conn.query(
    `SELECT COALESCE(quantity, 0) as current_stock
     FROM product_stock
     WHERE product_id = ? AND branch_id = ? AND tenant_id = ?`,
    [productId, branchId, tenantId]
  );
  
  const previousStock = stockResult?.current_stock || 0;
  const quantityAbs = Math.abs(quantity);
  
  // Calcular nuevo stock
  let newStock;
  if (type === 'entry' || type === 'adjustment' || type === 'transfer_in') {
    newStock = previousStock + quantityAbs;
  } else if (type === 'exit' || type === 'sale' || type === 'return' || type === 'transfer_out') {
    newStock = Math.max(0, previousStock - quantityAbs);
  } else {
    newStock = previousStock;
  }
  
  // Insertar movimiento con previous_stock y new_stock
  const [result] = await conn.query(
    `INSERT INTO stock_movement 
     (product_id, branch_id, tenant_id, type, quantity, previous_stock, new_stock,
      unit_cost, notes, reference_type, reference_id, transfer_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [productId, branchId, tenantId, type, quantity, previousStock, newStock,
     unitCost, notes, referenceType, referenceId, transferId, userId]
  );
  
  // Actualizar stock en product_stock con el valor calculado
  await conn.query(
    `INSERT INTO product_stock (product_id, branch_id, tenant_id, quantity, last_movement_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE 
       quantity = ?,
       last_movement_at = NOW()`,
    [productId, branchId, tenantId, newStock, newStock]
  );

  const movementId = result.insertId;

  // Crear notificaciones para usuarios con permisos de stock (no bloqueante)
  // Ejecutamos en background pero capturamos errores
  Promise.resolve().then(async () => {
    try {
      console.log(`[recordStockMovement] Iniciando notificación para movimiento ${movementId}...`);
      await notifyStockMovement({
        tenantId,
        productId,
        branchId,
        type,
        quantity,
        previousStock,
        newStock,
        notes,
        userId,
        movementId
      }, conn);
      console.log(`[recordStockMovement] ✅ Notificación enviada para movimiento ${movementId}`);
    } catch (err) {
      // Solo loguear errores, no lanzarlos
      console.error('[recordStockMovement] ❌ Error en notificación (no crítico):', err);
    }
  }).catch(err => {
    console.error('[recordStockMovement] Error inesperado en promesa de notificación:', err);
  });
  
  return movementId;
}

/**
 * Crea o actualiza una reserva de stock
 */
export async function createStockReservation({
  productId,
  branchId,
  tenantId,
  quantity,
  reservationType = 'manual',
  referenceType = null,
  referenceId = null,
  expiresAt = null,
  notes = null,
  userId = null
}, conn = pool) {
  // Verificar stock disponible
  const stock = await getProductStock(productId, branchId, tenantId);
  if (!stock || stock.available_quantity < quantity) {
    throw new Error(`Stock insuficiente. Disponible: ${stock?.available_quantity || 0}, Solicitado: ${quantity}`);
  }
  
  const [result] = await conn.query(
    `INSERT INTO stock_reservation 
     (product_id, branch_id, tenant_id, quantity, reservation_type, 
      reference_type, reference_id, expires_at, notes, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [productId, branchId, tenantId, quantity, reservationType, 
     referenceType, referenceId, expiresAt, notes, userId]
  );
  
  return result.insertId;
}

/**
 * Cancela una reserva de stock
 */
export async function cancelStockReservation(reservationId, userId = null, conn = pool) {
  const [result] = await conn.query(
    `UPDATE stock_reservation 
     SET status = 'cancelled', cancelled_at = NOW()
     WHERE id = ? AND status = 'active'`,
    [reservationId]
  );
  return result.affectedRows > 0;
}

/**
 * Confirma una reserva (la convierte en movimiento real)
 */
export async function fulfillStockReservation(reservationId, userId = null, conn = pool) {
  const [reservations] = await conn.query(
    `SELECT * FROM stock_reservation WHERE id = ? AND status = 'active'`,
    [reservationId]
  );
  
  if (reservations.length === 0) {
    throw new Error('Reserva no encontrada o ya no está activa');
  }
  
  const reservation = reservations[0];
  
  // Registrar movimiento de salida
  await recordStockMovement({
    productId: reservation.product_id,
    branchId: reservation.branch_id,
    tenantId: reservation.tenant_id,
    type: 'exit',
    quantity: reservation.quantity,
    referenceType: reservation.reference_type,
    referenceId: reservation.reference_id,
    userId
  }, conn);
  
  // Marcar reserva como cumplida
  await conn.query(
    `UPDATE stock_reservation 
     SET status = 'fulfilled'
     WHERE id = ?`,
    [reservationId]
  );
  
  return true;
}

/**
 * Crea una transferencia de stock entre sucursales
 */
export async function createStockTransfer({
  productId,
  fromBranchId,
  toBranchId,
  tenantId,
  quantity,
  notes = null,
  userId = null
}, conn = pool) {
  // Verificar stock disponible en sucursal origen
  const stock = await getProductStock(productId, fromBranchId, tenantId);
  if (!stock || stock.available_quantity < quantity) {
    throw new Error(`Stock insuficiente en sucursal origen. Disponible: ${stock?.available_quantity || 0}`);
  }
  
  // Crear registro de transferencia
  const [result] = await conn.query(
    `INSERT INTO stock_transfer 
     (product_id, from_branch_id, to_branch_id, tenant_id, quantity, notes, requested_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [productId, fromBranchId, toBranchId, tenantId, quantity, notes, userId]
  );
  
  const transferId = result.insertId;
  
  // Registrar movimientos de stock (salida y entrada)
  // Para transfer_out, la cantidad debe ser positiva para que la resta funcione correctamente
  await recordStockMovement({
    productId,
    branchId: fromBranchId,
    tenantId,
    type: 'transfer_out',
    quantity: quantity, // Cantidad positiva para la resta
    notes: `Transferencia a sucursal ${toBranchId}`,
    transferId,
    userId
  }, conn);
  
  await recordStockMovement({
    productId,
    branchId: toBranchId,
    tenantId,
    type: 'transfer_in',
    quantity: quantity, // Cantidad positiva para la suma
    notes: `Transferencia desde sucursal ${fromBranchId}`,
    transferId,
    userId
  }, conn);
  
  // Actualizar estado de transferencia a "in_transit"
  await conn.query(
    `UPDATE stock_transfer SET status = 'in_transit' WHERE id = ?`,
    [transferId]
  );
  
  // Enviar notificaciones a usuarios de la sucursal destino para que confirmen la recepción
  try {
    // Obtener información del producto y sucursales
    const [[product]] = await conn.query(
      `SELECT name, code FROM product WHERE id = ? AND tenant_id = ?`,
      [productId, tenantId]
    );
    
    const [[fromBranch]] = await conn.query(
      `SELECT name FROM tenant_branch WHERE id = ? AND tenant_id = ?`,
      [fromBranchId, tenantId]
    );
    
    const [[toBranch]] = await conn.query(
      `SELECT name FROM tenant_branch WHERE id = ? AND tenant_id = ?`,
      [toBranchId, tenantId]
    );
    
    if (product && toBranch) {
      const productName = product.name || 'Producto';
      const productCode = product.code ? ` (${product.code})` : '';
      const fromBranchName = fromBranch?.name || `Sucursal ${fromBranchId}`;
      const toBranchName = toBranch.name;
      
      // Obtener el administrador de la sucursal destino (solo él puede confirmar transferencias)
      const branchAdminId = await getBranchAdmin(tenantId, toBranchId, conn);
      
      if (!branchAdminId) {
        console.log(`[NOTIF] ⚠️ Transferencia ${transferId}: La sucursal destino no tiene administrador asignado`);
      } else {
        // Notificar solo al administrador de la sucursal destino
        const title = `📦 Transferencia pendiente de confirmación`;
        const message = `${productName}${productCode}: Se recibieron ${quantity} unidades desde ${fromBranchName}. Por favor confirmá la recepción en ${toBranchName}.`;
        
        try {
          const [result] = await conn.query(
            `INSERT INTO notifications (tenant_id, user_id, type, title, message, data, is_read)
             VALUES (?, ?, ?, ?, ?, ?, 0)`,
            [
              tenantId,
              branchAdminId,
              'stock_transfer_pending',
              title,
              message,
              JSON.stringify({
                transferId,
                productId,
                fromBranchId,
                toBranchId,
                quantity,
                productName: product.name,
                productCode: product.code,
                fromBranchName,
                toBranchName
              })
            ]
          );
          console.log(`[NOTIF] ✅ Transferencia ${transferId}: Notificación enviada a administrador ${branchAdminId} (tenant ${tenantId})`);
        } catch (err) {
          console.error(`[NOTIF] ❌ Error al crear notificación para administrador ${branchAdminId}:`, err.message);
        }
      }
    }
  } catch (error) {
    // No lanzar error si falla la notificación, solo loguear
    console.error('[NOTIF] Error al crear notificaciones de confirmación:', error.message);
  }
  
  return transferId;
}

/**
 * Confirma la recepción de una transferencia
 */
export async function confirmStockTransfer(transferId, userId, conn = pool) {
  const [transfers] = await conn.query(
    `SELECT * FROM stock_transfer WHERE id = ? AND status = 'in_transit'`,
    [transferId]
  );
  
  if (transfers.length === 0) {
    throw new Error('Transferencia no encontrada o ya fue confirmada');
  }
  
  await conn.query(
    `UPDATE stock_transfer 
     SET status = 'received', confirmed_by = ?, confirmed_at = NOW()
     WHERE id = ?`,
    [userId, transferId]
  );
  
  return true;
}

/**
 * Genera alertas de stock automáticamente
 */
export async function generateStockAlerts(tenantId, conn = pool) {
  const [result] = await conn.query(
    `CALL sp_generate_stock_alerts(?)`,
    [tenantId]
  );

  // Crear notificaciones para las nuevas alertas generadas
  try {
    const newAlerts = await getActiveStockAlerts(tenantId, null, conn);
    
    for (const alert of newAlerts) {
      // Verificar si ya existe una notificación para esta alerta (evitar duplicados)
      const [existing] = await conn.query(
        `SELECT id FROM notifications 
         WHERE tenant_id = ? 
           AND type = 'stock_alert' 
           AND JSON_EXTRACT(data, '$.alertId') = ?
           AND is_read = 0`,
        [tenantId, alert.id]
      );

      if (existing.length === 0) {
        // Obtener usuarios con permisos de stock
        const userIds = await getUsersWithStockPermissions(tenantId, conn);

        if (userIds.length > 0) {
          const productName = alert.product_name || 'Producto';
          const productCode = alert.product_code ? ` (${alert.product_code})` : '';
          const branchName = alert.branch_name || 'Sucursal no especificada';

          let title, message;
          switch (alert.alert_type) {
            case 'low_stock':
              title = `⚠️ Stock Bajo`;
              message = `${productName}${productCode}: Stock bajo en ${branchName}. Actual: ${alert.current_quantity}, Mínimo: ${alert.threshold_quantity}`;
              break;
            case 'out_of_stock':
              title = `🚨 Sin Stock`;
              message = `${productName}${productCode}: Sin stock en ${branchName}. Stock actual: ${alert.current_quantity}`;
              break;
            case 'overstock':
              title = `📦 Sobrestock`;
              message = `${productName}${productCode}: Sobrestock en ${branchName}. Actual: ${alert.current_quantity}, Máximo: ${alert.threshold_quantity}`;
              break;
            default:
              title = `⚠️ Alerta de Stock`;
              message = `${productName}${productCode}: Alerta de stock en ${branchName}`;
          }

          // Crear notificaciones para todos los usuarios con permisos
          for (const userId of userIds) {
            await conn.query(
              `INSERT INTO notifications (tenant_id, user_id, type, title, message, data, is_read)
               VALUES (?, ?, ?, ?, ?, ?, 0)`,
              [
                tenantId,
                userId,
                'stock_alert',
                title,
                message,
                JSON.stringify({
                  alertId: alert.id,
                  productId: alert.product_id,
                  branchId: alert.branch_id,
                  alertType: alert.alert_type,
                  currentQuantity: alert.current_quantity,
                  thresholdQuantity: alert.threshold_quantity
                })
              ]
            );
          }
        }
      }
    }

    console.log(`[generateStockAlerts] Notificaciones creadas para ${newAlerts.length} alertas nuevas`);
  } catch (error) {
    // No lanzar error si falla la notificación, solo loguear
    console.error('[generateStockAlerts] Error al crear notificaciones de alertas:', error);
  }

  return result;
}

/**
 * Obtiene alertas activas de stock
 */
export async function getActiveStockAlerts(tenantId, branchId = null, conn = pool) {
  let query = `
    SELECT 
      sa.*,
      p.name as product_name,
      p.code as product_code,
      tb.name as branch_name
    FROM stock_alert sa
    INNER JOIN product p ON p.id = sa.product_id
    LEFT JOIN tenant_branch tb ON tb.id = sa.branch_id
    WHERE sa.tenant_id = ? AND sa.status = 'active'
  `;
  
  const params = [tenantId];
  if (branchId) {
    query += ` AND (sa.branch_id = ? OR sa.branch_id IS NULL)`;
    params.push(branchId);
  }
  
  query += ` ORDER BY sa.created_at DESC`;
  
  const [rows] = await conn.query(query, params);
  return rows;
}

/**
 * Calcula la valuación de inventario
 */
export async function calculateInventoryValuation(tenantId, branchId = null) {
  let query = `
    SELECT 
      SUM(total_value) as total_inventory_value,
      SUM(available_value) as available_inventory_value,
      COUNT(*) as product_count
    FROM v_inventory_valuation
    WHERE tenant_id = ?
  `;
  
  const params = [tenantId];
  if (branchId) {
    query += ` AND branch_id = ?`;
    params.push(branchId);
  }
  
  const [rows] = await pool.query(query, params);
  return rows[0] || { total_inventory_value: 0, available_inventory_value: 0, product_count: 0 };
}

