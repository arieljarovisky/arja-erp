// src/routes/whatsappAgent.js — Endpoints para gestión de agente de WhatsApp
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../auth/middlewares.js";
import { sendWhatsAppText } from "../whatsapp.js";
import { getTenantWhatsAppHub } from "../services/whatsappHub.js";

export const whatsappAgent = Router();

// Aplicar middleware de autenticación a todas las rutas
whatsappAgent.use(requireAuth, requireAdmin);

/**
 * POST /api/whatsapp/agent/init-conversation
 * Permite al agente iniciar una conversación con el número de WhatsApp Business
 * para abrir la ventana de 24 horas
 */
whatsappAgent.post("/init-conversation", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenantId requerido",
      });
    }

    // Obtener configuración de WhatsApp del tenant
    const waConfig = await getTenantWhatsAppHub(tenantId);
    if (!waConfig?.supportAgentPhone) {
      return res.status(400).json({
        ok: false,
        error: "No hay agente de soporte configurado para este tenant",
      });
    }

    const agentPhone = waConfig.supportAgentPhone;
    const businessPhone = waConfig.phoneDisplay || "número de WhatsApp Business";

    // Enviar mensaje de prueba al número de WhatsApp Business
    // Esto abre la ventana de 24 horas
    try {
      // El agente envía un mensaje al número de WhatsApp Business
      // Nota: Esto requiere que el agente tenga el número de WhatsApp Business
      // Por ahora, solo devolvemos instrucciones
      
      return res.json({
        ok: true,
        message: "Para iniciar la conversación, el agente debe enviar un mensaje al número de WhatsApp Business",
        instructions: {
          step1: `El agente (${agentPhone}) debe enviar un mensaje al número de WhatsApp Business`,
          step2: `Número de WhatsApp Business: ${businessPhone}`,
          step3: "Esto abrirá la ventana de 24 horas para recibir mensajes del sistema",
          step4: "Después de esto, el sistema podrá reenviar mensajes de clientes al agente",
        },
        businessPhone,
        agentPhone,
      });
    } catch (error) {
      console.error(`[WA Agent] Error al intentar iniciar conversación:`, error);
      return res.status(500).json({
        ok: false,
        error: "Error al iniciar conversación",
        details: error.message,
      });
    }
  } catch (error) {
    console.error(`[WA Agent] Error en init-conversation:`, error);
    return res.status(500).json({
      ok: false,
      error: "Error interno del servidor",
      details: error.message,
    });
  }
});

/**
 * GET /api/whatsapp/reengagement-errors
 * Obtiene la lista de errores de re-engagement para el tenant
 */
whatsappAgent.get("/reengagement-errors", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenantId requerido",
      });
    }

    const { limit = 50, offset = 0, resolved = null } = req.query;

    // Construir query con filtros opcionales
    let query = `
      SELECT 
        id,
        tenant_id,
        agent_phone,
        customer_phone,
        customer_name,
        business_phone,
        error_code,
        error_message,
        resolved_at,
        created_at
      FROM whatsapp_reengagement_errors
      WHERE tenant_id = ?
    `;
    const params = [tenantId];

    // Filtro por estado de resolución
    if (resolved === "true") {
      query += " AND resolved_at IS NOT NULL";
    } else if (resolved === "false") {
      query += " AND resolved_at IS NULL";
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const [errors] = await pool.query(query, params);

    // Obtener total de errores (para paginación)
    let countQuery = `
      SELECT COUNT(*) as total
      FROM whatsapp_reengagement_errors
      WHERE tenant_id = ?
    `;
    const countParams = [tenantId];
    if (resolved === "true") {
      countQuery += " AND resolved_at IS NOT NULL";
    } else if (resolved === "false") {
      countQuery += " AND resolved_at IS NULL";
    }
    const [[{ total }]] = await pool.query(countQuery, countParams);

    return res.json({
      ok: true,
      errors,
      pagination: {
        total,
        limit: Number(limit),
        offset: Number(offset),
        hasMore: Number(offset) + errors.length < total,
      },
    });
  } catch (error) {
    console.error(`[WA Agent] Error obteniendo errores de re-engagement:`, error);
    
    // Si la tabla no existe, devolver array vacío
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.json({
        ok: true,
        errors: [],
        pagination: {
          total: 0,
          limit: Number(req.query.limit || 50),
          offset: Number(req.query.offset || 0),
          hasMore: false,
        },
        message: "La tabla de errores aún no existe. Ejecuta la migración 063.",
      });
    }

    return res.status(500).json({
      ok: false,
      error: "Error interno del servidor",
      details: error.message,
    });
  }
});

/**
 * PUT /api/whatsapp/reengagement-errors/:id/resolve
 * Marca un error de re-engagement como resuelto
 */
whatsappAgent.put("/reengagement-errors/:id/resolve", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenant_id || req.user?.tenant_id;
    const errorId = req.params.id;

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenantId requerido",
      });
    }

    // Verificar que el error pertenece al tenant
    const [[error]] = await pool.query(
      `SELECT id, tenant_id, resolved_at 
       FROM whatsapp_reengagement_errors 
       WHERE id = ? AND tenant_id = ?`,
      [errorId, tenantId]
    );

    if (!error) {
      return res.status(404).json({
        ok: false,
        error: "Error no encontrado o no pertenece a este tenant",
      });
    }

    if (error.resolved_at) {
      return res.json({
        ok: true,
        message: "El error ya estaba marcado como resuelto",
        error: {
          ...error,
          resolved_at: error.resolved_at,
        },
      });
    }

    // Marcar como resuelto
    await pool.query(
      `UPDATE whatsapp_reengagement_errors 
       SET resolved_at = NOW() 
       WHERE id = ? AND tenant_id = ?`,
      [errorId, tenantId]
    );

    // Obtener el error actualizado
    const [[updatedError]] = await pool.query(
      `SELECT * FROM whatsapp_reengagement_errors WHERE id = ?`,
      [errorId]
    );

    return res.json({
      ok: true,
      message: "Error marcado como resuelto",
      error: updatedError,
    });
  } catch (error) {
    console.error(`[WA Agent] Error marcando error como resuelto:`, error);
    return res.status(500).json({
      ok: false,
      error: "Error interno del servidor",
      details: error.message,
    });
  }
});

