/**
 * Servicio para enviar notificaciones push usando Expo Push Notification API
 */
import { pool } from '../db.js';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Envía una notificación push a un token específico
 * @param {string} pushToken - Token de Expo Push
 * @param {object} notification - Objeto con title, body, data, etc.
 * @returns {Promise<object>} Respuesta de la API de Expo
 */
export async function sendPushNotification(pushToken, notification) {
  if (!pushToken) {
    throw new Error('pushToken es requerido');
  }

  const message = {
    to: pushToken,
    sound: 'default',
    title: notification.title || 'ARJA ERP',
    body: notification.body || '',
    data: notification.data || {},
    priority: notification.priority || 'default',
    ...(notification.badge !== undefined && { badge: notification.badge }),
  };

  try {
    const response = await fetch(EXPO_PUSH_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();
    
    if (result.data?.status === 'error') {
      console.error('[PushNotifications] Error enviando notificación:', result.data);
      throw new Error(result.data.message || 'Error enviando notificación');
    }

    return result;
  } catch (error) {
    console.error('[PushNotifications] Error en sendPushNotification:', error);
    throw error;
  }
}

/**
 * Envía notificaciones push a múltiples tokens
 * @param {string[]} pushTokens - Array de tokens de Expo Push
 * @param {object} notification - Objeto con title, body, data, etc.
 * @returns {Promise<object>} Respuesta de la API de Expo
 */
export async function sendPushNotifications(pushTokens, notification) {
  if (!Array.isArray(pushTokens) || pushTokens.length === 0) {
    throw new Error('pushTokens debe ser un array no vacío');
  }

  const messages = pushTokens.map(token => ({
    to: token,
    sound: 'default',
    title: notification.title || 'ARJA ERP',
    body: notification.body || '',
    data: notification.data || {},
    priority: notification.priority || 'default',
    ...(notification.badge !== undefined && { badge: notification.badge }),
  }));

  try {
    const response = await fetch(EXPO_PUSH_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();
    
    // La API de Expo devuelve un array de resultados
    const errors = result.data?.filter(r => r.status === 'error') || [];
    if (errors.length > 0) {
      console.error('[PushNotifications] Errores enviando notificaciones:', errors);
    }

    return result;
  } catch (error) {
    console.error('[PushNotifications] Error en sendPushNotifications:', error);
    throw error;
  }
}

/**
 * Obtiene el token push de un cliente
 * @param {number} tenantId - ID del tenant
 * @param {number} customerId - ID del cliente
 * @returns {Promise<string|null>} Token push o null si no existe
 */
export async function getCustomerPushToken(tenantId, customerId) {
  try {
    const [rows] = await pool.query(
      `SELECT push_token 
       FROM customer_app_settings 
       WHERE tenant_id = ? AND customer_id = ? AND push_token IS NOT NULL`,
      [tenantId, customerId]
    );

    return rows.length > 0 ? rows[0].push_token : null;
  } catch (error) {
    console.error('[PushNotifications] Error obteniendo token:', error);
    return null;
  }
}

/**
 * Obtiene todos los tokens push de clientes de un tenant
 * @param {number} tenantId - ID del tenant
 * @param {number[]} customerIds - IDs de clientes (opcional, si no se proporciona, obtiene todos)
 * @returns {Promise<Array<{customerId: number, pushToken: string}>>} Array de tokens
 */
export async function getCustomerPushTokens(tenantId, customerIds = null) {
  try {
    let query = `
      SELECT customer_id, push_token 
      FROM customer_app_settings 
      WHERE tenant_id = ? AND push_token IS NOT NULL
    `;
    const params = [tenantId];

    if (customerIds && Array.isArray(customerIds) && customerIds.length > 0) {
      query += ` AND customer_id IN (${customerIds.map(() => '?').join(',')})`;
      params.push(...customerIds);
    }

    const [rows] = await pool.query(query, params);

    return rows.map(row => ({
      customerId: row.customer_id,
      pushToken: row.push_token,
    }));
  } catch (error) {
    console.error('[PushNotifications] Error obteniendo tokens:', error);
    return [];
  }
}

/**
 * Envía una notificación push a un cliente específico
 * @param {number} tenantId - ID del tenant
 * @param {number} customerId - ID del cliente
 * @param {object} notification - Objeto con title, body, data, etc.
 * @returns {Promise<boolean>} true si se envió exitosamente, false si no hay token
 */
export async function sendNotificationToCustomer(tenantId, customerId, notification) {
  try {
    const pushToken = await getCustomerPushToken(tenantId, customerId);
    
    if (!pushToken) {
      console.log(`[PushNotifications] Cliente ${customerId} no tiene token push registrado`);
      return false;
    }

    await sendPushNotification(pushToken, notification);
    console.log(`[PushNotifications] Notificación enviada a cliente ${customerId}`);
    return true;
  } catch (error) {
    console.error(`[PushNotifications] Error enviando notificación a cliente ${customerId}:`, error);
    return false;
  }
}

/**
 * Envía notificaciones push a múltiples clientes
 * @param {number} tenantId - ID del tenant
 * @param {number[]} customerIds - IDs de clientes
 * @param {object} notification - Objeto con title, body, data, etc.
 * @returns {Promise<{sent: number, failed: number}>} Estadísticas de envío
 */
export async function sendNotificationsToCustomers(tenantId, customerIds, notification) {
  try {
    const tokens = await getCustomerPushTokens(tenantId, customerIds);
    
    if (tokens.length === 0) {
      console.log(`[PushNotifications] No hay tokens push para los clientes especificados`);
      return { sent: 0, failed: 0 };
    }

    const pushTokens = tokens.map(t => t.pushToken).filter(Boolean);
    
    if (pushTokens.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const result = await sendPushNotifications(pushTokens, notification);
    
    // Contar éxitos y errores
    const results = result.data || [];
    const sent = results.filter(r => r.status === 'ok').length;
    const failed = results.filter(r => r.status === 'error').length;

    console.log(`[PushNotifications] Enviadas: ${sent}, Fallidas: ${failed}`);
    
    return { sent, failed };
  } catch (error) {
    console.error('[PushNotifications] Error enviando notificaciones a clientes:', error);
    return { sent: 0, failed: customerIds.length };
  }
}

