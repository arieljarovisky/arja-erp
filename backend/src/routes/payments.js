// src/routes/payments.js
import { Router } from "express";
import fetch from "node-fetch";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { getTenantMpToken } from "../services/mercadoPago.js";
import { createGenericPaymentLink } from "../payments.js";
import { sendWhatsAppText } from "../whatsapp.js";

export const payments = Router();

/**
 * 🎫 POST /api/payments/preference
 * Crear preferencia de pago para seña
 */
payments.post("/preference", requireAuth, async (req, res) => {
  try {
    const { appointmentId } = req.body;
    const tenantId = req.tenant?.id;

    if (!appointmentId) {
      return res.status(400).json({ 
        ok: false, 
        error: "appointmentId es requerido" 
      });
    }

    // 1. Obtener config de MP del tenant
    const [[mpConfig]] = await pool.query(`
      SELECT mp_access_token, mp_public_key, mp_user_id, is_active
      FROM tenant_payment_config
      WHERE tenant_id = ? AND is_active = 1
    `, [tenantId]);

    if (!mpConfig || !mpConfig.mp_access_token) {
      return res.status(400).json({ 
        ok: false, 
        error: "Mercado Pago no está configurado para este negocio" 
      });
    }

    // 2. Obtener config de señas desde system_config (usando payments.*)
    const [[requireDepositRow]] = await pool.query(`
      SELECT config_value 
      FROM system_config 
      WHERE tenant_id = ? AND config_key = 'payments.require_deposit'
    `, [tenantId]);

    const requireDeposit = requireDepositRow?.config_value === '1' || requireDepositRow?.config_value === 'true';

    if (!requireDeposit) {
      return res.status(400).json({ 
        ok: false, 
        error: "Las señas no están habilitadas" 
      });
    }

    // Obtener modo de seña (percent o fixed)
    const [[modeRow]] = await pool.query(`
      SELECT config_value 
      FROM system_config 
      WHERE tenant_id = ? AND config_key = 'payments.deposit_mode'
    `, [tenantId]);

    const depositMode = modeRow?.config_value || 'percent';

    // Obtener valor de seña según el modo
    let depositPercentage = null;
    let depositFixed = null;
    
    if (depositMode === 'fixed') {
      const [[fixedRow]] = await pool.query(`
        SELECT config_value 
        FROM system_config 
        WHERE tenant_id = ? AND config_key = 'payments.deposit_fixed'
      `, [tenantId]);
      depositFixed = Number(fixedRow?.config_value || 0);
    } else {
      const [[pctRow]] = await pool.query(`
        SELECT config_value 
        FROM system_config 
        WHERE tenant_id = ? AND config_key = 'payments.deposit_percent'
      `, [tenantId]);
      depositPercentage = Number(pctRow?.config_value || 20);
    }

    // 3. Obtener datos del turno
    const [[appointment]] = await pool.query(`
      SELECT 
        a.id,
        a.customer_id,
        a.instructor_id,
        a.service_id,
        a.starts_at,
        a.status,
        c.name AS customer_name,
        c.phone_e164 AS customer_phone,
        s.name AS service_name,
        s.price_decimal,
        i.name AS instructor_name
      FROM appointment a
      JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
      JOIN service s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
      JOIN instructor i ON i.id = a.instructor_id AND i.tenant_id = a.tenant_id
      WHERE a.id = ? AND a.tenant_id = ?
    `, [appointmentId, tenantId]);

    if (!appointment) {
      return res.status(404).json({ 
        ok: false, 
        error: "Turno no encontrado" 
      });
    }

    // Verificar que no esté ya pagado
    const [[existingPayment]] = await pool.query(`
      SELECT id, mp_payment_status 
      FROM payment 
      WHERE appointment_id = ? AND tenant_id = ?
        AND mp_payment_status = 'approved'
      LIMIT 1
    `, [appointmentId, tenantId]);

    if (existingPayment) {
      return res.status(400).json({ 
        ok: false, 
        error: "Este turno ya tiene un pago aprobado" 
      });
    }

    // 4. Calcular monto de seña
    const servicePrice = Number(appointment.price_decimal || 0);
    let depositAmount = 0;
    
    if (depositMode === 'fixed' && depositFixed != null) {
      depositAmount = depositFixed;
    } else if (depositPercentage != null) {
      depositAmount = Math.round((servicePrice * depositPercentage / 100) * 100) / 100;
    } else {
      return res.status(400).json({
        ok: false,
        error: "Configuración de seña inválida"
      });
    }

    if (depositAmount <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Monto de seña inválido"
      });
    }

    // 5. Obtener tenant slug para URLs
    const [[tenant]] = await pool.query(`
      SELECT subdomain FROM tenant WHERE id = ?
    `, [tenantId]);

    const tenantSlug = tenant?.subdomain || 'default';

    // 6. Crear preferencia en Mercado Pago
    const preference = {
      items: [
        {
          id: `seña-${appointmentId}`,
          title: `Seña - ${appointment.service_name}`,
          description: `Turno con ${appointment.instructor_name}`,
          unit_price: depositAmount,
          quantity: 1,
          currency_id: 'ARS'
        }
      ],
      payer: {
        name: appointment.customer_name || 'Cliente',
        phone: appointment.customer_phone ? {
          number: appointment.customer_phone.replace(/\D/g, '')
        } : undefined
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL_HTTPS}/${tenantSlug}/payment/success`,
        failure: `${process.env.FRONTEND_URL_HTTPS}/${tenantSlug}/payment/failure`,
        pending: `${process.env.FRONTEND_URL_HTTPS}/${tenantSlug}/payment/pending`
      },
      auto_return: 'approved',
      notification_url: `${process.env.API_URL}/api/mp-webhook`,
      external_reference: `${tenantId}:${appointmentId}`,
      statement_descriptor: 'TURNO PELUQUERIA',
      metadata: {
        tenant_id: tenantId,
        appointment_id: appointmentId,
        tenant_slug: tenantSlug
      }
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mpConfig.mp_access_token}`
      },
      body: JSON.stringify(preference)
    });

    const mpData = await mpResponse.json();

    if (!mpResponse.ok || !mpData.id) {
      console.error('❌ [Payments] Error creando preferencia MP:', mpData);
      return res.status(500).json({ 
        ok: false, 
        error: 'Error al crear preferencia de pago',
        details: mpData.message || mpData.error
      });
    }

    // 7. Registrar en payment table
    await pool.query(`
      INSERT INTO payment 
        (tenant_id, appointment_id, method, mp_preference_id, amount_cents, currency, mp_payment_status, created_at)
      VALUES (?, ?, 'mercadopago', ?, ?, 'ARS', 'pending', NOW())
    `, [tenantId, appointmentId, mpData.id, Math.round(depositAmount * 100)]);

    // 8. Actualizar turno con vencimiento (máximo 60 minutos)
    const [[holdMin]] = await pool.query(`
      SELECT config_value 
      FROM system_config 
      WHERE tenant_id = ? AND config_key = 'deposit.holdMinutes'
    `, [tenantId]);
    const rawHold = Number(holdMin?.config_value || 30);
    const holdMinutes = Math.min(30, Math.max(1, rawHold));

    await pool.query(`
      UPDATE appointment a
      JOIN (
        SELECT created_at 
        FROM payment 
        WHERE tenant_id = ? AND appointment_id = ? AND method = 'mercadopago'
        ORDER BY created_at DESC 
        LIMIT 1
      ) p
      SET 
        a.status = 'pending_deposit',
        a.deposit_decimal = ?,
        a.hold_until = DATE_ADD(p.created_at, INTERVAL ? MINUTE)
      WHERE a.id = ? AND a.tenant_id = ?
    `, [tenantId, appointmentId, depositAmount, holdMinutes, appointmentId, tenantId]);

    console.log(`✅ [Payments] Preferencia ${mpData.id} creada para turno ${appointmentId}`);

    // 9. Responder
    res.json({
      ok: true,
      preference_id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point,
      amount: depositAmount,
      public_key: mpConfig.mp_public_key,
      hold_minutes: holdMinutes
    });

  } catch (error) {
    console.error('❌ [Payments] Error:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error interno al crear preferencia',
      details: error.message 
    });
  }
});

