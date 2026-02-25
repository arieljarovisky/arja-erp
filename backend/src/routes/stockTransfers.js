// src/routes/stockTransfers.js
// Rutas para transferencias de stock entre sucursales con confirmación

import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import { checkStockPermission } from "./stock.js";
import * as stockService from "../services/stockService.js";

const router = express.Router();

// GET /api/stock/transfers - Listar transferencias
router.get("/transfers", requireAuth, identifyTenant, checkStockPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { branch_id, status, product_id } = req.query;
    
    let query = `
      SELECT 
        st.*,
        p.name as product_name,
        p.code as product_code,
        from_branch.name as from_branch_name,
        to_branch.name as to_branch_name,
        COALESCE(requested_user.email, 'Usuario eliminado') as requested_by_name,
        COALESCE(confirmed_user.email, 'Usuario eliminado') as confirmed_by_name
      FROM stock_transfer st
      INNER JOIN product p ON p.id = st.product_id
      INNER JOIN tenant_branch from_branch ON from_branch.id = st.from_branch_id
      INNER JOIN tenant_branch to_branch ON to_branch.id = st.to_branch_id
      LEFT JOIN users requested_user ON requested_user.id = st.requested_by
      LEFT JOIN users confirmed_user ON confirmed_user.id = st.confirmed_by
      WHERE st.tenant_id = ?
    `;
    
    const params = [tenantId];
    
    if (branch_id) {
      query += ` AND (st.from_branch_id = ? OR st.to_branch_id = ?)`;
      params.push(branch_id, branch_id);
    }
    
    if (status) {
      query += ` AND st.status = ?`;
      params.push(status);
    }
    
    if (product_id) {
      query += ` AND st.product_id = ?`;
      params.push(product_id);
    }
    
    query += ` ORDER BY st.requested_at DESC`;
    
    const [rows] = await pool.query(query, params);
    
    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[GET /api/stock/transfers] Error:", error);
    res.status(500).json({ ok: false, error: "No se pudieron obtener las transferencias" });
  }
});

// POST /api/stock/transfers - Crear transferencia
router.post("/transfers", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const userId = req.user.id;
    const { product_id, from_branch_id, to_branch_id, quantity, notes } = req.body;
    
    if (!product_id || !from_branch_id || !to_branch_id || !quantity || quantity <= 0) {
      return res.status(400).json({ ok: false, error: "Faltan datos requeridos" });
    }
    
    if (from_branch_id === to_branch_id) {
      return res.status(400).json({ ok: false, error: "Las sucursales origen y destino no pueden ser la misma" });
    }
    
    const transferId = await stockService.createStockTransfer({
      productId: product_id,
      fromBranchId: from_branch_id,
      toBranchId: to_branch_id,
      tenantId,
      quantity,
      notes,
      userId
    });
    
    res.json({ ok: true, data: { id: transferId }, message: "Transferencia creada exitosamente" });
  } catch (error) {
    console.error("[POST /api/stock/transfers] ❌ Error:", error);
    res.status(400).json({ ok: false, error: error.message || "Error al crear la transferencia" });
  }
});

// PUT /api/stock/transfers/:id/confirm - Confirmar recepción
router.put("/transfers/:id/confirm", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const tenantId = req.tenant_id;
    
    // Verificar que el usuario es el administrador de la sucursal destino
    const [transfers] = await pool.query(
      `SELECT to_branch_id FROM stock_transfer 
       WHERE id = ? AND tenant_id = ? AND status = 'in_transit'`,
      [id, tenantId]
    );
    
    if (transfers.length === 0) {
      return res.status(404).json({ ok: false, error: "Transferencia no encontrada o ya fue confirmada" });
    }
    
    const toBranchId = transfers[0].to_branch_id;
    
    // Verificar que el usuario es el administrador de la sucursal destino
    const [[branch]] = await pool.query(
      `SELECT admin_user_id FROM tenant_branch 
       WHERE id = ? AND tenant_id = ?`,
      [toBranchId, tenantId]
    );
    
    if (!branch || branch.admin_user_id !== userId) {
      return res.status(403).json({ 
        ok: false, 
        error: "Solo el administrador de la sucursal destino puede confirmar esta transferencia" 
      });
    }
    
    await stockService.confirmStockTransfer(id, userId);
    
    res.json({ ok: true, message: "Transferencia confirmada exitosamente" });
  } catch (error) {
    console.error("[PUT /api/stock/transfers/:id/confirm] Error:", error);
    res.status(400).json({ ok: false, error: error.message || "Error al confirmar la transferencia" });
  }
});

// PUT /api/stock/transfers/:id/cancel - Cancelar transferencia
router.put("/transfers/:id/cancel", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { notes } = req.body;
    
    const [transfers] = await pool.query(
      `SELECT * FROM stock_transfer WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'in_transit')`,
      [id, req.tenant_id]
    );
    
    if (transfers.length === 0) {
      return res.status(404).json({ ok: false, error: "Transferencia no encontrada o ya procesada" });
    }
    
    const transfer = transfers[0];
    
    // Revertir movimientos de stock
    // En sucursal origen: devolver el stock que se había quitado (transfer_out)
    await stockService.recordStockMovement({
      productId: transfer.product_id,
      branchId: transfer.from_branch_id,
      tenantId: transfer.tenant_id,
      type: 'adjustment',
      quantity: transfer.quantity, // Cantidad positiva para sumar (devolver stock)
      notes: `Reversión de transferencia cancelada ${notes ? '- ' + notes : ''}`,
      userId
    });
    
    // En sucursal destino: quitar el stock que se había agregado (transfer_in)
    await stockService.recordStockMovement({
      productId: transfer.product_id,
      branchId: transfer.to_branch_id,
      tenantId: transfer.tenant_id,
      type: 'exit', // Usar 'exit' para restar el stock que se había agregado
      quantity: transfer.quantity, // Cantidad positiva para restar
      notes: `Reversión de transferencia cancelada ${notes ? '- ' + notes : ''}`,
      userId
    });
    
    await pool.query(
      `UPDATE stock_transfer 
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = ?`,
      [id]
    );
    
    res.json({ ok: true, message: "Transferencia cancelada exitosamente" });
  } catch (error) {
    console.error("[PUT /api/stock/transfers/:id/cancel] Error:", error);
    res.status(400).json({ ok: false, error: error.message || "Error al cancelar la transferencia" });
  }
});

export default router;

