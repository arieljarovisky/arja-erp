// src/routes/stockReservations.js
// Rutas para gestión de reservas de stock

import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import { checkStockPermission } from "./stock.js";
import * as stockService from "../services/stockService.js";

const router = express.Router();

// GET /api/stock/reservations - Listar reservas
router.get("/reservations", requireAuth, identifyTenant, checkStockPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { branch_id, status, product_id, reference_type, reference_id } = req.query;
    
    let query = `
      SELECT 
        sr.*,
        p.name as product_name,
        p.code as product_code,
        tb.name as branch_name,
        u.name as created_by_name
      FROM stock_reservation sr
      INNER JOIN product p ON p.id = sr.product_id
      LEFT JOIN tenant_branch tb ON tb.id = sr.branch_id
      LEFT JOIN users u ON u.id = sr.created_by
      WHERE sr.tenant_id = ?
    `;
    
    const params = [tenantId];
    
    if (branch_id) {
      query += ` AND sr.branch_id = ?`;
      params.push(branch_id);
    }
    
    if (status) {
      query += ` AND sr.status = ?`;
      params.push(status);
    } else {
      query += ` AND sr.status IN ('active', 'confirmed')`;
    }
    
    if (product_id) {
      query += ` AND sr.product_id = ?`;
      params.push(product_id);
    }
    
    if (reference_type) {
      query += ` AND sr.reference_type = ?`;
      params.push(reference_type);
    }
    
    if (reference_id) {
      query += ` AND sr.reference_id = ?`;
      params.push(reference_id);
    }
    
    query += ` ORDER BY sr.created_at DESC`;
    
    const [rows] = await pool.query(query, params);
    
    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[GET /api/stock/reservations] Error:", error);
    res.status(500).json({ ok: false, error: "No se pudieron obtener las reservas" });
  }
});

// POST /api/stock/reservations - Crear reserva
router.post("/reservations", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const userId = req.user.id;
    const { product_id, branch_id, quantity, reservation_type, reference_type, reference_id, expires_at, notes } = req.body;
    
    if (!product_id || !branch_id || !quantity || quantity <= 0) {
      return res.status(400).json({ ok: false, error: "Faltan datos requeridos" });
    }
    
    const reservationId = await stockService.createStockReservation({
      productId: product_id,
      branchId: branch_id,
      tenantId,
      quantity,
      reservationType: reservation_type || 'manual',
      referenceType: reference_type,
      referenceId: reference_id,
      expiresAt: expires_at ? new Date(expires_at) : null,
      notes,
      userId
    });
    
    res.json({ ok: true, data: { id: reservationId }, message: "Reserva creada exitosamente" });
  } catch (error) {
    console.error("[POST /api/stock/reservations] Error:", error);
    res.status(400).json({ ok: false, error: error.message || "Error al crear la reserva" });
  }
});

// PUT /api/stock/reservations/:id/cancel - Cancelar reserva
router.put("/reservations/:id/cancel", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const cancelled = await stockService.cancelStockReservation(id, userId);
    
    if (!cancelled) {
      return res.status(404).json({ ok: false, error: "Reserva no encontrada o ya cancelada" });
    }
    
    res.json({ ok: true, message: "Reserva cancelada exitosamente" });
  } catch (error) {
    console.error("[PUT /api/stock/reservations/:id/cancel] Error:", error);
    res.status(400).json({ ok: false, error: error.message || "Error al cancelar la reserva" });
  }
});

// PUT /api/stock/reservations/:id/fulfill - Cumplir reserva (convertir en movimiento)
router.put("/reservations/:id/fulfill", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    await stockService.fulfillStockReservation(id, userId);
    
    res.json({ ok: true, message: "Reserva cumplida exitosamente" });
  } catch (error) {
    console.error("[PUT /api/stock/reservations/:id/fulfill] Error:", error);
    res.status(400).json({ ok: false, error: error.message || "Error al cumplir la reserva" });
  }
});

export default router;

