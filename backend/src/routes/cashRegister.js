// src/routes/cashRegister.js — MULTI-TENANT
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";

export const cashRegister = Router();
cashRegister.use(requireAuth, identifyTenant);

// ============================================
// GET /api/cash-register/closures
// Listar cierres de caja
// ============================================
cashRegister.get("/closures", requireRole("admin", "staff"), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { branchId, from, to, status, limit = 50, offset = 0 } = req.query;

    let sql = `
      SELECT 
        crc.*,
        u.email AS user_email,
        u.email AS user_name,
        tb.name AS branch_name
      FROM cash_register_closure crc
      LEFT JOIN users u ON u.id = crc.user_id
      LEFT JOIN tenant_branch tb ON tb.id = crc.branch_id
      WHERE crc.tenant_id = ?
    `;
    const params = [tenantId];

    if (branchId && branchId !== "" && !isNaN(Number(branchId))) {
      sql += " AND crc.branch_id = ?";
      params.push(Number(branchId));
    }

    if (from) {
      sql += " AND crc.closure_date >= ?";
      params.push(from);
    }

    if (to) {
      sql += " AND crc.closure_date <= ?";
      params.push(to);
    }

    if (status) {
      sql += " AND crc.status = ?";
      params.push(status);
    }

    sql += " ORDER BY crc.closure_date DESC, crc.created_at DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const [closures] = await pool.query(sql, params);

    // Obtener totales para cada cierre
    const closuresWithTotals = await Promise.all(
      closures.map(async (closure) => {
        const [transactions] = await pool.query(
          `SELECT 
            transaction_type,
            payment_method,
            SUM(amount) as total
          FROM cash_register_closure_transaction
          WHERE closure_id = ?
          GROUP BY transaction_type, payment_method`,
          [closure.id]
        );

        return {
          ...closure,
          transactions_summary: transactions,
        };
      })
    );

    res.json({ ok: true, data: closuresWithTotals });
  } catch (err) {
    console.error("[CASH-REGISTER/CLOSURES] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================
// GET /api/cash-register/closures/:id
// Obtener un cierre específico con sus transacciones
// ============================================
cashRegister.get("/closures/:id", requireRole("admin", "staff"), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const closureId = Number(req.params.id);

    const [[closure]] = await pool.query(
      `      SELECT 
        crc.*,
        u.email AS user_email,
        u.email AS user_name,
        tb.name AS branch_name
      FROM cash_register_closure crc
      LEFT JOIN users u ON u.id = crc.user_id
      LEFT JOIN tenant_branch tb ON tb.id = crc.branch_id
      WHERE crc.id = ? AND crc.tenant_id = ?`,
      [closureId, tenantId]
    );

    if (!closure) {
      return res.status(404).json({ ok: false, error: "Cierre no encontrado" });
    }

    // Obtener transacciones
    const [transactions] = await pool.query(
      `SELECT * FROM cash_register_closure_transaction
       WHERE closure_id = ?
       ORDER BY created_at DESC`,
      [closureId]
    );

    res.json({
      ok: true,
      data: {
        ...closure,
        transactions,
      },
    });
  } catch (err) {
    console.error("[CASH-REGISTER/CLOSURE] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================
// POST /api/cash-register/closures
// Crear un nuevo cierre de caja
// ============================================
cashRegister.post("/closures", requireRole("admin", "staff"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant_id;
    const userId = req.user.id;
    const { branchId, closureDate, notes } = req.body;

    const closureDateValue = closureDate || new Date().toISOString().split("T")[0];
    
    // Validar que la fecha no sea futura
    const today = new Date().toISOString().split("T")[0];
    if (closureDateValue > today) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "No se pueden crear cierres para fechas futuras",
      });
    }
    
    // Normalizar branchId: convertir a número o null
    const normalizedBranchId = branchId && branchId !== "" && !isNaN(Number(branchId)) 
      ? Number(branchId) 
      : null;

    // Si hay branchId, verificar que el usuario tenga acceso a esa sucursal
    // Los administradores tienen acceso a todas las sucursales
    if (normalizedBranchId && req.user?.role !== "admin") {
      const mode = req.user?.branch_access_mode || req.user?.branchAccessMode || "all";
      if (mode === "custom") {
        const allowedIds = new Set(
          (req.user?.branch_ids || req.user?.branchIds || []).map((id) => Number(id))
        );
        if (!allowedIds.has(normalizedBranchId)) {
          await conn.rollback();
          return res.status(403).json({
            ok: false,
            error: "No tenés acceso a esta sucursal",
          });
        }
      }
    }

    // Verificar si ya existe un cierre (abierto o cerrado) para esta fecha y sucursal
    const [[existing]] = await conn.query(
      `SELECT id, status FROM cash_register_closure
       WHERE tenant_id = ? 
         AND branch_id ${normalizedBranchId ? "= ?" : "IS NULL"}
         AND closure_date = ?
         AND status IN ('open', 'closed')
       LIMIT 1`,
      normalizedBranchId ? [tenantId, normalizedBranchId, closureDateValue] : [tenantId, closureDateValue]
    );

    if (existing) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: existing.status === 'open' 
          ? "Ya existe un cierre abierto para esta fecha y sucursal"
          : "Ya existe un cierre cerrado para esta fecha y sucursal. Solo un administrador puede anularlo para crear uno nuevo.",
        closure_id: existing.id,
      });
    }

    // Calcular totales esperados basados en facturas y pagos del día
    const totals = await calculateExpectedTotals(
      conn,
      tenantId,
      normalizedBranchId,
      closureDateValue
    );

    // Crear el cierre
    const [result] = await conn.query(
      `INSERT INTO cash_register_closure (
        tenant_id, branch_id, user_id, closure_date, opened_at, status,
        expected_cash, expected_card, expected_transfer, expected_mp,
        total_expected, notes
      ) VALUES (?, ?, ?, ?, NOW(), 'open', ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        normalizedBranchId,
        userId,
        closureDateValue,
        totals.cash || 0,
        totals.card || 0,
        totals.transfer || 0,
        totals.mp || 0,
        totals.total || 0,
        notes || null,
      ]
    );

    const closureId = result.insertId;

    // Insertar transacciones esperadas
    if (totals.transactions && totals.transactions.length > 0) {
      const transactionValues = totals.transactions.map((t) => [
        closureId,
        t.transaction_type,
        t.payment_method,
        t.amount,
        t.description,
        t.reference_id,
        t.reference_type,
      ]);

      await conn.query(
        `INSERT INTO cash_register_closure_transaction (
          closure_id, transaction_type, payment_method, amount,
          description, reference_id, reference_type
        ) VALUES ?`,
        [transactionValues]
      );
    }

    await conn.commit();

    // Obtener el cierre completo
    const [[closure]] = await pool.query(
      `SELECT 
        crc.*,
        u.email AS user_email,
        u.email AS user_name,
        tb.name AS branch_name
      FROM cash_register_closure crc
      LEFT JOIN users u ON u.id = crc.user_id
      LEFT JOIN tenant_branch tb ON tb.id = crc.branch_id
      WHERE crc.id = ?`,
      [closureId]
    );

    res.status(201).json({ ok: true, data: closure });
  } catch (err) {
    await conn.rollback();
    console.error("[CASH-REGISTER/CREATE] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ============================================
// GET /api/cash-register/expected-totals
// Calcular totales esperados para una fecha y sucursal sin crear el cierre
// ============================================
cashRegister.get("/expected-totals", requireRole("admin", "staff"), async (req, res) => {
  try {
    const tenantId = req.tenant_id;
    const { date, branchId } = req.query;

    if (!date) {
      return res.status(400).json({
        ok: false,
        error: "La fecha es requerida",
      });
    }

    const closureDate = date.toString().slice(0, 10);
    
    // Normalizar branchId: convertir a número o null
    const normalizedBranchId = branchId && branchId !== "" && !isNaN(Number(branchId)) 
      ? Number(branchId) 
      : null;

    // Si hay branchId, verificar que el usuario tenga acceso a esa sucursal
    // Los administradores tienen acceso a todas las sucursales
    if (normalizedBranchId && req.user?.role !== "admin") {
      const mode = req.user?.branch_access_mode || req.user?.branchAccessMode || "all";
      if (mode === "custom") {
        const allowedIds = new Set(
          (req.user?.branch_ids || req.user?.branchIds || []).map((id) => Number(id))
        );
        if (!allowedIds.has(normalizedBranchId)) {
          return res.status(403).json({
            ok: false,
            error: "No tenés acceso a esta sucursal",
          });
        }
      }
    }

    // Calcular totales esperados
    const conn = await pool.getConnection();
    try {
      const totals = await calculateExpectedTotals(
        conn,
        tenantId,
        normalizedBranchId,
        closureDate
      );
      conn.release();
      
      res.json({
        ok: true,
        data: {
          expected_cash: totals.cash || 0,
          expected_card: totals.card || 0,
          expected_transfer: totals.transfer || 0,
          expected_mp: totals.mp || 0,
          total_expected: totals.total || 0,
        },
      });
    } catch (err) {
      conn.release();
      throw err;
    }
  } catch (err) {
    console.error("[CASH-REGISTER/EXPECTED-TOTALS] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================
// PUT /api/cash-register/closures/:id/close
// Cerrar un cierre de caja
// ============================================
cashRegister.put("/closures/:id/close", requireRole("admin", "staff"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant_id;
    const closureId = Number(req.params.id);
    const {
      actual_cash,
      actual_card,
      actual_transfer,
      actual_mp,
      expenses,
      notes,
    } = req.body;

    // Verificar que el cierre existe y está abierto
    const [[closure]] = await conn.query(
      `SELECT * FROM cash_register_closure
       WHERE id = ? AND tenant_id = ? AND status = 'open'
       FOR UPDATE`,
      [closureId, tenantId]
    );

    if (!closure) {
      await conn.rollback();
      return res.status(404).json({
        ok: false,
        error: "Cierre no encontrado o ya está cerrado",
      });
    }

    // Calcular diferencias
    const cashDiff = (actual_cash || 0) - (closure.expected_cash || 0);
    const cardDiff = (actual_card || 0) - (closure.expected_card || 0);
    const transferDiff = (actual_transfer || 0) - (closure.expected_transfer || 0);
    const mpDiff = (actual_mp || 0) - (closure.expected_mp || 0);

    const totalActual =
      (actual_cash || 0) +
      (actual_card || 0) +
      (actual_transfer || 0) +
      (actual_mp || 0);
    const totalExpected = closure.total_expected || 0;
    const totalDiff = totalActual - totalExpected;

    // Actualizar el cierre
    await conn.query(
      `UPDATE cash_register_closure SET
        status = 'closed',
        closed_at = NOW(),
        actual_cash = ?,
        actual_card = ?,
        actual_transfer = ?,
        actual_mp = ?,
        cash_difference = ?,
        card_difference = ?,
        transfer_difference = ?,
        mp_difference = ?,
        total_actual = ?,
        total_difference = ?,
        expenses = ?,
        notes = COALESCE(?, notes),
        updated_at = NOW()
      WHERE id = ?`,
      [
        actual_cash || 0,
        actual_card || 0,
        actual_transfer || 0,
        actual_mp || 0,
        cashDiff,
        cardDiff,
        transferDiff,
        mpDiff,
        totalActual,
        totalDiff,
        expenses || 0,
        notes,
        closureId,
      ]
    );

    await conn.commit();

    // Obtener el cierre actualizado
    const [[updatedClosure]] = await pool.query(
      `SELECT 
        crc.*,
        u.email AS user_email,
        u.email AS user_name,
        tb.name AS branch_name
      FROM cash_register_closure crc
      LEFT JOIN users u ON u.id = crc.user_id
      LEFT JOIN tenant_branch tb ON tb.id = crc.branch_id
      WHERE crc.id = ?`,
      [closureId]
    );

    res.json({ ok: true, data: updatedClosure });
  } catch (err) {
    await conn.rollback();
    console.error("[CASH-REGISTER/CLOSE] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ============================================
// PUT /api/cash-register/closures/:id/cancel
// Anular un cierre de caja (solo admin)
// ============================================
cashRegister.put("/closures/:id/cancel", requireRole("admin"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = req.tenant_id;
    const closureId = Number(req.params.id);

    // Verificar que el cierre existe y pertenece al tenant
    const [[closure]] = await conn.query(
      `SELECT * FROM cash_register_closure
       WHERE id = ? AND tenant_id = ?
       FOR UPDATE`,
      [closureId, tenantId]
    );

    if (!closure) {
      await conn.rollback();
      return res.status(404).json({
        ok: false,
        error: "Cierre no encontrado",
      });
    }

    // Solo se pueden anular cierres abiertos o cerrados (no los ya cancelados)
    if (closure.status === "cancelled") {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "Este cierre ya está cancelado",
      });
    }

    // Actualizar el estado a cancelado
    await conn.query(
      `UPDATE cash_register_closure SET
        status = 'cancelled',
        updated_at = NOW()
      WHERE id = ?`,
      [closureId]
    );

    await conn.commit();

    // Obtener el cierre actualizado
    const [[updatedClosure]] = await pool.query(
      `SELECT 
        crc.*,
        u.email AS user_email,
        u.email AS user_name,
        tb.name AS branch_name
      FROM cash_register_closure crc
      LEFT JOIN users u ON u.id = crc.user_id
      LEFT JOIN tenant_branch tb ON tb.id = crc.branch_id
      WHERE crc.id = ?`,
      [closureId]
    );

    res.json({ ok: true, data: updatedClosure });
  } catch (err) {
    await conn.rollback();
    console.error("[CASH-REGISTER/CANCEL] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ============================================
// POST /api/cash-register/closures/:id/transactions
// Agregar una transacción manual al cierre
// ============================================
cashRegister.post(
  "/closures/:id/transactions",
  requireRole("admin", "staff"),
  async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const tenantId = req.tenant_id;
      const closureId = Number(req.params.id);
      const { transaction_type, payment_method, amount, description } = req.body;

      // Verificar que el cierre existe y está abierto
      const [[closure]] = await conn.query(
        `SELECT * FROM cash_register_closure
         WHERE id = ? AND tenant_id = ? AND status = 'open'
         FOR UPDATE`,
        [closureId, tenantId]
      );

      if (!closure) {
        await conn.rollback();
        return res.status(404).json({
          ok: false,
          error: "Cierre no encontrado o ya está cerrado",
        });
      }

      // Insertar transacción
      const [result] = await conn.query(
        `INSERT INTO cash_register_closure_transaction (
          closure_id, transaction_type, payment_method, amount,
          description, reference_type
        ) VALUES (?, ?, ?, ?, ?, 'manual')`,
        [closureId, transaction_type, payment_method, amount, description]
      );

      // Actualizar totales esperados del cierre
      await updateClosureTotals(conn, closureId);

      await conn.commit();

      const [[transaction]] = await pool.query(
        `SELECT * FROM cash_register_closure_transaction WHERE id = ?`,
        [result.insertId]
      );

      res.status(201).json({ ok: true, data: transaction });
    } catch (err) {
      await conn.rollback();
      console.error("[CASH-REGISTER/TRANSACTION] error:", err);
      res.status(500).json({ ok: false, error: err.message });
    } finally {
      conn.release();
    }
  }
);

// ============================================
// Helper: Calcular totales esperados
// ============================================
async function calculateExpectedTotals(conn, tenantId, branchId, closureDate) {
  const totals = {
    cash: 0,
    card: 0,
    transfer: 0,
    mp: 0,
    total: 0,
    transactions: [],
  };

  try {
    // Obtener todos los pagos del día desde la tabla payment
    // Esto incluye pagos de Mercado Pago y pagos manuales registrados
    let paymentSql = `
      SELECT 
        p.id,
        p.appointment_id,
        p.method,
        p.amount_cents,
        p.mp_payment_status,
        p.created_at,
        a.branch_id,
        a.deposit_decimal,
        a.deposit_paid_at
      FROM payment p
      LEFT JOIN appointment a ON a.id = p.appointment_id AND a.tenant_id = p.tenant_id
      WHERE p.tenant_id = ?
        AND DATE(p.created_at) = ?
        AND (p.mp_payment_status = 'approved' OR p.method = 'manual')
    `;
    const paymentParams = [tenantId, closureDate];

    if (branchId) {
      paymentSql += " AND (a.branch_id = ? OR a.branch_id IS NULL)";
      paymentParams.push(branchId);
    }

    const [payments] = await conn.query(paymentSql, paymentParams);

    // Procesar cada pago y agrupar por método
    payments.forEach((payment) => {
      const amount = Number(payment.amount_cents || 0) / 100; // Convertir de centavos a decimal
      let method = "cash"; // Por defecto efectivo

      // Determinar método de pago basándose en el campo method de la tabla payment
      if (payment.method === "mercadopago") {
        method = "mp";
      } else if (payment.method === "cash") {
        method = "cash";
      } else if (payment.method === "card") {
        method = "card";
      } else if (payment.method === "transfer") {
        method = "transfer";
      } else if (payment.method === "manual") {
        // Los pagos marcados como "manual" desde depositsAdmin se consideran efectivo
        // (cuando se marca una seña como pagada sin especificar método)
        method = "cash";
      } else {
        // Para otros métodos (other, etc.), asumimos efectivo
        method = "cash";
      }

      // Agregar al total correspondiente
      if (method === "cash") {
        totals.cash += amount;
      } else if (method === "card") {
        totals.card += amount;
      } else if (method === "transfer") {
        totals.transfer += amount;
      } else if (method === "mp") {
        totals.mp += amount;
      }

      totals.total += amount;

      totals.transactions.push({
        transaction_type: "income",
        payment_method: method,
        amount,
        description: payment.appointment_id
          ? `Pago turno #${payment.appointment_id}`
          : `Pago #${payment.id}`,
        reference_id: payment.appointment_id || payment.id,
        reference_type: payment.appointment_id ? "appointment" : "payment",
      });
    });

    // También obtener facturas del día que no tengan pago asociado
    // (para casos donde se facturó pero no se registró el pago en payment)
    let invoiceSql = `
      SELECT 
        i.id,
        i.importe_total,
        i.created_at,
        a.branch_id,
        a.id AS appointment_id
      FROM invoice i
      LEFT JOIN appointment a ON a.id = i.appointment_id AND a.tenant_id = i.tenant_id
      LEFT JOIN payment p ON p.appointment_id = a.id AND p.tenant_id = i.tenant_id 
        AND DATE(p.created_at) = ? AND (p.mp_payment_status = 'approved' OR p.method = 'manual')
      WHERE i.tenant_id = ?
        AND DATE(i.created_at) = ?
        AND p.id IS NULL
    `;
    const invoiceParams = [closureDate, tenantId, closureDate];

    if (branchId) {
      invoiceSql += " AND (a.branch_id = ? OR a.branch_id IS NULL)";
      invoiceParams.push(branchId);
    }

    const [invoices] = await conn.query(invoiceSql, invoiceParams);

    // Las facturas sin pago asociado se consideran efectivo
    invoices.forEach((inv) => {
      const amount = Number(inv.importe_total || 0);
      const method = "cash";

      totals.cash += amount;
      totals.total += amount;

      totals.transactions.push({
        transaction_type: "income",
        payment_method: method,
        amount,
        description: `Factura #${inv.id}`,
        reference_id: inv.id,
        reference_type: "invoice",
      });
    });
  } catch (err) {
    console.error("[calculateExpectedTotals] error:", err);
  }

  return totals;
}

// ============================================
// Helper: Actualizar totales del cierre
// ============================================
async function updateClosureTotals(conn, closureId) {
  const [transactions] = await conn.query(
    `SELECT 
      transaction_type,
      payment_method,
      SUM(amount) as total
    FROM cash_register_closure_transaction
    WHERE closure_id = ?
    GROUP BY transaction_type, payment_method`,
    [closureId]
  );

  const totals = {
    cash: 0,
    card: 0,
    transfer: 0,
    mp: 0,
    total: 0,
  };

  transactions.forEach((t) => {
    if (t.transaction_type === "income") {
      const amount = Number(t.total || 0);
      totals[t.payment_method] += amount;
      totals.total += amount;
    } else if (t.transaction_type === "expense") {
      const amount = Number(t.total || 0);
      totals[t.payment_method] -= amount;
      totals.total -= amount;
    }
  });

  await conn.query(
    `UPDATE cash_register_closure SET
      expected_cash = ?,
      expected_card = ?,
      expected_transfer = ?,
      expected_mp = ?,
      total_expected = ?,
      updated_at = NOW()
    WHERE id = ?`,
    [totals.cash, totals.card, totals.transfer, totals.mp, totals.total, closureId]
  );
}

// Export ya está hecho arriba con export const cashRegister

