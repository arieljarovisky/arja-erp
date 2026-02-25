// src/services/whatsappHub.js
import { pool } from "../db.js";

function mapRow(row) {
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    phoneNumberId: row.phone_number_id || null,
    accessToken: row.whatsapp_token || null,
    refreshToken: row.refresh_token || null,
    tokenExpiresAt: row.token_expires_at || null,
    verifyToken: row.whatsapp_verify_token || null,
    phoneDisplay: row.phone_display || null,
    supportAgentEnabled: !!row.support_agent_enabled,
    supportAgentPhone: row.support_agent_phone ?? null, // Usar ?? en lugar de || para preservar strings vacíos
    isActive: !!row.is_active,
    hasCredentials: Boolean(row.whatsapp_token && (row.phone_number_id && !row.phone_number_id.startsWith("pending:"))),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    managedBy: row.managed_by || null,
    managedNotes: row.managed_notes || null,
  };
}

export async function getTenantWhatsAppHub(tenantId) {
  // Intentar obtener con las nuevas columnas primero
  try {
    const [[row]] = await pool.query(
      `SELECT
          tenant_id,
          phone_number_id,
          whatsapp_token,
          refresh_token,
          token_expires_at,
          whatsapp_verify_token,
          phone_display,
          COALESCE(support_agent_enabled, 0) as support_agent_enabled,
          support_agent_phone,
          is_active,
          created_at,
          updated_at,
          managed_by,
          managed_notes
        FROM tenant_whatsapp_config
        WHERE tenant_id = ?
        ORDER BY 
          is_active DESC,
          updated_at DESC,
          created_at DESC
        LIMIT 1`,
      [tenantId]
    );

    if (row) {
      console.log(`[WA Hub] Lectura de BD para tenant ${tenantId}:`, {
        support_agent_enabled: row.support_agent_enabled,
        support_agent_phone: row.support_agent_phone,
        support_agent_phone_type: typeof row.support_agent_phone,
        is_active: row.is_active,
      });
    }

    const mapped = mapRow(row);
    if (mapped) {
      console.log(`[WA Hub] Configuración mapeada para tenant ${tenantId}:`, {
        supportAgentEnabled: mapped.supportAgentEnabled,
        supportAgentPhone: mapped.supportAgentPhone,
        supportAgentPhoneType: typeof mapped.supportAgentPhone,
      });
    }

    return mapped;
  } catch (error) {
    // Si las columnas no existen aún (migración no ejecutada), usar consulta sin ellas
    const errorStr = JSON.stringify(error).toLowerCase();
    const isColumnError = error.code === 'ER_BAD_FIELD_ERROR' || 
                          error.errno === 1054 ||
                          error.sqlState === '42S22' ||
                          errorStr.includes('support_agent_enabled') ||
                          errorStr.includes('support_agent_phone') ||
                          (error.sqlMessage && (error.sqlMessage.includes('support_agent_enabled') || error.sqlMessage.includes('support_agent_phone'))) ||
                          (error.message && (error.message.includes('support_agent_enabled') || error.message.includes('support_agent_phone')));
    
    console.log('[WA Hub] Error capturado:', {
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      message: error.message,
      sqlMessage: error.sqlMessage,
      isColumnError
    });
    
    if (isColumnError) {
      console.warn('[WA Hub] Columnas de agente de soporte no encontradas, usando consulta compatible. Ejecutá la migración 060_add_support_agent_phone_to_tenant_whatsapp_config.sql');
      try {
        const [[row]] = await pool.query(
          `SELECT
              tenant_id,
              phone_number_id,
              whatsapp_token,
              refresh_token,
              token_expires_at,
              whatsapp_verify_token,
              phone_display,
              0 as support_agent_enabled,
              NULL as support_agent_phone,
              is_active,
              created_at,
              updated_at,
              managed_by,
              managed_notes
            FROM tenant_whatsapp_config
            WHERE tenant_id = ?
            ORDER BY 
              is_active DESC,
              updated_at DESC,
              created_at DESC
            LIMIT 1`,
          [tenantId]
        );

        return mapRow(row);
      } catch (fallbackError) {
        console.error('[WA Hub] Error en consulta de fallback:', fallbackError);
        throw fallbackError;
      }
    }
    throw error;
  }
}

