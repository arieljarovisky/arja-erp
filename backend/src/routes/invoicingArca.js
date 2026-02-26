// src/routes/invoicingArca.js
import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import {
  generarFactura,
  consultarFactura,
  generarNotaCredito,
  obtenerProximoNumero,
  verificarConexion,
  calcularIVA,
  determinarTipoComprobante,
  validarDatosFacturacion,
  COMPROBANTE_TIPOS,
  DOCUMENTO_TIPOS,
  CONDICIONES_IVA,
  CONCEPTOS,
  getArcaCredentials
} from "../services/arca.js";

const router = express.Router();


const CREDIT_NOTE_MAP = {
  1: 3,   // Factura A  -> Nota Crédito A
  6: 8,   // Factura B  -> Nota Crédito B
  11: 13  // Factura C  -> Nota Crédito C
};

const normalizeInvoiceItem = (item = {}) => ({
  descripcion: item.descripcion || item.description || "",
  cantidad: Number(item.cantidad || 1),
  precio_unitario: Number(item.precio_unitario ?? item.price ?? 0),
  alicuota_iva: Number(item.alicuota_iva ?? item.iva ?? 21),
  codigo: item.codigo || item.code || null,
  service_id: item.service_id || item.serviceId || null
});

const normalizeNotes = (value, fallback = null) => {
  if (value === undefined) return fallback ?? null;
  if (value === null) return null;
  if (typeof value !== "string") return fallback ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseStoredItems = (rawItems) => {
  if (!rawItems) return [];
  if (Array.isArray(rawItems)) {
    return rawItems.map(normalizeInvoiceItem);
  }
  if (typeof rawItems === "string") {
    try {
      const parsed = JSON.parse(rawItems);
      return Array.isArray(parsed) ? parsed.map(normalizeInvoiceItem) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const buildItemsForArca = (rawItems) =>
  parseStoredItems(rawItems).map((item) => ({
    ...item,
    cantidad: Math.abs(Number(item.cantidad || 1)),
    precio_unitario: Math.abs(Number(item.precio_unitario || 0)),
    alicuota_iva: Number(item.alicuota_iva ?? 21),
  }));

const invertItemsForStorage = (items = []) =>
  items.map((item) => ({
    ...item,
    cantidad: Math.abs(Number(item.cantidad || 1)),
    precio_unitario: -Math.abs(Number(item.precio_unitario || 0)),
  }));

const parseAfipDate = (value) => {
  if (!value) return null;
  const str = String(value).trim();
  if (/^\d{8}$/.test(str)) {
    const year = Number(str.slice(0, 4));
    const month = Number(str.slice(4, 6)) - 1;
    const day = Number(str.slice(6, 8));
    const date = new Date(Date.UTC(year, month, day));
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date;
};
// Middleware para verificar permisos de facturación
function checkInvoicingPermission(action = 'read') {
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
    const permissions = user.permissions ? JSON.parse(user.permissions) : {};
    const invoicingPerms = permissions.invoicing || [];

    const requiredPerm = `invoicing.${action}`;
    if (!invoicingPerms.includes(requiredPerm) && !invoicingPerms.includes('invoicing.admin')) {
      return res.status(403).json({
        ok: false,
        error: `No tienes permiso para ${action} en facturación`
      });
    }

    next();
  };
}

// GET /api/invoicing/arca/verify - Verificar conexión con ARCA
router.get("/arca/verify", requireAuth, identifyTenant, checkInvoicingPermission('read'), async (req, res) => {
  try {
    console.log("[GET /api/invoicing/arca/verify] Iniciando verificación...");
    const tenantId = req.tenant_id || req.user?.tenant_id;
    console.log("[GET /api/invoicing/arca/verify] Tenant ID:", tenantId);
    const result = await verificarConexion(tenantId);
    console.log("[GET /api/invoicing/arca/verify] Resultado:", JSON.stringify(result, null, 2));

    // También verificar si tiene CUIT configurado
    const [[cuitConfig]] = await pool.query(
      `SELECT config_value FROM system_config 
       WHERE tenant_id = ? AND config_key = 'contact.arca_cuit'`,
      [tenantId]
    );

    const tenantCUIT = cuitConfig?.config_value || null;

    res.json({
      ...result,
      tenantCUIT: tenantCUIT ? tenantCUIT.replace(/\D/g, '') : null,
      configured: !!tenantCUIT,
      message: tenantCUIT
        ? `CUIT configurado: ${tenantCUIT.replace(/\D/g, '')}. Listo para facturar.`
        : "CUIT no configurado. Ingresá tu CUIT en Configuración > Contacto."
    });
  } catch (error) {
    console.error("[GET /api/invoicing/arca/verify] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/invoicing/arca/test - Generar factura de prueba
router.post("/arca/test", requireAuth, identifyTenant, checkInvoicingPermission('write'), async (req, res) => {
  try {
    const tenantId = req.tenant_id || req.user?.tenant_id;

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "Tenant no identificado"
      });
    }

    // Verificar que tenga CUIT configurado
    const [[cuitConfig]] = await pool.query(
      `SELECT config_value FROM system_config 
       WHERE tenant_id = ? AND config_key = 'contact.arca_cuit'`,
      [tenantId]
    );

    // También buscar todas las configuraciones de contacto para debug
    const [allContactConfigs] = await pool.query(
      `SELECT config_key, config_value FROM system_config 
       WHERE tenant_id = ? AND config_key LIKE 'contact.%'`,
      [tenantId]
    );

    const tenantCUIT = cuitConfig?.config_value ? cuitConfig.config_value.replace(/\D/g, '') : null;

    if (!tenantCUIT || tenantCUIT.length !== 11) {
      const errorMessage = !cuitConfig
        ? "CUIT no configurado. Ingresá tu CUIT en Configuración > Contacto y guardá los cambios antes de testear."
        : tenantCUIT && tenantCUIT.length !== 11
          ? `CUIT inválido. El CUIT debe tener 11 dígitos. Valor actual: ${cuitConfig.config_value}`
          : "CUIT no configurado. Ingresá tu CUIT en Configuración > Contacto y guardá los cambios antes de testear.";

      return res.status(400).json({
        ok: false,
        error: errorMessage
      });
    }

    // Generar factura de prueba
    const testInvoice = await generarFactura({
      tenantId,
      tipo_comprobante: COMPROBANTE_TIPOS.FACTURA_B, // Factura B (consumidor final)
      concepto: CONCEPTOS.SERVICIOS,
      cuit_cliente: null, // Consumidor final
      tipo_doc_cliente: DOCUMENTO_TIPOS.CONSUMIDOR_FINAL,
      doc_cliente: "0",
      razon_social: "CONSUMIDOR FINAL",
      domicilio: "",
      condicion_iva: CONDICIONES_IVA.CONSUMIDOR_FINAL,
      items: [{
        descripcion: "Servicio de Prueba - Facturación Electrónica",
        cantidad: 1,
        precio_unitario: 100.00,
        alicuota_iva: 21,
      }],
      importe_neto: 100.00,
      importe_iva: 21.00,
      importe_total: 121.00,
      referencia_interna: `test_${tenantId}_${Date.now()}`,
      observaciones: "Factura de prueba generada desde el sistema"
    });

    res.json({
      ok: true,
      message: "Factura de prueba generada exitosamente",
      data: testInvoice
    });
  } catch (error) {
    console.error("[POST /api/invoicing/arca/test] Error:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
      details: error.stack
    });
  }
});

// GET /api/invoicing/arca/next-number - Obtener próximo número de comprobante
router.get("/arca/next-number", requireAuth, identifyTenant, checkInvoicingPermission('read'), async (req, res) => {
  try {
    const tenantId = req.tenant_id || req.user?.tenant_id;
    const { tipo_comprobante } = req.query;
    if (!tipo_comprobante) {
      return res.status(400).json({ ok: false, error: "tipo_comprobante es requerido" });
    }
    const numero = await obtenerProximoNumero(Number(tipo_comprobante), tenantId);
    res.json({ ok: true, data: { proximo_numero: numero } });
  } catch (error) {
    console.error("[GET /api/invoicing/arca/next-number] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post("/draft", requireAuth, identifyTenant, checkInvoicingPermission('write'), async (req, res) => {
  const tenantId = req.tenant_id;
  const userId = req.user?.id || null;

  const {
    tipo_comprobante,
    customer_id,
    items = [],
    importe_neto,
    importe_iva,
    importe_total,
    observaciones,
    cliente_data,
    punto_venta,
    numero_comprobante
  } = req.body || {};

  if (!tipo_comprobante) {
    return res.status(400).json({ ok: false, error: "tipo_comprobante es requerido" });
  }

  let cliente = cliente_data ? { ...cliente_data } : null;

  try {
    if (customer_id) {
      const [[customer]] = await pool.query(
        `SELECT * FROM customer WHERE id = ? AND tenant_id = ?`,
        [customer_id, tenantId]
      );
      if (!customer) {
        return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
      }
      cliente = {
        razon_social: customer.name || customer.full_name || 'Cliente',
        documento: customer.phone || customer.documento || '',
        cuit: customer.cuit || '',
        domicilio: customer.address || '',
        condicion_iva: customer.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL,
      };
    }

    const normalizedItems = (items || []).map(normalizeInvoiceItem);
    const notesValue = normalizeNotes(observaciones);

    let neto = Number(importe_neto || 0);
    let iva = Number(importe_iva || 0);
    let total = Number(importe_total || 0);

    if ((neto === 0 && normalizedItems.length > 0) || total === 0) {
      neto = normalizedItems.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0);
      const ivaCalc = calcularIVA(neto, normalizedItems[0]?.alicuota_iva || 21);
      iva = iva || ivaCalc.iva;
      total = total || ivaCalc.total;
    }

    const pv = Number(punto_venta ?? 0);
    const numero = Number(numero_comprobante ?? 0);

    // Generar hash único para borradores
    const draftHash = `DRAFT_${tenantId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const [result] = await pool.query(
      `INSERT INTO invoice (
        tenant_id, appointment_id, customer_id, tipo_comprobante, punto_venta,
        numero_comprobante, cae, vto_cae, fecha_emision,
        importe_neto, importe_iva, importe_total,
        items, notes, pdf_url, xml_url, status, arca_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        null,
        customer_id || null,
        Number(tipo_comprobante),
        pv,
        numero,
        null,
        null,
        new Date(),
        neto,
        iva,
        total,
        JSON.stringify(normalizedItems),
        notesValue,
        null,
        null,
        'draft',
        draftHash  // Hash único para borradores
      ]
    );

    const [[draftInvoice]] = await pool.query(
      `SELECT * FROM invoice WHERE id = ? AND tenant_id = ?`,
      [result.insertId, tenantId]
    );

    res.status(201).json({ ok: true, data: draftInvoice });
  } catch (error) {
    console.error("[POST /api/invoicing/draft] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.put("/draft/:id", requireAuth, identifyTenant, checkInvoicingPermission('write'), async (req, res) => {
  const tenantId = req.tenant_id;
  const draftId = Number(req.params.id);

  if (!draftId || Number.isNaN(draftId)) {
    return res.status(400).json({ ok: false, error: "ID de borrador inválido" });
  }

  const {
    tipo_comprobante,
    customer_id,
    items = [],
    importe_neto,
    importe_iva,
    importe_total,
    observaciones,
    cliente_data,
    punto_venta,
    numero_comprobante
  } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: "El borrador necesita al menos un item" });
  }

  try {
    const [[existingDraft]] = await pool.query(
      `SELECT * FROM invoice WHERE id = ? AND tenant_id = ?`,
      [draftId, tenantId]
    );

    if (!existingDraft) {
      return res.status(404).json({ ok: false, error: "Borrador no encontrado" });
    }

    if (existingDraft.status && existingDraft.status !== 'draft') {
      return res.status(400).json({ ok: false, error: "Sólo se pueden editar facturas en borrador" });
    }

    let normalizedItems = (items || []).map(normalizeInvoiceItem);
    if (normalizedItems.length === 0) {
      return res.status(400).json({ ok: false, error: "El borrador necesita items válidos" });
    }

    let neto = Number(importe_neto ?? existingDraft.importe_neto ?? 0);
    let iva = Number(importe_iva ?? existingDraft.importe_iva ?? 0);
    let total = Number(importe_total ?? existingDraft.importe_total ?? 0);

    if (neto === 0 || total === 0) {
      neto = normalizedItems.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0);
      const ivaCalc = calcularIVA(neto, normalizedItems[0]?.alicuota_iva || 21);
      iva = iva || ivaCalc.iva;
      total = total || ivaCalc.total;
    }

    const pv = Number(punto_venta ?? existingDraft.punto_venta ?? 0);
    const numero = Number(numero_comprobante ?? existingDraft.numero_comprobante ?? 0);
    const notesValue = normalizeNotes(observaciones, existingDraft.notes);

    await pool.query(
      `UPDATE invoice
        SET customer_id = ?, tipo_comprobante = ?, punto_venta = ?, numero_comprobante = ?,
            importe_neto = ?, importe_iva = ?, importe_total = ?,
            items = ?, notes = ?
       WHERE id = ? AND tenant_id = ?`,
      [
        customer_id || null,
        Number(tipo_comprobante ?? existingDraft.tipo_comprobante ?? 0),
        pv,
        numero,
        neto,
        iva,
        total,
        JSON.stringify(normalizedItems),
        notesValue,
        draftId,
        tenantId
      ]
    );

    const [[updatedDraft]] = await pool.query(
      `SELECT * FROM invoice WHERE id = ? AND tenant_id = ?`,
      [draftId, tenantId]
    );

    res.json({ ok: true, data: updatedDraft });
  } catch (error) {
    console.error("[PUT /api/invoicing/draft/:id] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/invoicing/arca/generate - Generar factura
router.post("/arca/generate", requireAuth, identifyTenant, checkInvoicingPermission('write'), async (req, res) => {
  const tenantId = req.tenant_id;
  const userId = req.user?.id || null;

  const {
    tipo_comprobante,
    concepto = CONCEPTOS.SERVICIOS,
    customer_id,
    items,
    importe_neto,
    importe_iva,
    importe_total,
    observaciones,
    cliente_data,
    referencia_interna: referenciaInternaIn,
    punto_venta: puntoVentaBody,
    seller_id
  } = req.body || {};

  if (!tipo_comprobante || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "tipo_comprobante e items son requeridos"
    });
  }

  const appointmentIds = Array.isArray(req.body?.appointment_ids) ? req.body.appointment_ids : [];
  let referencia_interna = referenciaInternaIn;
  if (!referencia_interna) {
    if (appointmentIds.length > 0) {
      const sortedIds = [...appointmentIds].map(id => Number(id)).sort((a, b) => a - b);
      referencia_interna = `appointment:${sortedIds.join(',')}`;
    } else if (customer_id) {
      referencia_interna = `customer:${tenantId}:${customer_id}:${Date.now()}`;
    } else {
      referencia_interna = `manual:${tenantId}:${Date.now()}`;
    }
  }

  let normalizedItems = (items || []).map(normalizeInvoiceItem);
  let cliente = cliente_data ? { ...cliente_data } : null;
  const notesValue = normalizeNotes(observaciones);

  let neto = Number(importe_neto || 0);
  let iva = Number(importe_iva || 0);
  let total = Number(importe_total || 0);

  const fallbackPuntoVenta = Number(puntoVentaBody ?? process.env.ARCA_PUNTO_VENTA ?? 1) || 1;
  let puntoVenta = fallbackPuntoVenta;
  let numeroComprobante = 0;
  let invoiceNumber = null;
  let arcaHash = null;

  try {
    const comprobante = Number(tipo_comprobante);

    if (customer_id) {
      const [[customer]] = await pool.query(
        `SELECT * FROM customer WHERE id = ? AND tenant_id = ?`,
        [customer_id, tenantId]
      );
      if (!customer) {
        return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
      }
      cliente = {
        razon_social: customer.name || customer.full_name,
        documento: customer.phone || customer.dni || '',
        cuit: customer.cuit || '',
        domicilio: customer.address || '',
        condicion_iva: customer.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL,
        tipo_doc: customer.tipo_doc || DOCUMENTO_TIPOS.DNI
      };
    }

    if (!cliente) {
      return res.status(400).json({
        ok: false,
        error: "Se requiere customer_id o cliente_data"
      });
    }

    const documentoDigits = (cliente.documento || '').toString().replace(/[^0-9]/g, '');
    const cuitDigits = (cliente.cuit || '').toString().replace(/[^0-9]/g, '');

    if (comprobante === COMPROBANTE_TIPOS.FACTURA_A || comprobante === COMPROBANTE_TIPOS.FACTURA_M) {
      if (!cuitDigits || cuitDigits.length !== 11) {
        return res.status(400).json({
          ok: false,
          error: "Datos del cliente incompletos",
          details: ["Para emitir Factura A/M necesitás CUIT válido (11 dígitos)"]
        });
      }
      cliente.cuit = cuitDigits;
      cliente.documento = cuitDigits;
      cliente.tipo_doc = DOCUMENTO_TIPOS.CUIT;
    } else {
      cliente.documento = documentoDigits;
      if (!cliente.documento || cliente.documento === '0') {
        cliente.documento = '0';
        cliente.tipo_doc = DOCUMENTO_TIPOS.CONSUMIDOR_FINAL;
        cliente.condicion_iva = CONDICIONES_IVA.CONSUMIDOR_FINAL;
      } else {
        cliente.tipo_doc = cliente.tipo_doc || DOCUMENTO_TIPOS.DNI;
      }
    }

    cliente.tipo_doc = cliente.tipo_doc || DOCUMENTO_TIPOS.DNI;
    cliente.cuit = cuitDigits;
    cliente.condicion_iva = cliente.condicion_iva || CONDICIONES_IVA.CONSUMIDOR_FINAL;

    const validation = validarDatosFacturacion(cliente);
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        error: "Datos del cliente incompletos",
        details: validation.errors
      });
    }

    if (neto === 0 || total === 0) {
      neto = normalizedItems.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0);
      const ivaCalc = calcularIVA(neto, normalizedItems[0]?.alicuota_iva || 21);
      iva = iva || ivaCalc.iva;
      total = total || ivaCalc.total;
    }

    const facturaData = await generarFactura({
      tenantId,
      tipo_comprobante: Number(tipo_comprobante),
      concepto: Number(concepto),
      cuit_cliente: cliente.cuit,
      tipo_doc_cliente: cliente.tipo_doc || DOCUMENTO_TIPOS.DNI,
      doc_cliente: cliente.documento,
      razon_social: cliente.razon_social,
      domicilio: cliente.domicilio,
      condicion_iva: cliente.condicion_iva,
      items: normalizedItems,
      importe_neto: neto,
      importe_iva: iva,
      importe_total: total,
      referencia_interna,
      observaciones: notesValue ?? observaciones
    });

    if (!facturaData.cae) {
      // Si no hay CAE, es una factura rechazada
      throw new Error(facturaData.error || facturaData.observaciones || "AFIP no autorizó la factura");
    }

    puntoVenta = Math.max(
      1,
      Number(facturaData.punto_venta ?? facturaData.puntoVenta ?? fallbackPuntoVenta) || 1
    );
    numeroComprobante = Number(facturaData.numero ?? facturaData.numero_comprobante ?? 0) || 1;
    invoiceNumber = `${puntoVenta}-${String(numeroComprobante).padStart(8, '0')}`;
    arcaHash = facturaData.hash;

    // Verificar si ya existe una factura con este hash
    if (arcaHash) {
      const [[existingInvoice]] = await pool.query(
        `SELECT * FROM invoice WHERE tenant_id = ? AND arca_hash = ? AND punto_venta = ? LIMIT 1`,
        [tenantId, arcaHash, puntoVenta]
      );

      if (existingInvoice) {
        if (appointmentIds.length > 0) {
          const placeholdersDup = appointmentIds.map(() => '?').join(',');
          await pool.query(
            `UPDATE appointment SET invoiced = 1
             WHERE id IN (${placeholdersDup}) AND tenant_id = ?`,
            [...appointmentIds, tenantId]
          );
        }
        return res.status(200).json({
          ok: true,
          duplicate: true,
          message: "La factura ya había sido emitida anteriormente",
          data: existingInvoice
        });
      }
    }

    const caeValue = facturaData.cae;
    const vtoCAEValue = facturaData.vto_cae ? parseAfipDate(facturaData.vto_cae) : null;
    const fechaEmisionValue = facturaData.fecha_emision ? parseAfipDate(facturaData.fecha_emision) : new Date();

    // Obtener porcentaje de comisión del vendedor si existe
    let sellerCommissionPercentage = 0;
    let sellerCommissionAmount = 0;
    if (seller_id) {
      try {
        // Buscar comisión configurada para el vendedor (similar a instructores)
        const [[commissionConfig]] = await pool.query(
          `SELECT percentage FROM user_commission WHERE user_id = ? AND tenant_id = ? LIMIT 1`,
          [seller_id, tenantId]
        );
        if (commissionConfig && commissionConfig.percentage) {
          sellerCommissionPercentage = Number(commissionConfig.percentage);
          sellerCommissionAmount = +(total * (sellerCommissionPercentage / 100)).toFixed(2);
        }
      } catch (err) {
        console.warn("[INVOICING] Error obteniendo comisión del vendedor:", err.message);
        // Continuar sin comisión si hay error
      }
    }

    const [invoiceResult] = await pool.query(
      `INSERT INTO invoice (
        tenant_id, appointment_id, customer_id, tipo_comprobante, punto_venta,
        numero_comprobante, cae, vto_cae, fecha_emision,
        importe_neto, importe_iva, importe_total,
        items, notes, pdf_url, xml_url, status, arca_hash, seller_id, seller_commission_percentage, seller_commission_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        appointmentIds.length === 1 ? appointmentIds[0] : null,
        customer_id || null,
        facturaData.tipo_comprobante,
        puntoVenta,
        numeroComprobante,
        caeValue,
        vtoCAEValue,
        fechaEmisionValue,
        neto,
        iva,
        total,
        JSON.stringify(normalizedItems),
        notesValue,
        facturaData.pdf_url || null,
        facturaData.xml_url || null,
        caeValue && caeValue !== "RECHAZADO" ? "approved" : "pending",
        arcaHash,
        seller_id || null,
        sellerCommissionPercentage > 0 ? sellerCommissionPercentage : null,
        sellerCommissionAmount > 0 ? sellerCommissionAmount : null
      ]
    ).catch(async (err) => {
      // Si las columnas seller_id, seller_commission_percentage o seller_commission_amount no existen, intentar sin ellas
      if (err.code === 'ER_BAD_FIELD_ERROR' || err.message?.includes('seller')) {
        console.warn("[INVOICING] Columnas de vendedor no existen, guardando sin comisión");
        return await pool.query(
          `INSERT INTO invoice (
            tenant_id, appointment_id, customer_id, tipo_comprobante, punto_venta,
            numero_comprobante, cae, vto_cae, fecha_emision,
            importe_neto, importe_iva, importe_total,
            items, notes, pdf_url, xml_url, status, arca_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            appointmentIds.length === 1 ? appointmentIds[0] : null,
            customer_id || null,
            facturaData.tipo_comprobante,
            puntoVenta,
            numeroComprobante,
            caeValue,
            vtoCAEValue,
            fechaEmisionValue,
            neto,
            iva,
            total,
            JSON.stringify(normalizedItems),
            notesValue,
            facturaData.pdf_url || null,
            facturaData.xml_url || null,
            caeValue && caeValue !== "RECHAZADO" ? "approved" : "pending",
            arcaHash
          ]
        );
      }
      throw err;
    });

    // Las facturas aprobadas se guardaron con todos los datos necesarios en el INSERT

    if (appointmentIds.length > 0) {
      const placeholders = appointmentIds.map(() => '?').join(',');
      await pool.query(
        `UPDATE appointment SET invoiced = 1
         WHERE id IN (${placeholders}) AND tenant_id = ?`,
        [...appointmentIds, tenantId]
      );
    }

    res.status(201).json({
      ok: true,
      data: {
        id: invoiceResult.insertId,
        punto_venta: puntoVenta,
        numero_comprobante: numeroComprobante,
        cae: caeValue,
        vto_cae: vtoCAEValue,
        ...facturaData
      },
      environment: facturaData.environment,
      isProduction: facturaData.isProduction,
      warning: facturaData.warning
    });
  } catch (error) {
    console.error("[POST /api/invoicing/arca/generate] Error:", error);

    let rejectedSaved = false;
    const errorMessage =
      error?.response?.data?.error ||
      error?.sqlMessage ||
      error.message ||
      "Error al generar factura";

    // Detectar si es un error de duplicado por arca_hash
    const isDuplicateError =
      error?.code === "ER_DUP_ENTRY" ||
      (typeof errorMessage === "string" &&
        (errorMessage.includes("uq_arca_hash") ||
          errorMessage.includes("arca_hash")));

    // 🟢 Caso 1: Duplicado → devolver la factura existente como OK
    if (isDuplicateError && arcaHash) {
      try {
        const [[existingInvoice]] = await pool.query(
          `SELECT * FROM invoice WHERE tenant_id = ? AND arca_hash = ? LIMIT 1`,
          [tenantId, arcaHash]
        );

        if (existingInvoice) {
          if (appointmentIds.length > 0) {
            const placeholdersDup = appointmentIds.map(() => "?").join(",");
            await pool.query(
              `UPDATE appointment
               SET invoiced = 1
               WHERE id IN (${placeholdersDup}) AND tenant_id = ?`,
              [...appointmentIds, tenantId]
            );
          }

          return res.status(200).json({
            ok: true,
            duplicate: true,
            message: "La factura ya había sido emitida anteriormente",
            data: existingInvoice
          });
        }
      } catch (lookupError) {
        console.error(
          "[POST /api/invoicing/arca/generate] Error buscando factura existente por hash:",
          lookupError
        );
      }
    }

    // 🔴 Caso 2: Guardar factura rechazada
    try {
      // Para facturas rechazadas, usamos un hash único que las identifique como rechazadas
      const rejectedHash = `REJECTED_${tenantId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const rejectedNumber = Number(numeroComprobante || 0) || -Math.floor((Date.now() % 1_000_000_000));

      const [rejectedResult] = await pool.query(
        `INSERT INTO invoice (
          tenant_id, appointment_id, customer_id, tipo_comprobante, punto_venta,
          numero_comprobante, cae, vto_cae, fecha_emision,
          importe_neto, importe_iva, importe_total,
          items, notes, pdf_url, xml_url, status, arca_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          appointmentIds.length === 1 ? appointmentIds[0] : null,
          customer_id || null,
          Number(tipo_comprobante || 0),
          puntoVenta || 0,
          rejectedNumber,
          null,  // cae (null para rechazadas)
          null,  // vto_cae (null para rechazadas)
          new Date(),
          neto || 0,
          iva || 0,
          total || 0,
          JSON.stringify(normalizedItems),
          notesValue,
          null,  // pdf_url
          null,  // xml_url
          'rejected',
          rejectedHash  // arca_hash único para rechazadas
        ]
      );

      rejectedSaved = true;
    } catch (persistError) {
      console.error(
        "[POST /api/invoicing/arca/generate] Error guardando factura rechazada:",
        persistError
      );
    }

    const statusCode = rejectedSaved ? 400 : 500;
    return res
      .status(statusCode)
      .json({ ok: false, error: errorMessage, saved_rejected: rejectedSaved });
  }
});

