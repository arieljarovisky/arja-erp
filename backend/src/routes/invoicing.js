// src/routes/invoicing.js — MULTI-TENANT
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import {
  generarFactura,
  consultarFactura,
  generarNotaCredito,
  verificarConexion,
  calcularIVA,
  determinarTipoComprobante,
  validarDatosFacturacion,
  COMPROBANTE_TIPOS,
  DOCUMENTO_TIPOS,
  CONCEPTOS,
  CONDICIONES_IVA,
} from "../services/arca.js";

export const invoicing = Router();
invoicing.use(requireAuth, requireRole("admin", "staff", "user"));

// ============================================
// HEALTH CHECK ARCA
// ============================================
invoicing.get("/health", async (req, res) => {
  try {
    const status = await verificarConexion();
    res.json({ ok: true, arca: status });
  } catch (err) {
    console.error("[INVOICING/HEALTH] error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================
// GENERAR FACTURA PARA UN TURNO
// ============================================
invoicing.post("/appointment/:id", async (req, res) => {
  const conn = await pool.getConnection();
  const tenantId = req.tenant.id;

  try {
    await conn.beginTransaction();

    const appointmentId = Number(req.params.id);

    // 1. Verificar que el turno exista en este tenant
    const [[appt]] = await conn.query(
      `SELECT 
        a.id,
        a.status,
        a.starts_at,
        c.id AS customer_id,
        c.name AS customer_name,
        c.phone_e164,
        c.documento,
        c.tipo_documento,
        c.cuit,
        c.domicilio,
        c.condicion_iva,
        s.id AS service_id,
        s.name AS service_name,
        s.price_decimal,
        st.name AS instructor_name
      FROM appointment a
      JOIN customer c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
      JOIN service  s ON s.id = a.service_id  AND s.tenant_id = a.tenant_id
      JOIN instructor  st ON st.id = a.instructor_id AND st.tenant_id = a.tenant_id
      WHERE a.id = ? AND a.tenant_id = ?
      FOR UPDATE`,
      [appointmentId, tenantId]
    );

    if (!appt) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Turno no encontrado" });
    }

    // 2. Verificar si ya tiene factura
    const [[existing]] = await conn.query(
      `SELECT id FROM invoice WHERE appointment_id = ? AND tenant_id = ? LIMIT 1`,
      [appointmentId, tenantId]
    );

    if (existing) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "Este turno ya tiene una factura generada",
        invoice_id: existing.id,
      });
    }

    // 3. Validar datos del cliente
    const validacion = validarDatosFacturacion({
      razon_social: appt.customer_name,
      documento: appt.documento,
      cuit: appt.cuit,
      condicion_iva: appt.condicion_iva,
    });

    if (!validacion.valid) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "Datos insuficientes para facturar",
        errors: validacion.errors,
      });
    }

    // 4. Tipo de comprobante
    const tipoComprobante = determinarTipoComprobante(
      appt.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL
    );

    // 5. Calcular IVA
    const precio = Number(appt.price_decimal || 0);
    const { neto, iva, total } = calcularIVA(precio);

    // 6. Payload para Arca
    const facturaParams = {
      tipo_comprobante: tipoComprobante,
      concepto: CONCEPTOS.SERVICIOS,
      tipo_doc_cliente: appt.tipo_documento || DOCUMENTO_TIPOS.DNI,
      doc_cliente: appt.documento || "",
      cuit_cliente: appt.cuit || null,
      razon_social: appt.customer_name || "Consumidor Final",
      domicilio: appt.domicilio || "Sin domicilio",
      condicion_iva: appt.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL,
      items: [
        {
          descripcion: `${appt.service_name} - ${appt.instructor_name}`,
          cantidad: 1,
          precio_unitario: neto,
          alicuota_iva: 21,
          codigo: `SVC-${appt.service_id}`,
        },
      ],
      importe_neto: neto,
      importe_iva: iva,
      importe_total: total,
      referencia_interna: `APPT-${appointmentId}`,
      observaciones: `Turno #${appointmentId} - Fecha: ${appt.starts_at}`,
    };

    const arcaResponse = await generarFactura(facturaParams);
    if (!arcaResponse.success) throw new Error("Arca no pudo generar la factura");

    // 7. Insert factura en DB (con tenant)
    const [invoiceResult] = await conn.query(
      `INSERT INTO invoice (
        tenant_id,
        appointment_id,
        customer_id,
        tipo_comprobante,
        punto_venta,
        numero_comprobante,
        cae,
        vto_cae,
        fecha_emision,
        importe_neto,
        importe_iva,
        importe_total,
        items,
        pdf_url,
        xml_url,
        status,
        arca_hash,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        tenantId,
        appointmentId,
        appt.customer_id,
        arcaResponse.tipo_comprobante,
        arcaResponse.punto_venta,
        arcaResponse.numero,
        arcaResponse.cae,
        arcaResponse.vto_cae,
        arcaResponse.fecha_emision,
        neto,
        iva,
        total,
        JSON.stringify(facturaParams.items || []),
        arcaResponse.pdf_url,
        arcaResponse.xml_url,
        'approved',
        arcaResponse.hash,
      ]
    );

    const invoiceId = invoiceResult.insertId;

    // 8. Marcar turno como facturado
    await conn.query(
      `UPDATE appointment SET invoiced = 1 WHERE id = ? AND tenant_id = ?`,
      [appointmentId, tenantId]
    );

    await conn.commit();

    res.json({
      ok: true,
      invoice_id: invoiceId,
      cae: arcaResponse.cae,
      numero: arcaResponse.numero,
      tipo_comprobante: arcaResponse.tipo_comprobante,
      punto_venta: arcaResponse.punto_venta,
      total,
      pdf_url: arcaResponse.pdf_url,
    });
  } catch (err) {
    await conn.rollback();
    console.error("[INVOICING] Error generando factura:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ============================================
// CONSULTAR FACTURA
// ============================================
invoicing.get("/invoice/:id", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const invoiceId = Number(req.params.id);

    const [[invoice]] = await pool.query(
      `SELECT 
        i.*, a.starts_at, c.name AS customer_name, c.documento, s.name AS service_name
       FROM invoice i
       LEFT JOIN appointment a ON a.id = i.appointment_id AND a.tenant_id=i.tenant_id
       LEFT JOIN customer c ON c.id = i.customer_id AND c.tenant_id=i.tenant_id
       LEFT JOIN service  s ON s.id = a.service_id AND s.tenant_id=i.tenant_id
      WHERE i.id = ? AND i.tenant_id = ?`,
      [invoiceId, tenantId]
    );

    if (!invoice)
      return res.status(404).json({ ok: false, error: "Factura no encontrada" });

    res.json({ ok: true, data: invoice });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================
// LISTAR FACTURAS (scopiadas al tenant)
// ============================================
invoicing.get("/invoices", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { from, to, customerId, limit = 50, offset = 0 } = req.query;

    let sql = `
      SELECT i.*,
        CASE WHEN i.tipo_comprobante IN (3, 8, 13) THEN 1 ELSE 0 END AS is_credit_note,
        CASE
          WHEN i.tipo_comprobante IN (3, 8, 13) THEN 'credit_note'
          WHEN i.tipo_comprobante IN (1, 6, 11) THEN 'invoice'
          ELSE 'other'
        END AS comprobante_categoria,
        a.starts_at,
        c.name AS customer_name,
        c.documento,
        s.name AS service_name
      FROM invoice i
      LEFT JOIN appointment a ON a.id=i.appointment_id AND a.tenant_id=i.tenant_id
      LEFT JOIN customer c ON c.id=i.customer_id AND c.tenant_id=i.tenant_id
      LEFT JOIN service s ON s.id=a.service_id AND s.tenant_id=i.tenant_id
      WHERE i.tenant_id = ?
    `;
    const params = [tenantId];

    if (from) { sql += " AND i.fecha_emision >= ?"; params.push(`${from} 00:00:00`); }
    if (to)   { sql += " AND i.fecha_emision <= ?"; params.push(`${to} 23:59:59`); }
    if (customerId) { sql += " AND i.customer_id = ?"; params.push(Number(customerId)); }

    sql += " ORDER BY i.created_at DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const [invoices] = await pool.query(sql, params);
    res.json({ ok: true, data: invoices });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================
// GENERAR FACTURA PARA UNA CLASE COMPLETA
// ============================================
invoicing.post("/class/:id", async (req, res) => {
  const conn = await pool.getConnection();
  const tenantId = req.tenant.id;

  try {
    await conn.beginTransaction();

    const classSessionId = Number(req.params.id);
    const { customer_id } = req.body; // Cliente que paga la clase completa

    if (!customer_id) {
      await conn.rollback();
      return res.status(400).json({ ok: false, error: "Se requiere customer_id para facturar la clase completa" });
    }

    // 1. Verificar que la clase exista
    const [[classSession]] = await conn.query(
      `SELECT 
        cs.id,
        cs.starts_at,
        cs.ends_at,
        cs.price_decimal,
        cs.status,
        st.id AS instructor_id,
        st.name AS instructor_name,
        s.id AS service_id,
        s.name AS service_name,
        ct.name AS template_name
      FROM class_session cs
      JOIN instructor st ON st.id = cs.instructor_id AND st.tenant_id = cs.tenant_id
      LEFT JOIN service s ON s.id = cs.service_id AND s.tenant_id = cs.tenant_id
      LEFT JOIN class_template ct ON ct.id = cs.template_id AND ct.tenant_id = cs.tenant_id
      WHERE cs.id = ? AND cs.tenant_id = ?
      FOR UPDATE`,
      [classSessionId, tenantId]
    );

    if (!classSession) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Clase no encontrada" });
    }

    // 2. Verificar si ya tiene factura completa
    const [[existing]] = await conn.query(
      `SELECT id FROM invoice WHERE class_session_id = ? AND tenant_id = ? AND enrollment_id IS NULL LIMIT 1`,
      [classSessionId, tenantId]
    );

    if (existing) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "Esta clase ya tiene una factura completa generada",
        invoice_id: existing.id,
      });
    }

    // 3. Obtener datos del cliente
    const [[customer]] = await conn.query(
      `SELECT 
        id,
        name AS customer_name,
        phone_e164,
        documento,
        tipo_documento,
        cuit,
        domicilio,
        condicion_iva
      FROM customer
      WHERE id = ? AND tenant_id = ?`,
      [customer_id, tenantId]
    );

    if (!customer) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    }

    // 4. Validar datos del cliente
    const validacion = validarDatosFacturacion({
      razon_social: customer.customer_name,
      documento: customer.documento,
      cuit: customer.cuit,
      condicion_iva: customer.condicion_iva,
    });

    if (!validacion.valid) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "Datos insuficientes para facturar",
        errors: validacion.errors,
      });
    }

    // 5. Tipo de comprobante
    const tipoComprobante = determinarTipoComprobante(
      customer.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL
    );

    // 6. Calcular IVA
    const precio = Number(classSession.price_decimal || 0);
    const { neto, iva, total } = calcularIVA(precio);

    // 7. Payload para Arca
    const serviceName = classSession.service_name || classSession.template_name || "Clase";
    const facturaParams = {
      tipo_comprobante: tipoComprobante,
      concepto: CONCEPTOS.SERVICIOS,
      tipo_doc_cliente: customer.tipo_documento || DOCUMENTO_TIPOS.DNI,
      doc_cliente: customer.documento || "",
      cuit_cliente: customer.cuit || null,
      razon_social: customer.customer_name || "Consumidor Final",
      domicilio: customer.domicilio || "Sin domicilio",
      condicion_iva: customer.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL,
      items: [
        {
          descripcion: `${serviceName} - ${classSession.instructor_name} (Clase completa)`,
          cantidad: 1,
          precio_unitario: neto,
          alicuota_iva: 21,
          codigo: `CLASS-${classSessionId}`,
        },
      ],
      importe_neto: neto,
      importe_iva: iva,
      importe_total: total,
      referencia_interna: `CLASS-${classSessionId}`,
      observaciones: `Clase #${classSessionId} - Fecha: ${classSession.starts_at}`,
    };

    const arcaResponse = await generarFactura(facturaParams);
    if (!arcaResponse.success) throw new Error("Arca no pudo generar la factura");

    // 8. Insert factura en DB (intentar con class_session_id, si no existe será NULL)
    const [invoiceResult] = await conn.query(
      `INSERT INTO invoice (
        tenant_id,
        class_session_id,
        customer_id,
        tipo_comprobante,
        punto_venta,
        numero_comprobante,
        cae,
        vto_cae,
        fecha_emision,
        importe_neto,
        importe_iva,
        importe_total,
        items,
        pdf_url,
        xml_url,
        status,
        arca_hash,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        tenantId,
        classSessionId,
        customer.id,
        arcaResponse.tipo_comprobante,
        arcaResponse.punto_venta,
        arcaResponse.numero,
        arcaResponse.cae,
        arcaResponse.vto_cae,
        arcaResponse.fecha_emision,
        neto,
        iva,
        total,
        JSON.stringify(facturaParams.items || []),
        arcaResponse.pdf_url,
        arcaResponse.xml_url,
        'approved',
        arcaResponse.hash,
      ]
    ).catch(async (err) => {
      // Si la columna no existe, intentar sin class_session_id
      if (err.code === 'ER_BAD_FIELD_ERROR' || err.message?.includes('class_session_id')) {
        console.warn("[INVOICING] class_session_id no existe, usando solo customer_id");
        return await conn.query(
          `INSERT INTO invoice (
            tenant_id,
            customer_id,
            tipo_comprobante,
            punto_venta,
            numero_comprobante,
            cae,
            vto_cae,
            fecha_emision,
            importe_neto,
            importe_iva,
            importe_total,
            items,
            pdf_url,
            xml_url,
            status,
            arca_hash,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            tenantId,
            customer.id,
            arcaResponse.tipo_comprobante,
            arcaResponse.punto_venta,
            arcaResponse.numero,
            arcaResponse.cae,
            arcaResponse.vto_cae,
            arcaResponse.fecha_emision,
            neto,
            iva,
            total,
            JSON.stringify(facturaParams.items || []),
            arcaResponse.pdf_url,
            arcaResponse.xml_url,
            'approved',
            arcaResponse.hash,
          ]
        );
      }
      throw err;
    });

    const invoiceId = invoiceResult.insertId;

    await conn.commit();

    res.json({
      ok: true,
      invoice_id: invoiceId,
      cae: arcaResponse.cae,
      numero: arcaResponse.numero,
      tipo_comprobante: arcaResponse.tipo_comprobante,
      punto_venta: arcaResponse.punto_venta,
      total,
      pdf_url: arcaResponse.pdf_url,
    });
  } catch (err) {
    await conn.rollback();
    console.error("[INVOICING] Error generando factura de clase:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ============================================
// GENERAR FACTURA PARA UN ENROLLMENT (ALUMNO)
// ============================================
invoicing.post("/enrollment/:id", async (req, res) => {
  const conn = await pool.getConnection();
  const tenantId = req.tenant.id;

  try {
    await conn.beginTransaction();

    const enrollmentId = Number(req.params.id);

    // 1. Verificar que el enrollment exista y obtener datos
    const [[enrollment]] = await conn.query(
      `SELECT 
        ce.id AS enrollment_id,
        ce.status AS enrollment_status,
        ce.session_id,
        c.id AS customer_id,
        c.name AS customer_name,
        c.phone_e164,
        c.documento,
        c.tipo_documento,
        c.cuit,
        c.domicilio,
        c.condicion_iva,
        cs.starts_at,
        cs.ends_at,
        cs.price_decimal AS class_price,
        cs.status AS class_status,
        st.id AS instructor_id,
        st.name AS instructor_name,
        s.id AS service_id,
        s.name AS service_name,
        ct.name AS template_name
      FROM class_enrollment ce
      JOIN customer c ON c.id = ce.customer_id AND c.tenant_id = ce.tenant_id
      JOIN class_session cs ON cs.id = ce.session_id AND cs.tenant_id = ce.tenant_id
      JOIN instructor st ON st.id = cs.instructor_id AND st.tenant_id = cs.tenant_id
      LEFT JOIN service s ON s.id = cs.service_id AND s.tenant_id = cs.tenant_id
      LEFT JOIN class_template ct ON ct.id = cs.template_id AND ct.tenant_id = cs.tenant_id
      WHERE ce.id = ? AND ce.tenant_id = ?
      FOR UPDATE`,
      [enrollmentId, tenantId]
    );

    if (!enrollment) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Inscripción no encontrada" });
    }

    // 2. Verificar si ya tiene factura
    const [[existing]] = await conn.query(
      `SELECT id FROM invoice WHERE enrollment_id = ? AND tenant_id = ? LIMIT 1`,
      [enrollmentId, tenantId]
    ).catch(() => {
      // Si la columna no existe, verificar por class_session_id y customer_id
      return conn.query(
        `SELECT id FROM invoice WHERE class_session_id = ? AND customer_id = ? AND tenant_id = ? LIMIT 1`,
        [enrollment.session_id, enrollment.customer_id, tenantId]
      );
    });

    if (existing && existing.length > 0) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "Este alumno ya tiene una factura generada para esta clase",
        invoice_id: existing[0]?.id || existing.id,
      });
    }

    // 3. Validar datos del cliente
    const validacion = validarDatosFacturacion({
      razon_social: enrollment.customer_name,
      documento: enrollment.documento,
      cuit: enrollment.cuit,
      condicion_iva: enrollment.condicion_iva,
    });

    if (!validacion.valid) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "Datos insuficientes para facturar",
        errors: validacion.errors,
      });
    }

    // 4. Tipo de comprobante
    const tipoComprobante = determinarTipoComprobante(
      enrollment.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL
    );

    // 5. Calcular IVA - El precio puede venir del enrollment o de la clase
    // Si no hay precio específico en el enrollment, usar el precio de la clase
    const precio = Number(enrollment.class_price || 0);
    const { neto, iva, total } = calcularIVA(precio);

    // 6. Payload para Arca
    const serviceName = enrollment.service_name || enrollment.template_name || "Clase";
    const facturaParams = {
      tipo_comprobante: tipoComprobante,
      concepto: CONCEPTOS.SERVICIOS,
      tipo_doc_cliente: enrollment.tipo_documento || DOCUMENTO_TIPOS.DNI,
      doc_cliente: enrollment.documento || "",
      cuit_cliente: enrollment.cuit || null,
      razon_social: enrollment.customer_name || "Consumidor Final",
      domicilio: enrollment.domicilio || "Sin domicilio",
      condicion_iva: enrollment.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL,
      items: [
        {
          descripcion: `${serviceName} - ${enrollment.instructor_name}`,
          cantidad: 1,
          precio_unitario: neto,
          alicuota_iva: 21,
          codigo: `ENROLL-${enrollmentId}`,
        },
      ],
      importe_neto: neto,
      importe_iva: iva,
      importe_total: total,
      referencia_interna: `ENROLL-${enrollmentId}`,
      observaciones: `Clase #${enrollment.session_id} - Alumno: ${enrollment.customer_name} - Fecha: ${enrollment.starts_at}`,
    };

    const arcaResponse = await generarFactura(facturaParams);
    if (!arcaResponse.success) throw new Error("Arca no pudo generar la factura");

    // 7. Insert factura en DB (intentar con enrollment_id y class_session_id)
    const [invoiceResult] = await conn.query(
      `INSERT INTO invoice (
        tenant_id,
        class_session_id,
        enrollment_id,
        customer_id,
        tipo_comprobante,
        punto_venta,
        numero_comprobante,
        cae,
        vto_cae,
        fecha_emision,
        importe_neto,
        importe_iva,
        importe_total,
        items,
        pdf_url,
        xml_url,
        status,
        arca_hash,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        tenantId,
        enrollment.session_id,
        enrollmentId,
        enrollment.customer_id,
        arcaResponse.tipo_comprobante,
        arcaResponse.punto_venta,
        arcaResponse.numero,
        arcaResponse.cae,
        arcaResponse.vto_cae,
        arcaResponse.fecha_emision,
        neto,
        iva,
        total,
        JSON.stringify(facturaParams.items || []),
        arcaResponse.pdf_url,
        arcaResponse.xml_url,
        'approved',
        arcaResponse.hash,
      ]
    ).catch(async (err) => {
      // Si las columnas no existen, intentar sin ellas
      if (err.code === 'ER_BAD_FIELD_ERROR' || err.message?.includes('class_session_id') || err.message?.includes('enrollment_id')) {
        console.warn("[INVOICING] class_session_id o enrollment_id no existen, usando solo customer_id");
        return await conn.query(
          `INSERT INTO invoice (
            tenant_id,
            customer_id,
            tipo_comprobante,
            punto_venta,
            numero_comprobante,
            cae,
            vto_cae,
            fecha_emision,
            importe_neto,
            importe_iva,
            importe_total,
            items,
            pdf_url,
            xml_url,
            status,
            arca_hash,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            tenantId,
            enrollment.customer_id,
            arcaResponse.tipo_comprobante,
            arcaResponse.punto_venta,
            arcaResponse.numero,
            arcaResponse.cae,
            arcaResponse.vto_cae,
            arcaResponse.fecha_emision,
            neto,
            iva,
            total,
            JSON.stringify(facturaParams.items || []),
            arcaResponse.pdf_url,
            arcaResponse.xml_url,
            'approved',
            arcaResponse.hash,
          ]
        );
      }
      throw err;
    });

    const invoiceId = invoiceResult.insertId;

    await conn.commit();

    res.json({
      ok: true,
      invoice_id: invoiceId,
      cae: arcaResponse.cae,
      numero: arcaResponse.numero,
      tipo_comprobante: arcaResponse.tipo_comprobante,
      punto_venta: arcaResponse.punto_venta,
      total,
      pdf_url: arcaResponse.pdf_url,
    });
  } catch (err) {
    await conn.rollback();
    console.error("[INVOICING] Error generando factura de enrollment:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ============================================
// GENERAR FACTURA PARA UNA MEMBRESÍA (SUBSCRIPTION)
// ============================================
invoicing.post("/membership/:id", async (req, res) => {
  const conn = await pool.getConnection();
  const tenantId = req.tenant.id;

  try {
    await conn.beginTransaction();

    const subscriptionId = Number(req.params.id);

    // 1. Verificar que la suscripción exista
    const [[subscription]] = await conn.query(
      `SELECT 
        cs.id,
        cs.customer_id,
        cs.amount_decimal,
        cs.reason,
        cs.membership_plan_id,
        cs.status,
        cs.created_at,
        c.name AS customer_name,
        c.phone_e164,
        c.documento,
        c.tipo_documento,
        c.cuit,
        c.domicilio,
        c.condicion_iva,
        mp.name AS membership_plan_name,
        mp.price_decimal AS plan_price
      FROM customer_subscription cs
      JOIN customer c ON c.id = cs.customer_id AND c.tenant_id = cs.tenant_id
      LEFT JOIN membership_plan mp ON mp.id = cs.membership_plan_id AND mp.tenant_id = cs.tenant_id
      WHERE cs.id = ? AND cs.tenant_id = ?
      FOR UPDATE`,
      [subscriptionId, tenantId]
    );

    if (!subscription) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Suscripción/Membresía no encontrada" });
    }

    // 2. Verificar si ya tiene factura
    const [[existing]] = await conn.query(
      `SELECT id FROM invoice WHERE subscription_id = ? AND tenant_id = ? LIMIT 1`,
      [subscriptionId, tenantId]
    ).catch(() => {
      // Si la columna no existe, verificar por customer_id y referencia interna
      return conn.query(
        `SELECT id FROM invoice WHERE customer_id = ? AND tenant_id = ? AND referencia_interna LIKE ? LIMIT 1`,
        [subscription.customer_id, tenantId, `%SUBSCRIPTION-${subscriptionId}%`]
      );
    });

    if (existing && (existing.length > 0 || existing.id)) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "Esta membresía ya tiene una factura generada",
        invoice_id: existing[0]?.id || existing.id,
      });
    }

    // 3. Validar datos del cliente
    const validacion = validarDatosFacturacion({
      razon_social: subscription.customer_name,
      documento: subscription.documento,
      cuit: subscription.cuit,
      condicion_iva: subscription.condicion_iva,
    });

    if (!validacion.valid) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "Datos insuficientes para facturar",
        errors: validacion.errors,
      });
    }

    // 4. Tipo de comprobante
    const tipoComprobante = determinarTipoComprobante(
      subscription.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL
    );

    // 5. Calcular IVA - Usar amount_decimal de la suscripción o el precio del plan
    const precio = Number(subscription.amount_decimal || subscription.plan_price || 0);
    const { neto, iva, total } = calcularIVA(precio);

    // 6. Payload para Arca
    const membershipName = subscription.membership_plan_name || subscription.reason || "Membresía";
    const facturaParams = {
      tipo_comprobante: tipoComprobante,
      concepto: CONCEPTOS.SERVICIOS,
      tipo_doc_cliente: subscription.tipo_documento || DOCUMENTO_TIPOS.DNI,
      doc_cliente: subscription.documento || "",
      cuit_cliente: subscription.cuit || null,
      razon_social: subscription.customer_name || "Consumidor Final",
      domicilio: subscription.domicilio || "Sin domicilio",
      condicion_iva: subscription.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL,
      items: [
        {
          descripcion: membershipName,
          cantidad: 1,
          precio_unitario: neto,
          alicuota_iva: 21,
          codigo: `MEMBERSHIP-${subscriptionId}`,
        },
      ],
      importe_neto: neto,
      importe_iva: iva,
      importe_total: total,
      referencia_interna: `SUBSCRIPTION-${subscriptionId}`,
      observaciones: `Membresía #${subscriptionId} - ${membershipName}`,
    };

    const arcaResponse = await generarFactura(facturaParams);
    if (!arcaResponse.success) throw new Error("Arca no pudo generar la factura");

    // 7. Insert factura en DB (intentar con subscription_id)
    const [invoiceResult] = await conn.query(
      `INSERT INTO invoice (
        tenant_id,
        subscription_id,
        customer_id,
        tipo_comprobante,
        punto_venta,
        numero_comprobante,
        cae,
        vto_cae,
        fecha_emision,
        importe_neto,
        importe_iva,
        importe_total,
        items,
        pdf_url,
        xml_url,
        status,
        arca_hash,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        tenantId,
        subscriptionId,
        subscription.customer_id,
        arcaResponse.tipo_comprobante,
        arcaResponse.punto_venta,
        arcaResponse.numero,
        arcaResponse.cae,
        arcaResponse.vto_cae,
        arcaResponse.fecha_emision,
        neto,
        iva,
        total,
        JSON.stringify(facturaParams.items || []),
        arcaResponse.pdf_url,
        arcaResponse.xml_url,
        'approved',
        arcaResponse.hash,
      ]
    ).catch(async (err) => {
      // Si la columna no existe, intentar sin subscription_id
      if (err.code === 'ER_BAD_FIELD_ERROR' || err.message?.includes('subscription_id')) {
        console.warn("[INVOICING] subscription_id no existe, usando solo customer_id");
        return await conn.query(
          `INSERT INTO invoice (
            tenant_id,
            customer_id,
            tipo_comprobante,
            punto_venta,
            numero_comprobante,
            cae,
            vto_cae,
            fecha_emision,
            importe_neto,
            importe_iva,
            importe_total,
            items,
            pdf_url,
            xml_url,
            status,
            arca_hash,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            tenantId,
            subscription.customer_id,
            arcaResponse.tipo_comprobante,
            arcaResponse.punto_venta,
            arcaResponse.numero,
            arcaResponse.cae,
            arcaResponse.vto_cae,
            arcaResponse.fecha_emision,
            neto,
            iva,
            total,
            JSON.stringify(facturaParams.items || []),
            arcaResponse.pdf_url,
            arcaResponse.xml_url,
            'approved',
            arcaResponse.hash,
          ]
        );
      }
      throw err;
    });

    const invoiceId = invoiceResult.insertId;

    await conn.commit();

    res.json({
      ok: true,
      invoice_id: invoiceId,
      cae: arcaResponse.cae,
      numero: arcaResponse.numero,
      tipo_comprobante: arcaResponse.tipo_comprobante,
      punto_venta: arcaResponse.punto_venta,
      total,
      pdf_url: arcaResponse.pdf_url,
    });
  } catch (err) {
    await conn.rollback();
    console.error("[INVOICING] Error generando factura de membresía:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ============================================
// GENERAR NOTA DE CRÉDITO
// ============================================
invoicing.post("/credit-note/:invoiceId", async (req, res) => {
  const conn = await pool.getConnection();
  const tenantId = req.tenant.id;

  try {
    await conn.beginTransaction();

    const invoiceId = Number(req.params.invoiceId);
    const { motivo } = req.body;

    // 1. Buscar factura original dentro del tenant
    const [[original]] = await conn.query(
      `SELECT * FROM invoice WHERE id = ? AND tenant_id = ? FOR UPDATE`,
      [invoiceId, tenantId]
    );
    if (!original) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Factura no encontrada" });
    }

    // 2. Evitar duplicado
    const [[existingNC]] = await conn.query(
      `SELECT id FROM invoice WHERE original_invoice_id = ? AND tenant_id = ? LIMIT 1`,
      [invoiceId, tenantId]
    );
    if (existingNC) {
      await conn.rollback();
      return res.status(400).json({ ok:false, error:"Ya existe nota de crédito para esta factura" });
    }

    // 3. Generar nota crédito en Arca
    const ncParams = {
      tipo_comprobante_original: original.tipo_comprobante,
      punto_venta_original: original.punto_venta,
      numero_original: original.numero_comprobante,
      tipo_doc_cliente: original.tipo_doc_cliente,
      doc_cliente: original.doc_cliente,
      razon_social: original.razon_social,
      domicilio: original.domicilio,
      condicion_iva: original.condicion_iva,
      items: [
        {
          descripcion: `Devolución - ${motivo || "Sin especificar"}`,
          cantidad: 1,
          precio_unitario: original.importe_neto,
          alicuota_iva: 21,
        },
      ],
      importe_neto: original.importe_neto,
      importe_iva: original.importe_iva,
      importe_total: original.importe_total,
      referencia_interna: `NC-${invoiceId}`,
      observaciones: `Nota de crédito ${original.numero_comprobante}`,
    };
    const arcaResponse = await generarNotaCredito(ncParams);

    // 4. Insertar nota crédito
    await conn.query(
      `INSERT INTO invoice (
        tenant_id, customer_id, appointment_id, original_invoice_id,
        tipo_comprobante, punto_venta, numero_comprobante,
        cae, vto_cae, fecha_emision,
        importe_neto, importe_iva, importe_total,
        items, pdf_url, xml_url, status, arca_hash, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?, ?, NOW())`,
      [
        tenantId,
        original.customer_id,
        original.appointment_id,
        invoiceId,
        arcaResponse.tipo_comprobante,
        arcaResponse.punto_venta,
        arcaResponse.numero,
        arcaResponse.cae,
        arcaResponse.vto_cae,
        arcaResponse.fecha_emision,
        -Math.abs(original.importe_neto),
        -Math.abs(original.importe_iva),
        -Math.abs(original.importe_total),
        JSON.stringify(ncParams.items || []),
        arcaResponse.pdf_url,
        arcaResponse.xml_url,
        'approved',
        arcaResponse.hash,
      ]
    );

    await conn.commit();
    res.json({ ok:true, cae:arcaResponse.cae, numero:arcaResponse.numero });
  } catch (e) {
    await conn.rollback();
    console.error("[CREDIT NOTE ERROR]", e);
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    conn.release();
  }
});

// ============================================
// STATS (tenant-scoped)
// ============================================
invoicing.get("/stats", async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { from, to } = req.query;

    const where = ["tenant_id = ?"];
    const params = [tenantId];

    if (from && to) {
      where.push("fecha_emision BETWEEN ? AND ?");
      params.push(`${from} 00:00:00`, `${to} 23:59:59`);
    }

    const [[stats]] = await pool.query(
      `SELECT
        COUNT(*) AS total_facturas,
        SUM(CASE WHEN tipo_comprobante IN (1,6,11) THEN 1 ELSE 0 END) AS facturas,
        SUM(CASE WHEN tipo_comprobante IN (3,8,13) THEN 1 ELSE 0 END) AS notas_credito,
        SUM(CASE WHEN tipo_comprobante IN (1,6,11) THEN importe_total ELSE 0 END) AS total_facturado,
        SUM(CASE WHEN tipo_comprobante IN (3,8,13) THEN importe_total ELSE 0 END) AS total_nc
      FROM invoice
      WHERE ${where.join(" AND ")}`,
      params
    );

    res.json({
      ok:true,
      data:{
        total_facturas:Number(stats.total_facturas||0),
        facturas:Number(stats.facturas||0),
        notas_credito:Number(stats.notas_credito||0),
        total_facturado:Number(stats.total_facturado||0),
        total_nc:Math.abs(Number(stats.total_nc||0)),
        neto:Number(stats.total_facturado||0)-Math.abs(Number(stats.total_nc||0))
      }
    });
  } catch (err) {
    res.status(500).json({ ok:false, error:err.message });
  }
});

export default invoicing;