export async function updateTenantWhatsAppContact(tenantId, { phoneDisplay }) {
  if (phoneDisplay === undefined) return;
  const [[existing]] = await pool.query(
    `SELECT phone_number_id FROM tenant_whatsapp_config 
     WHERE tenant_id = ? 
     ORDER BY is_active DESC, updated_at DESC, created_at DESC
     LIMIT 1`,
    [tenantId]
  );

  if (existing) {
    await pool.query(
      `UPDATE tenant_whatsapp_config
         SET phone_display = ?, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?`,
      [phoneDisplay || null, tenantId]
    );
  } else {
    const placeholder = `pending:${tenantId}`;
    await pool.query(
      `INSERT INTO tenant_whatsapp_config
         (tenant_id, phone_number_id, whatsapp_token, phone_display, is_active, created_at, updated_at)
       VALUES (?, ?, '', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [tenantId, placeholder, phoneDisplay || null]
    );
  }
}

export async function setTenantWhatsAppActive(tenantId, isActive) {
  await pool.query(
    `UPDATE tenant_whatsapp_config
        SET is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?`,
    [isActive ? 1 : 0, tenantId]
  );
}

export async function upsertTenantWhatsAppCredentials(
  tenantId,
  {
    phoneNumberId,
    accessToken,
    verifyToken = null,
    refreshToken = null,
    tokenExpiresAt = null,
    phoneDisplay = null,
    isActive = true,
    managedBy = null,
    managedNotes = null,
    supportAgentEnabled = null,
    supportAgentPhone = null,
  }
) {
  if (!tenantId) {
    throw new Error("tenantId requerido");
  }
  // phoneNumberId puede ser null temporalmente (se obtendrá después cuando el usuario configure el número)
  // if (!phoneNumberId) {
  //   throw new Error("phoneNumberId es requerido");
  // }

  const [[existing]] = await pool.query(
    `SELECT whatsapp_token FROM tenant_whatsapp_config 
     WHERE tenant_id = ? 
     ORDER BY is_active DESC, updated_at DESC, created_at DESC
     LIMIT 1`,
    [tenantId]
  );
  const normalizedToken = accessToken?.trim() || existing?.whatsapp_token || null;
  if (!normalizedToken) {
    throw new Error("accessToken es requerido");
  }

  // Construir la query dinámicamente para incluir solo los campos que se proporcionan
  const updateFields = [];
  const insertFields = ['tenant_id', 'phone_number_id', 'whatsapp_token', 'refresh_token', 'token_expires_at', 'whatsapp_verify_token', 'phone_display', 'is_active', 'managed_by', 'managed_notes'];
  const insertValues = [tenantId, phoneNumberId, normalizedToken, refreshToken, tokenExpiresAt, verifyToken, phoneDisplay, isActive ? 1 : 0, managedBy, managedNotes];
  
  // Agregar campos de agente si se proporcionan
  if (supportAgentEnabled !== null) {
    insertFields.push('support_agent_enabled');
    insertValues.push(supportAgentEnabled ? 1 : 0);
    updateFields.push('support_agent_enabled = VALUES(support_agent_enabled)');
  }
  if (supportAgentPhone !== null) {
    insertFields.push('support_agent_phone');
    insertValues.push(supportAgentPhone);
    updateFields.push('support_agent_phone = VALUES(support_agent_phone)');
  }
  
  const placeholders = insertFields.map(() => '?').join(', ');
  const updateClause = [
    'phone_number_id = VALUES(phone_number_id)',
    'whatsapp_token = VALUES(whatsapp_token)',
    'refresh_token = VALUES(refresh_token)',
    'token_expires_at = VALUES(token_expires_at)',
    'whatsapp_verify_token = VALUES(whatsapp_verify_token)',
    'phone_display = VALUES(phone_display)',
    'is_active = VALUES(is_active)',
    'managed_by = VALUES(managed_by)',
    'managed_notes = VALUES(managed_notes)',
    ...updateFields,
    'updated_at = CURRENT_TIMESTAMP'
  ].join(', ');

  await pool.query(
    `INSERT INTO tenant_whatsapp_config (${insertFields.join(', ')})
     VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updateClause}`,
    insertValues
  );

  return getTenantWhatsAppHub(tenantId);
}

export async function updateTenantSupportAgentConfig(tenantId, { supportAgentEnabled, supportAgentPhone }) {
  if (!tenantId) {
    throw new Error("tenantId requerido");
  }

  const updates = [];
  const values = [];

  if (supportAgentEnabled !== undefined && supportAgentEnabled !== null) {
    updates.push('support_agent_enabled = ?');
    values.push(supportAgentEnabled ? 1 : 0);
  }

  if (supportAgentPhone !== undefined) {
    updates.push('support_agent_phone = ?');
    // Normalizar: cadena vacía se convierte a null, pero mantener el valor si tiene contenido
    const normalizedPhone = supportAgentPhone && String(supportAgentPhone).trim() ? String(supportAgentPhone).trim() : null;
    values.push(normalizedPhone);
    console.log(`[WA Hub] Actualizando support_agent_phone para tenant ${tenantId}:`, {
      original: supportAgentPhone,
      originalType: typeof supportAgentPhone,
      originalLength: supportAgentPhone?.length,
      normalized: normalizedPhone,
      normalizedType: typeof normalizedPhone,
      willUpdate: true,
    });
  } else {
    console.log(`[WA Hub] support_agent_phone no se actualizará para tenant ${tenantId} (undefined)`);
  }

  if (updates.length === 0) {
    return getTenantWhatsAppHub(tenantId);
  }

  values.push(tenantId);

  try {
    // Primero verificar cuántas filas hay para este tenant
    const [existingRows] = await pool.query(
      `SELECT id, tenant_id, support_agent_phone, support_agent_enabled, is_active 
       FROM tenant_whatsapp_config 
       WHERE tenant_id = ? 
       ORDER BY is_active DESC, updated_at DESC, created_at DESC`,
      [tenantId]
    );
    console.log(`[WA Hub] Filas existentes para tenant ${tenantId}:`, existingRows.length);
    if (existingRows.length > 0) {
      console.log(`[WA Hub] Primera fila (la que se actualizará):`, {
        id: existingRows[0].id,
        support_agent_phone: existingRows[0].support_agent_phone,
        support_agent_enabled: existingRows[0].support_agent_enabled,
        is_active: existingRows[0].is_active,
      });
    }
    
    // Actualizar solo la fila más reciente/activa para evitar problemas con múltiples filas
    // Si estamos actualizando support_agent_phone, priorizar la fila que tiene support_agent_enabled = 1
    // Primero obtener el ID de la fila que se debe actualizar
    let targetRows;
    if (supportAgentPhone !== undefined) {
      // Si estamos actualizando el número del agente, buscar la fila con support_agent_enabled = 1
      [targetRows] = await pool.query(
        `SELECT id, support_agent_enabled, is_active FROM tenant_whatsapp_config 
         WHERE tenant_id = ? 
         ORDER BY support_agent_enabled DESC, is_active DESC, updated_at DESC, created_at DESC 
         LIMIT 1`,
        [tenantId]
      );
      console.log(`[WA Hub] Buscando fila para actualizar support_agent_phone. Filas encontradas:`, targetRows.length);
    } else {
      // Para otros campos, usar la lógica normal
      [targetRows] = await pool.query(
        `SELECT id FROM tenant_whatsapp_config 
         WHERE tenant_id = ? 
         ORDER BY is_active DESC, updated_at DESC, created_at DESC 
         LIMIT 1`,
        [tenantId]
      );
    }
    
    if (targetRows.length === 0) {
      console.warn(`[WA Hub] ⚠️ No se encontró ninguna fila para actualizar para tenant ${tenantId}`);
      return getTenantWhatsAppHub(tenantId);
    }
    
    const targetId = targetRows[0].id;
    console.log(`[WA Hub] Actualizando fila con id ${targetId} para tenant ${tenantId}`, {
      support_agent_enabled: targetRows[0].support_agent_enabled,
      is_active: targetRows[0].is_active,
      updatingSupportAgentPhone: supportAgentPhone !== undefined,
    });
    
    const query = `UPDATE tenant_whatsapp_config
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`;
    console.log(`[WA Hub] Ejecutando query:`, query);
    console.log(`[WA Hub] Valores:`, [...values.slice(0, -1), targetId]);
    const result = await pool.query(query, [...values.slice(0, -1), targetId]);
    console.log(`[WA Hub] ✅ Query ejecutada exitosamente. Filas afectadas:`, result[0]?.affectedRows || 0);
    
    // Verificar que se actualizó correctamente
    const [updatedRows] = await pool.query(
      `SELECT id, tenant_id, support_agent_phone, support_agent_enabled 
       FROM tenant_whatsapp_config 
       WHERE tenant_id = ? 
       ORDER BY is_active DESC, updated_at DESC, created_at DESC 
       LIMIT 1`,
      [tenantId]
    );
    if (updatedRows.length > 0) {
      console.log(`[WA Hub] ✅ Valor actualizado en BD:`, {
        id: updatedRows[0].id,
        support_agent_phone: updatedRows[0].support_agent_phone,
        support_agent_enabled: updatedRows[0].support_agent_enabled,
      });
    }
  } catch (error) {
    // Si las columnas no existen aún (migración no ejecutada)
    const isColumnError = error.code === 'ER_BAD_FIELD_ERROR' || 
                          error.errno === 1054 ||
                          (error.sqlMessage && (error.sqlMessage.includes('support_agent_enabled') || error.sqlMessage.includes('support_agent_phone'))) ||
                          (error.message && (error.message.includes('support_agent_enabled') || error.message.includes('support_agent_phone')));
    
    if (isColumnError) {
      console.warn('[WA Hub] No se pueden actualizar las columnas de agente de soporte porque aún no existen. Ejecutá la migración 060_add_support_agent_phone_to_tenant_whatsapp_config.sql');
      // No lanzar error, simplemente retornar la configuración actual
      return getTenantWhatsAppHub(tenantId);
    }
    throw error;
  }

  return getTenantWhatsAppHub(tenantId);
}

export async function clearTenantWhatsAppCredentials(tenantId) {
  await pool.query(
    `DELETE FROM tenant_whatsapp_config
      WHERE tenant_id = ?`,
    [tenantId]
  );
}

