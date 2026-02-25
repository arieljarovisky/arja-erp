// src/routes/stockAlerts.js
// Rutas para alertas de stock

import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import { checkStockPermission } from "./stock.js";
import * as stockService from "../services/stockService.js";

const router = express.Router();

// GET /api/stock/alerts - Listar alertas
router.get("/alerts", requireAuth, identifyTenant, checkStockPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { branch_id, status, alert_type } = req.query;
    
    const alerts = await stockService.getActiveStockAlerts(tenantId, branch_id || null);
    
    // Filtrar por status y tipo si se especifica
    let filtered = alerts;
    if (status) {
      filtered = filtered.filter(a => a.status === status);
    }
    if (alert_type) {
      filtered = filtered.filter(a => a.alert_type === alert_type);
    }
    
    res.json({ ok: true, data: filtered });
  } catch (error) {
    console.error("[GET /api/stock/alerts] Error:", error);
    res.status(500).json({ ok: false, error: "No se pudieron obtener las alertas" });
  }
});

// POST /api/stock/alerts/generate - Generar alertas automáticamente
router.post("/alerts/generate", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    
    await stockService.generateStockAlerts(tenantId);
    
    const alerts = await stockService.getActiveStockAlerts(tenantId);
    
    res.json({ 
      ok: true, 
      data: alerts,
      message: `Se generaron ${alerts.length} alertas` 
    });
  } catch (error) {
    console.error("[POST /api/stock/alerts/generate] Error:", error);
    res.status(500).json({ ok: false, error: "Error al generar alertas" });
  }
});

// PUT /api/stock/alerts/:id/acknowledge - Reconocer alerta
router.put("/alerts/:id/acknowledge", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const [result] = await pool.query(
      `UPDATE stock_alert 
       SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = NOW()
       WHERE id = ? AND tenant_id = ? AND status = 'active'`,
      [userId, id, req.tenant_id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Alerta no encontrada o ya procesada" });
    }
    
    res.json({ ok: true, message: "Alerta reconocida" });
  } catch (error) {
    console.error("[PUT /api/stock/alerts/:id/acknowledge] Error:", error);
    res.status(400).json({ ok: false, error: "Error al reconocer la alerta" });
  }
});

// PUT /api/stock/alerts/:id/dismiss - Descartar alerta
router.put("/alerts/:id/dismiss", requireAuth, identifyTenant, checkStockPermission('write'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const [result] = await pool.query(
      `UPDATE stock_alert 
       SET status = 'dismissed'
       WHERE id = ? AND tenant_id = ?`,
      [id, req.tenant_id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Alerta no encontrada" });
    }
    
    res.json({ ok: true, message: "Alerta descartada" });
  } catch (error) {
    console.error("[PUT /api/stock/alerts/:id/dismiss] Error:", error);
    res.status(400).json({ ok: false, error: "Error al descartar la alerta" });
  }
});

export default router;


