// POST /api/invoicing/arca/nota-credito - Generar nota de crédito
// POST /api/invoicing/arca/nota-credito - Generar nota de crédito
router.post(
  "/arca/nota-credito",
  requireAuth,
  identifyTenant,
  checkInvoicingPermission("write"),
  async (req, res) => {
    try {
      const tenantId = req.tenant_id;
      const { invoice_id, motivo, items } = req.body || {};

      if (!invoice_id || !motivo) {
        return res.status(400).json({
          ok: false,
          error: "invoice_id y motivo son requeridos",
        });
      }

      // 1) Factura original
      const [[originalInvoice]] = await pool.query(
        `SELECT * FROM invoice WHERE id = ? AND tenant_id = ?`,
        [invoice_id, tenantId]
      );

      if (!originalInvoice) {
        return res
          .status(404)
          .json({ ok: false, error: "Factura original no encontrada" });
      }

      // Verificar si ya existe una nota de crédito aprobada para esta factura
      const [existingNcRows] = await pool.query(
        `SELECT id, tipo_comprobante, status
         FROM invoice
         WHERE tenant_id = ?
           AND original_invoice_id = ?
           AND tipo_comprobante IN (?, ?, ?)
         ORDER BY id DESC
         LIMIT 1`,
        [
          tenantId,
          invoice_id,
          COMPROBANTE_TIPOS.NOTA_CREDITO_A,
          COMPROBANTE_TIPOS.NOTA_CREDITO_B,
          COMPROBANTE_TIPOS.NOTA_CREDITO_C,
        ]
      );

      const existingNc = existingNcRows?.[0];
      if (existingNc && ["approved", "processing", "pending"].includes(existingNc.status)) {
        return res.status(409).json({
          ok: false,
          error: "La factura ya tiene una nota de crédito registrada",
        });
      }

      const tipoOriginal = Number(originalInvoice.tipo_comprobante);

      // No permitir NC sobre NC
      if ([3, 8, 13].includes(tipoOriginal)) {
        return res.status(400).json({
          ok: false,
          error: "No se puede generar nota de crédito de otra nota de crédito",
        });
      }

      // Tipo de NC según la factura original
      const tipoNC = CREDIT_NOTE_MAP[tipoOriginal];
      if (!tipoNC) {
        return res.status(400).json({
          ok: false,
          error: `No se puede generar nota de crédito para tipo_comprobante ${tipoOriginal}`,
        });
      }

      // 2) Datos del cliente
      let customerDoc =
        originalInvoice.customer_doc ||
        originalInvoice.doc_cliente ||
        null;
      let customerCUIT =
        originalInvoice.customer_cuit ||
        originalInvoice.cuit_cliente ||
        null;
      let customerName =
        originalInvoice.customer_name ||
        originalInvoice.razon_social ||
        "CONSUMIDOR FINAL";
      let customerAddress =
        originalInvoice.customer_address ||
        originalInvoice.domicilio ||
        "";
      let condicionIVA =
        Number(originalInvoice.condicion_iva ?? 0) || null;

      let customerFromTable = null;
      if (originalInvoice.customer_id) {
        const [[customerRow]] = await pool.query(
          `SELECT * FROM customer WHERE id = ? AND tenant_id = ?`,
          [originalInvoice.customer_id, tenantId]
        );
        customerFromTable = customerRow || null;
      }

      if (!customerDoc && customerFromTable?.documento)
        customerDoc = customerFromTable.documento;
      if (!customerCUIT && customerFromTable?.cuit)
        customerCUIT = customerFromTable.cuit;
      if (
        (!customerName || customerName === "CONSUMIDOR FINAL") &&
        customerFromTable?.name
      )
        customerName = customerFromTable.name;
      if (!customerAddress && customerFromTable?.address)
        customerAddress = customerFromTable.address;
      if (!condicionIVA && customerFromTable?.condicion_iva)
        condicionIVA = Number(customerFromTable.condicion_iva);

      let docDigits = (customerCUIT || customerDoc || "")
        .toString()
        .replace(/\D/g, "");
      let hasValidCUIT = docDigits.length === 11;

      const credentials = await getArcaCredentials(tenantId);
      const emisorCuitDigits = credentials?.facturarCUIT
        ? credentials.facturarCUIT.replace(/\D/g, "")
        : credentials?.cuit
          ? credentials.cuit.replace(/\D/g, "")
          : null;

      if (hasValidCUIT && emisorCuitDigits && docDigits === emisorCuitDigits) {
        console.warn(
          "[ARCA] Nota de crédito: Doc cliente coincide con CUIT emisor, usando Consumidor Final."
        );
        docDigits = "";
        hasValidCUIT = false;
      }

      let docTipo = hasValidCUIT
        ? DOCUMENTO_TIPOS.CUIT
        : DOCUMENTO_TIPOS.CONSUMIDOR_FINAL;

      if (!condicionIVA) {
        condicionIVA = hasValidCUIT
          ? CONDICIONES_IVA.RESPONSABLE_INSCRIPTO
          : CONDICIONES_IVA.CONSUMIDOR_FINAL;
      }

      if (
        condicionIVA === CONDICIONES_IVA.RESPONSABLE_INSCRIPTO &&
        !hasValidCUIT
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "El cliente necesita CUIT válido para notas de crédito clase A/M",
        });
      }

      if (!hasValidCUIT) {
        docTipo = DOCUMENTO_TIPOS.CONSUMIDOR_FINAL;
      }

      // 3) Items (NC total o parcial)
      const sourceItems =
        Array.isArray(items) && items.length > 0
          ? items.map(normalizeInvoiceItem)
          : buildItemsForArca(originalInvoice.items);

      const arcaItemsBase = (
        sourceItems.length
          ? sourceItems
          : [
            {
              descripcion: `Devolución factura ${originalInvoice.invoice_number ||
                originalInvoice.numero_comprobante ||
                invoice_id
                }`,
              cantidad: 1,
              precio_unitario: Math.abs(
                Number(originalInvoice.importe_neto || 0)
              ),
              alicuota_iva: Number(
                sourceItems?.[0]?.alicuota_iva || 21
              ),
              codigo: null,
              service_id: null,
            },
          ]
      ).map((item) => ({
        ...item,
        cantidad: Math.abs(Number(item.cantidad || 1)),
        precio_unitario: Math.abs(
          Number(item.precio_unitario || 0)
        ),
        alicuota_iva: Number(item.alicuota_iva ?? 21),
      }));

      const isNotaCreditoC = tipoNC === COMPROBANTE_TIPOS.NOTA_CREDITO_C;

      const arcaItems = isNotaCreditoC
        ? arcaItemsBase.map((item) => ({
          ...item,
          alicuota_iva: 0,
        }))
        : arcaItemsBase;

      const netoOrigen = arcaItems.reduce(
        (sum, item) => sum + item.precio_unitario * item.cantidad,
        0
      );
      const ivaOrigen = isNotaCreditoC
        ? 0
        : arcaItems.reduce(
          (sum, item) =>
            sum +
            item.precio_unitario *
            item.cantidad *
            (item.alicuota_iva / 100),
          0
        );

      const importeNeto = netoOrigen || Math.abs(Number(originalInvoice.importe_neto || 0));
      const importeIVA = isNotaCreditoC
        ? 0
        : (ivaOrigen || Math.abs(Number(originalInvoice.importe_iva || 0)));
      const importeTotal = isNotaCreditoC
        ? importeNeto
        : ((netoOrigen + ivaOrigen) || Math.abs(Number(originalInvoice.importe_total || 0)));

      // 4) Datos del comprobante asociado
      const numeroOriginalAfip = (() => {
        const raw = originalInvoice.invoice_number
          ? String(originalInvoice.invoice_number)
          : "";
        if (raw && raw.includes("-")) {
          const parts = raw.split("-");
          const candidate = parts[1] || parts[0];
          const parsed = Number(candidate);
          if (!Number.isNaN(parsed)) return parsed;
        }
        const fallback = Number(
          originalInvoice.numero_comprobante || 0
        );
        return Number.isNaN(fallback) ? 0 : fallback;
      })();

      // 5) Llamar a ARCA/AFIP para generar la NC
      const notaCreditoData = await generarNotaCredito({
        tenantId,

        // Tipo de la NOTA DE CRÉDITO
        tipo_comprobante: tipoNC,
        tipo_comprobante_original: tipoOriginal,
        punto_venta_original: Number(originalInvoice.punto_venta),
        numero_original: numeroOriginalAfip,

        // Datos cliente
        concepto: CONCEPTOS.SERVICIOS,
        cuit_cliente: hasValidCUIT ? docDigits : null,
        tipo_doc_cliente: docTipo,
        doc_cliente: hasValidCUIT
          ? docDigits
          : docTipo === DOCUMENTO_TIPOS.CONSUMIDOR_FINAL
            ? "0"
            : docDigits || "0",
        razon_social: customerName,
        domicilio: customerAddress || "",
        condicion_iva: condicionIVA,

        // Montos / items
        items: arcaItems,
        importe_neto: importeNeto,
        importe_iva: importeIVA,
        importe_total: importeTotal,

        referencia_interna: `nc_${invoice_id}_${Date.now()}`,
        observaciones: motivo,

        // Comprobante asociado obligatorio
        cbtesAsoc: [
          {
            Tipo: tipoOriginal,
            PtoVta: Number(originalInvoice.punto_venta),
            Nro: numeroOriginalAfip,
          },
        ],
      });

      // 6) Normalizar respuesta

      const tipoComprobanteNC = Number(
        notaCreditoData.tipo_comprobante || tipoNC
      );

      const puntoVentaNC = Number(
        notaCreditoData.punto_venta ||
        notaCreditoData.PtoVta ||
        originalInvoice.punto_venta ||
        1
      );

      if (!puntoVentaNC) {
        throw new Error(
          "No se pudo determinar punto_venta para la nota de crédito"
        );
      }

      const ncHash =
        notaCreditoData.hash ||
        `NC_${tenantId}_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;

      const ncNotes = normalizeNotes(motivo);
      const itemsToStore = invertItemsForStorage(arcaItems);

      const importeNetoBase =
        notaCreditoData.importe_neto ??
        netoOrigen ??
        originalInvoice.importe_neto ??
        0;

      const importeIvaBase =
        notaCreditoData.importe_iva ??
        ivaOrigen ??
        originalInvoice.importe_iva ??
        0;

      const importeTotalBase =
        notaCreditoData.importe_total ??
        netoOrigen + ivaOrigen ??
        originalInvoice.importe_total ??
        0;

      const netoNc = -Math.abs(Number(importeNetoBase));
      const ivaNc = -Math.abs(Number(importeIvaBase));
      const totalNc = -Math.abs(Number(importeTotalBase));

      const fechaEmisionNc = notaCreditoData.fecha_emision
        ? new Date(notaCreditoData.fecha_emision)
        : new Date();
      fechaEmisionNc.setHours(0, 0, 0, 0);

      const numeroNC = Number(
        notaCreditoData.numero ??
        notaCreditoData.numero_comprobante ??
        notaCreditoData.CbteDesde ??
        notaCreditoData.CbteHasta ??
        0
      );

      // 7) Insertar NC
      const [result] = await pool.query(
        `INSERT INTO invoice (
          tenant_id, tipo_comprobante, punto_venta, cae, vto_cae,
          fecha_emision, customer_id, 
          importe_neto, importe_iva, importe_total,
          items, notes, pdf_url, xml_url, status, arca_hash, 
          numero_comprobante, original_invoice_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          tipoComprobanteNC,
          puntoVentaNC,
          notaCreditoData.cae || null,
          notaCreditoData.vto_cae
            ? new Date(notaCreditoData.vto_cae)
            : null,
          fechaEmisionNc,
          originalInvoice.customer_id || null,
          netoNc,
          ivaNc,
          totalNc,
          JSON.stringify(itemsToStore),
          ncNotes,
          notaCreditoData.pdf_url || null,
          notaCreditoData.xml_url || null,
          "approved",
          ncHash,
          numeroNC || null,
          invoice_id,
        ]
      );

      return res.status(201).json({
        ok: true,
        data: {
          id: result.insertId,
          tipo_comprobante: tipoComprobanteNC,
          punto_venta: puntoVentaNC,
          numero_comprobante: numeroNC || null,
          cae: notaCreditoData.cae || null,
          vto_cae: notaCreditoData.vto_cae || null,
        },
      });
    } catch (error) {
      console.error(
        "[POST /api/invoicing/arca/nota-credito] Error:",
        error
      );
      return res
        .status(500)
        .json({ ok: false, error: error.message });
    }
  }
);


// GET /api/invoicing/constants - Obtener constantes para el frontend
router.get("/constants", requireAuth, async (req, res) => {
  res.json({
    ok: true,
    data: {
      COMPROBANTE_TIPOS,
      DOCUMENTO_TIPOS,
      CONDICIONES_IVA,
      CONCEPTOS
    }
  });
});

export default router;