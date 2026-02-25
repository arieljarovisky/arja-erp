// src/routes/stockValuation.js
// Rutas para valuación de inventario y costos

import express from "express";
import { requireAuth } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import { checkStockPermission } from "./stock.js";
import * as stockService from "../services/stockService.js";

const router = express.Router();

// GET /api/stock/valuation - Obtener valuación de inventario
router.get("/valuation", requireAuth, identifyTenant, checkStockPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { branch_id } = req.query;
    
    const valuation = await stockService.calculateInventoryValuation(tenantId, branch_id || null);
    
    res.json({ ok: true, data: valuation });
  } catch (error) {
    console.error("[GET /api/stock/valuation] Error:", error);
    res.status(500).json({ ok: false, error: "No se pudo calcular la valuación" });
  }
});

// GET /api/stock/valuation/detail - Detalle de valuación por producto
router.get("/valuation/detail", requireAuth, identifyTenant, checkStockPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { branch_id } = req.query;
    
    // Usar la vista directamente (ahora incluye todos los productos)
    let query = `
      SELECT 
        product_id,
        branch_id,
        tenant_id,
        product_name,
        product_code,
        branch_name,
        quantity,
        available_quantity,
        reserved_quantity,
        unit_cost,
        total_value,
        available_value,
        valuation_method
      FROM v_inventory_valuation
      WHERE tenant_id = ?
    `;
    
    const params = [tenantId];
    if (branch_id) {
      query += ` AND branch_id = ?`;
      params.push(branch_id);
    }
    
    query += ` ORDER BY total_value DESC, product_name ASC`;
    
    const { pool } = await import("../db.js");
    const [rows] = await pool.query(query, params);
    
    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("[GET /api/stock/valuation/detail] Error:", error);
    res.status(500).json({ ok: false, error: "No se pudo obtener el detalle de valuación" });
  }
});

export default router;