/**
 * 💰 POST /api/payments/manual
 * Registrar pago manual (efectivo, transferencia)
 */
payments.post("/manual", requireAuth, requireRole("admin", "user"), async (req, res) => {
  try {
    const {
      appointmentId,
      method, // 'cash' | 'transfer' | 'card' | 'other'
      amount_cents,
      notes = null
    } = req.body;

    if (!appointmentId || !method || !amount_cents) {
      return res.status(400).json({ 
        ok: false, 
        error: "appointmentId, method y amount_cents son requeridos" 
      });
    }

    const tenantId = req.tenant?.id;
    const recordedBy = req.user?.id;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Verificar turno
      const [[appt]] = await conn.query(
        `SELECT id, status FROM appointment WHERE id = ? AND tenant_id = ? FOR UPDATE`,
        [appointmentId, tenantId]
      );

      if (!appt) {
        await conn.rollback();
        return res.status(404).json({ 
          ok: false, 
          error: "Turno no encontrado" 
        });
      }

      // Insertar pago manual
      const [result] = await conn.query(`
        INSERT INTO payment
          (tenant_id, appointment_id, method, amount_cents, currency, recorded_by, notes, 
           mp_payment_status, created_at)
        VALUES (?, ?, ?, ?, 'ARS', ?, ?, 'approved', NOW())
      `, [tenantId, appointmentId, method, Number(amount_cents), recordedBy, notes]);

      // Actualizar turno
      await conn.query(`
        UPDATE appointment
        SET 
          deposit_decimal = ?,
          deposit_paid_at = NOW(),
          hold_until = NULL,
          status = CASE 
            WHEN status = 'pending_deposit' THEN 'deposit_paid'
            ELSE status 
          END
        WHERE id = ? AND tenant_id = ?
      `, [Number(amount_cents) / 100, appointmentId, tenantId]);

      await conn.commit();

      console.log(`✅ [Payments] Pago manual ${result.insertId} registrado para turno ${appointmentId}`);

      res.json({ 
        ok: true, 
        paymentId: result.insertId 
      });

    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

  } catch (error) {
    console.error('❌ [Payments] Error en pago manual:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

/**
 * 🔍 GET /api/payments/status/:appointmentId
 * Verificar estado de pago de un turno
 */
payments.get("/status/:appointmentId", requireAuth, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const tenantId = req.tenant?.id;

    const [[payment]] = await pool.query(`
      SELECT 
        id,
        method,
        mp_preference_id,
        mp_payment_id,
        mp_payment_status,
        amount_cents,
        currency,
        recorded_by,
        notes,
        created_at,
        updated_at
      FROM payment
      WHERE appointment_id = ? AND tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [appointmentId, tenantId]);

    res.json({ 
      ok: true, 
      payment: payment || null
    });

  } catch (error) {
    console.error('❌ [Payments] Error verificando estado:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

/**
 * 📋 GET /api/payments
 * Listar pagos (admin)
 */
payments.get("/", requireRole("admin", "user"), async (req, res) => {
  try {
    const tenantId = req.tenant?.id;
    const { from, to, status, method, page = 1, limit = 50 } = req.query;

    let query = `
      SELECT 
        p.id,
        p.appointment_id,
        p.method,
        p.mp_preference_id,
        p.mp_payment_id,
        p.mp_payment_status,
        p.amount_cents,
        p.currency,
        p.notes,
        p.created_at,
        p.updated_at,
        a.starts_at,
        c.name AS customer_name,
        c.phone_e164 AS customer_phone,
        s.name AS service_name,
        i.name AS instructor_name
      FROM payment p
      LEFT JOIN appointment a ON p.appointment_id = a.id AND a.tenant_id = p.tenant_id
      LEFT JOIN customer c ON a.customer_id = c.id AND c.tenant_id = a.tenant_id
      LEFT JOIN service s ON a.service_id = s.id AND s.tenant_id = a.tenant_id
      LEFT JOIN instructor i ON a.instructor_id = i.id AND i.tenant_id = a.tenant_id
      WHERE p.tenant_id = ?
    `;
    
    const params = [tenantId];

    if (from) {
      query += ' AND p.created_at >= ?';
      params.push(from);
    }
    if (to) {
      query += ' AND p.created_at <= ?';
      params.push(to);
    }
    if (status) {
      query += ' AND p.mp_payment_status = ?';
      params.push(status);
    }
    if (method) {
      query += ' AND p.method = ?';
      params.push(method);
    }

    query += ' ORDER BY p.created_at DESC';

    // Paginación
    const offset = (page - 1) * limit;
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [payments] = await pool.query(query, params);

    // Contar total
    let countQuery = `SELECT COUNT(*) as total FROM payment p WHERE p.tenant_id = ?`;
    const countParams = [tenantId];

    if (from) {
      countQuery += ' AND p.created_at >= ?';
      countParams.push(from);
    }
    if (to) {
      countQuery += ' AND p.created_at <= ?';
      countParams.push(to);
    }
    if (status) {
      countQuery += ' AND p.mp_payment_status = ?';
      countParams.push(status);
    }
    if (method) {
      countQuery += ' AND p.method = ?';
      countParams.push(method);
    }

    const [[countResult]] = await pool.query(countQuery, countParams);
    const total = countResult.total;

    res.json({ 
      ok: true, 
      data: payments.map(p => ({
        ...p,
        amount: p.amount_cents / 100
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('❌ [Payments] Error listando pagos:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

/**
 * 📊 GET /api/payments/stats
 * Estadísticas de pagos
 */
payments.get("/stats", requireRole("admin", "user"), async (req, res) => {
  try {
    const tenantId = req.tenant?.id;
    const { from, to } = req.query;

    let query = `
      SELECT 
        COUNT(*) as total_payments,
        COUNT(DISTINCT appointment_id) as unique_appointments,
        SUM(CASE WHEN mp_payment_status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        SUM(CASE WHEN mp_payment_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN mp_payment_status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
        SUM(CASE WHEN mp_payment_status = 'approved' THEN amount_cents ELSE 0 END) as total_approved_cents,
        SUM(CASE WHEN method = 'cash' THEN amount_cents ELSE 0 END) as total_cash_cents,
        SUM(CASE WHEN method = 'mercadopago' THEN amount_cents ELSE 0 END) as total_mp_cents,
        AVG(CASE WHEN mp_payment_status = 'approved' THEN amount_cents ELSE NULL END) as avg_amount_cents
      FROM payment
      WHERE tenant_id = ?
    `;
    
    const params = [tenantId];

    if (from) {
      query += ' AND created_at >= ?';
      params.push(from);
    }
    if (to) {
      query += ' AND created_at <= ?';
      params.push(to);
    }

    const [[stats]] = await pool.query(query, params);

    res.json({ 
      ok: true, 
      stats: {
        total_payments: Number(stats.total_payments || 0),
        unique_appointments: Number(stats.unique_appointments || 0),
        approved_count: Number(stats.approved_count || 0),
        pending_count: Number(stats.pending_count || 0),
        rejected_count: Number(stats.rejected_count || 0),
        total_approved: Number(stats.total_approved_cents || 0) / 100,
        total_cash: Number(stats.total_cash_cents || 0) / 100,
        total_mercadopago: Number(stats.total_mp_cents || 0) / 100,
        avg_amount: Number(stats.avg_amount_cents || 0) / 100
      }
    });

  } catch (error) {
    console.error('❌ [Payments] Error obteniendo estadísticas:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

/**
 * 🎫 POST /api/payments/create-link
 * Crear link de pago genérico
 */
payments.post("/create-link", requireAuth, requireRole("admin", "staff"), async (req, res) => {
  try {
    const { amount, title, description, customerId, expiresInDays } = req.body;
    const tenantId = req.tenant?.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        ok: false, 
        error: "El monto es requerido y debe ser mayor a 0" 
      });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ 
        ok: false, 
        error: "El título es requerido" 
      });
    }

    const link = await createGenericPaymentLink({
      tenantId,
      amount: Number(amount),
      title: title.trim(),
      description: description?.trim() || null,
      customerId: customerId ? Number(customerId) : null,
      expiresInDays: expiresInDays || 7,
    });

    res.json({
      ok: true,
      data: { link },
    });
  } catch (error) {
    console.error('❌ [Payments] Error creando link de pago:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Error al crear el link de pago" 
    });
  }
});

/**
 * 📱 POST /api/payments/send-whatsapp
 * Enviar link de pago por WhatsApp
 */
payments.post("/send-whatsapp", requireAuth, requireRole("admin", "staff"), async (req, res) => {
  try {
    const { customerId, link, message } = req.body;
    const tenantId = req.tenant?.id;

    if (!customerId) {
      return res.status(400).json({ 
        ok: false, 
        error: "customerId es requerido" 
      });
    }

    if (!link) {
      return res.status(400).json({ 
        ok: false, 
        error: "El link de pago es requerido" 
      });
    }

    // Obtener teléfono del cliente (phone_e164 es el campo en la BD)
    const [[customer]] = await pool.query(
      `SELECT phone_e164, name FROM customer WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [customerId, tenantId]
    );

    if (!customer) {
      return res.status(404).json({ 
        ok: false, 
        error: "Cliente no encontrado" 
      });
    }

    // Usar phone_e164 (es el campo en la BD)
    const phoneNumber = customer.phone_e164;
    
    if (!phoneNumber) {
      return res.status(400).json({ 
        ok: false, 
        error: "El cliente no tiene un número de teléfono registrado. Por favor, actualiza el teléfono del cliente." 
      });
    }

    console.log(`[Payments] Enviando link de pago por WhatsApp - Cliente: ${customer.name}, Teléfono: ${phoneNumber}, Tenant: ${tenantId}`);

    // Construir mensaje
    const defaultMessage = `💳 *Link de pago*\n\nHola ${customer.name || 'cliente'}, te enviamos el link para realizar tu pago:\n\n${link}\n\nUna vez completado el pago, recibirás la confirmación automáticamente.`;
    const finalMessage = message ? `${message}\n\n${link}` : defaultMessage;

    try {
      // Enviar por WhatsApp
      const result = await sendWhatsAppText(phoneNumber, finalMessage, tenantId);
      console.log(`[Payments] ✅ Mensaje enviado por WhatsApp exitosamente:`, result);

      res.json({
        ok: true,
        data: { 
          message: "Link de pago enviado por WhatsApp correctamente",
          phone: phoneNumber,
        },
      });
    } catch (whatsappError) {
      console.error('❌ [Payments] Error específico de WhatsApp:', whatsappError);
      throw whatsappError; // Re-lanzar para que se capture en el catch general
    }
  } catch (error) {
    console.error('❌ [Payments] Error enviando link por WhatsApp:', error);
    console.error('❌ [Payments] Stack trace:', error.stack);
    
    // Mensaje de error más descriptivo
    let errorMessage = "Error al enviar el link por WhatsApp";
    
    if (error.message) {
      errorMessage = error.message;
    } else if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    }
    
    res.status(500).json({ 
      ok: false, 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});
