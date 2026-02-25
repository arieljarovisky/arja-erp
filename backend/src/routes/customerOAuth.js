// src/routes/customerOAuth.js — OAuth para CLIENTES (app móvil)
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

export const customerOAuth = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Helper para obtener la URL base del backend
function baseUrlFromReq(req) {
  const envBase =
    process.env.API_URL ||
    process.env.BACKEND_URL ||
    process.env.SERVER_URL ||
    process.env.BASE_URL;
  if (envBase) return String(envBase).replace(/\/+$/, "");
  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    req.protocol ||
    "https";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function getRedirectUri(req) {
  const base = baseUrlFromReq(req);
  return `${String(base).replace(/\/+$/, "")}/api/public/customer/oauth/google/callback`;
}

/**
 * GET /api/public/customer/oauth/google
 * Inicia el flujo OAuth de Google para clientes
 */
customerOAuth.get("/google", async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "Google OAuth no está configurado. Faltan credenciales.",
      });
    }

    // Permitir redirect_uri personalizado desde query (para app móvil)
    const customRedirectUri = req.query.redirect_uri || null;
    const redirectUri = customRedirectUri || getRedirectUri(req);

    const client = new OAuth2Client(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    // State opcional para redirección después del login
    // Incluir el redirect_uri, deep link de la app y tenant_id/código de negocio en el state
    const next = req.query.next || "";
    const tenantId = req.query.tenant_id || null;
    const tenantCode = req.query.tenant_code || null;
    const appDeepLink = req.query.app_deep_link || null; // Deep link de la app móvil
    const stateData = {
      next,
      redirect_uri: customRedirectUri || null,
      app_deep_link: appDeepLink || null, // Deep link para redirigir a la app móvil
      tenant_id: tenantId ? parseInt(tenantId, 10) : null,
      tenant_code: tenantCode || null,
    };
    const state = Buffer.from(JSON.stringify(stateData)).toString("base64url");

    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
      state,
      prompt: "consent",
    });

    console.log(`[Customer OAuth] URL de autorización generada`);
    console.log(`  Redirect URI: ${redirectUri}`);

    return res.json({ ok: true, authUrl });
  } catch (err) {
    console.error("❌ [Customer OAuth] Error generando URL:", err);
    return res.status(500).json({
      ok: false,
      error: "Error generando URL de autorización",
    });
  }
});

/**
 * GET /api/public/customer/oauth/google/callback
 * Maneja el callback de Google OAuth para clientes
 */
customerOAuth.get("/google/callback", async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    // Decodificar state para obtener el deep link de la app móvil
    let appDeepLink = null;
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
        appDeepLink = stateData.app_deep_link || null;
      } catch (e) {
        console.error("[Customer OAuth] Error decodificando state:", e);
      }
    }

    // Si hay un deep link de la app móvil, redirigir al deep link con el código
    if (appDeepLink && code) {
      console.log(`[Customer OAuth] Redirigiendo a app móvil: ${appDeepLink}?code=${code}`);
      return res.redirect(`${appDeepLink}?code=${code}`);
    }

    // Si hay un deep link de la app móvil pero hay error, redirigir con error
    if (appDeepLink && oauthError) {
      console.error(`[Customer OAuth] Error en callback (app móvil): ${oauthError}`);
      return res.redirect(`${appDeepLink}?error=${oauthError}&error_description=OAuth_cancelado_o_error`);
    }

    // Si no hay redirect_uri personalizado, procesar como web (comportamiento anterior)
    if (oauthError) {
      console.error(`[Customer OAuth] Error en callback: ${oauthError}`);
      return res.json({ 
        ok: false, 
        error: "OAuth cancelado o error",
        errorCode: oauthError 
      });
    }

    if (!code) {
      return res.json({ 
        ok: false, 
        error: "Código de autorización no recibido" 
      });
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.json({ 
        ok: false, 
        error: "OAuth no configurado" 
      });
    }

    const client = new OAuth2Client(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      getRedirectUri(req)
    );

    // Intercambiar code por tokens
    let tokens;
    try {
      const tokenResponse = await client.getToken(code);
      tokens = tokenResponse.tokens;
    } catch (tokenError) {
      console.error("❌ [Customer OAuth] Error obteniendo tokens:", tokenError);
      return res.json({
        ok: false,
        error: "Error al intercambiar código por tokens. Verificá que el código sea válido y el redirect_uri coincida.",
        errorDetails: tokenError.message,
      });
    }

    if (!tokens || !tokens.id_token) {
      console.error("❌ [Customer OAuth] No se recibió id_token en los tokens:", tokens);
      return res.json({
        ok: false,
        error: "No se recibió el token de identidad de Google. Verificá la configuración OAuth.",
      });
    }

    client.setCredentials(tokens);

    // Obtener información del usuario de Google
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: GOOGLE_CLIENT_ID,
      });
    } catch (verifyError) {
      console.error("❌ [Customer OAuth] Error verificando id_token:", verifyError);
      return res.json({
        ok: false,
        error: "Error al verificar el token de Google. Verificá la configuración OAuth.",
        errorDetails: verifyError.message,
      });
    }

    const payload = ticket.getPayload();
    if (!payload) {
      return res.json({
        ok: false,
        error: "No se pudo obtener la información del usuario de Google",
      });
    }

    const googleEmail = payload.email?.toLowerCase();
    const googleName = payload.name;
    const googlePicture = payload.picture;

    if (!googleEmail) {
      return res.json({ 
        ok: false, 
        error: "No se pudo obtener el email de Google" 
      });
    }

    console.log(`[Customer OAuth] Cliente autenticado: ${googleEmail}`);

    // Buscar cliente(s) por email
    const [customersByEmail] = await pool.query(
      `SELECT c.id, c.name, c.phone_e164, c.email, c.documento, c.tenant_id, c.picture,
              t.name AS tenant_name, t.subdomain AS tenant_slug, t.status AS tenant_status
       FROM customer c
       JOIN tenant t ON t.id = c.tenant_id
       WHERE c.email = ? AND t.status = 'active'
       ORDER BY c.created_at DESC, c.id DESC`,
      [googleEmail]
    );

    let customer = null;
    let tenants = [];

    if (customersByEmail.length > 0) {
      // Cliente existe - puede tener múltiples tenants
      tenants = customersByEmail.map((c) => ({
        tenant_id: c.tenant_id,
        tenant_name: c.tenant_name,
        tenant_slug: c.tenant_slug,
        customer_id: c.id,
        customer_name: c.name,
        customer_phone: c.phone_e164,
        customer_email: c.email,
        customer_dni: c.documento,
      }));

      // Si solo hay un tenant, usar ese cliente directamente
      if (tenants.length === 1) {
        const c = customersByEmail[0];
        customer = {
          customer_id: c.id,
          tenant_id: c.tenant_id,
          tenant_name: c.tenant_name,
          tenant_slug: c.tenant_slug,
          name: c.name,
          phone: c.phone_e164,
          email: c.email,
          dni: c.documento,
          picture: c.picture || googlePicture || null, // Priorizar foto del usuario sobre Google
        };

        // Actualizar nombre si viene de Google y no tiene nombre
        if (googleName && !c.name) {
          await pool.query(
            `UPDATE customer SET name = ? WHERE id = ? AND tenant_id = ?`,
            [googleName, c.id, c.tenant_id]
          );
          customer.name = googleName;
        }
        
        // Actualizar foto de perfil solo si el usuario no tiene una foto configurada manualmente
        // Priorizar la foto que el usuario haya configurado sobre la de Google
        if (googlePicture && !c.picture) {
          await pool.query(
            `UPDATE customer SET picture = ? WHERE id = ? AND tenant_id = ?`,
            [googlePicture, c.id, c.tenant_id]
          );
          customer.picture = googlePicture;
        } else if (c.picture) {
          // Si el usuario ya tiene una foto, mantenerla (no sobrescribir con Google)
          customer.picture = c.picture;
        }
      }
      // Si hay múltiples tenants, retornar lista para selección
    } else {
      // Cliente no existe - intentar crear automáticamente si hay tenant_id en el state
      // Decodificar state para obtener tenant_id o tenant_code
      let tenantIdFromState = null;
      let next = "";
      
      if (state) {
        try {
          const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
          next = stateData.next || "";
          
          // Intentar obtener tenant_id o resolver tenant_code
          if (stateData.tenant_id) {
            tenantIdFromState = parseInt(stateData.tenant_id, 10);
          } else if (stateData.tenant_code) {
            // Resolver tenant_code a tenant_id
            const code = String(stateData.tenant_code).trim();
            let tenant = null;
            
            // Intentar como ID numérico
            if (/^\d+$/.test(code)) {
              const [rowsById] = await pool.query(
                `SELECT id, name, subdomain, status 
                 FROM tenant 
                 WHERE id = ? AND status = 'active' 
                 LIMIT 1`,
                [parseInt(code, 10)]
              );
              tenant = rowsById[0];
            }
            
            // Si no se encontró, intentar como subdomain/slug
            if (!tenant) {
              const [rowsBySlug] = await pool.query(
                `SELECT id, name, subdomain, status 
                 FROM tenant 
                 WHERE subdomain = ? AND status = 'active' 
                 LIMIT 1`,
                [code]
              );
              tenant = rowsBySlug[0];
            }
            
            if (tenant) {
              tenantIdFromState = tenant.id;
            }
          }
        } catch (e) {
          console.error("[Customer OAuth] Error decodificando state:", e);
        }
      }
      
      // Si tenemos tenant_id, crear el cliente automáticamente
      if (tenantIdFromState) {
        try {
          // Verificar que el tenant existe y está activo
          const [[tenant]] = await pool.query(
            `SELECT id, name, subdomain, status FROM tenant WHERE id = ? AND status = 'active' LIMIT 1`,
            [tenantIdFromState]
          );
          
          if (!tenant) {
            return res.json({
              ok: false,
              error: "Negocio no encontrado o inactivo",
              errorCode: "TENANT_NOT_FOUND",
            });
          }
          
          // Crear cliente con email de Google
          await pool.query(
            `INSERT INTO customer (tenant_id, email, name) 
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE 
               name = COALESCE(VALUES(name), name),
               email = COALESCE(VALUES(email), email)`,
            [tenantIdFromState, googleEmail, googleName || null]
          );
          
          // Obtener el cliente creado
          const [newCustomers] = await pool.query(
            `SELECT c.id, c.name, c.phone_e164, c.email, c.documento, c.tenant_id,
                    t.name AS tenant_name, t.subdomain AS tenant_slug, t.status AS tenant_status
             FROM customer c
             JOIN tenant t ON t.id = c.tenant_id
             WHERE c.email = ? AND c.tenant_id = ? AND t.status = 'active'
             LIMIT 1`,
            [googleEmail, tenantIdFromState]
          );
          
          if (newCustomers.length > 0) {
            const c = newCustomers[0];
            customer = {
              customer_id: c.id,
              tenant_id: c.tenant_id,
              tenant_name: c.tenant_name,
              tenant_slug: c.tenant_slug,
              name: c.name,
              phone: c.phone_e164,
              email: c.email,
              dni: c.documento,
            };
            
            console.log(`[Customer OAuth] Cliente creado automáticamente: ${googleEmail} en tenant ${tenantIdFromState}`);
          }
        } catch (createError) {
          console.error("[Customer OAuth] Error creando cliente:", createError);
          return res.json({
            ok: false,
            error: "Error al crear el cliente",
            errorCode: "CREATE_CUSTOMER_ERROR",
            errorDetails: createError.message,
          });
        }
      } else {
        // No hay tenant_id - retornar error para que la app muestre selección de negocio
        return res.json({
          ok: false,
          error: "Cliente no encontrado",
          errorCode: "CUSTOMER_NOT_FOUND",
          needsTenantSelection: true,
          message: "No se encontró una cuenta asociada a este email. Por favor, seleccioná el negocio donde querés registrarte.",
          email: googleEmail,
          name: googleName,
        });
      }
    }

    // Decodificar state para obtener 'next' (si no se hizo antes)
    let next = "";
    if (state && !next) {
      try {
        const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
        next = stateData.next || "";
      } catch (e) {
        console.error("[Customer OAuth] Error decodificando state:", e);
      }
    }

    // Si hay un solo tenant, retornar datos del cliente directamente
    if (customer) {
      return res.json({
        ok: true,
        data: customer,
        next,
      });
    }

    // Si hay múltiples tenants, retornar lista para selección
    if (tenants.length > 1) {
      return res.json({
        ok: true,
        multipleTenants: true,
        tenants,
        email: googleEmail,
        name: googleName,
        next,
      });
    }

    // Si no hay clientes, retornar error
    return res.json({
      ok: false,
      error: "No se encontraron negocios asociados",
      errorCode: "NO_TENANTS_FOUND",
    });
  } catch (err) {
    console.error("❌ [Customer OAuth] Error en callback:", err);
    return res.json({
      ok: false,
      error: err.message || "Error en autenticación OAuth",
    });
  }
});

/**
 * POST /api/public/customer/oauth/exchange-code
 * Intercambia un código OAuth por datos del cliente (para app móvil)
 * Body: { code, redirect_uri }
 */
customerOAuth.post("/exchange-code", async (req, res) => {
  console.log('[Customer OAuth] POST /exchange-code recibido');
  console.log('[Customer OAuth] Body recibido:', JSON.stringify(req.body, null, 2));
  try {
    const { code, redirect_uri, tenant_id, tenant_code } = req.body || {};

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "Código de autorización requerido",
      });
    }

    // Verificar conexión a la base de datos antes de continuar
    try {
      await pool.query("SELECT 1");
    } catch (dbError) {
      console.error("[Customer OAuth] Error de conexión a la base de datos:", dbError.message);
      return res.status(503).json({
        ok: false,
        error: "Error de conexión con la base de datos. Por favor, intentá nuevamente en unos momentos.",
        errorCode: "DATABASE_CONNECTION_ERROR",
        errorDetails: process.env.NODE_ENV === 'development' ? dbError.message : undefined,
      });
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "OAuth no configurado",
      });
    }

    // Usar el redirect_uri proporcionado o el callback por defecto
    const usedRedirectUri = redirect_uri || getRedirectUri(req);

    const client = new OAuth2Client(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      usedRedirectUri
    );

    // Intercambiar code por tokens
    let tokens;
    try {
      const tokenResponse = await client.getToken(code);
      tokens = tokenResponse.tokens;
    } catch (tokenError) {
      console.error("❌ [Customer OAuth] Error obteniendo tokens:", tokenError);
      return res.status(400).json({
        ok: false,
        error: "Error al intercambiar código por tokens. Verificá que el código sea válido y el redirect_uri coincida.",
        errorDetails: tokenError.message,
      });
    }

    if (!tokens || !tokens.id_token) {
      console.error("❌ [Customer OAuth] No se recibió id_token en los tokens:", tokens);
      return res.status(400).json({
        ok: false,
        error: "No se recibió el token de identidad de Google. Verificá la configuración OAuth.",
      });
    }

    client.setCredentials(tokens);

    // Obtener información del usuario de Google
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: GOOGLE_CLIENT_ID,
      });
    } catch (verifyError) {
      console.error("❌ [Customer OAuth] Error verificando id_token:", verifyError);
      return res.status(400).json({
        ok: false,
        error: "Error al verificar el token de Google. Verificá la configuración OAuth.",
        errorDetails: verifyError.message,
      });
    }

    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(400).json({
        ok: false,
        error: "No se pudo obtener la información del usuario de Google",
      });
    }

    const googleEmail = payload.email?.toLowerCase();
    const googleName = payload.name;
    const googlePicture = payload.picture;

    if (!googleEmail) {
      return res.json({
        ok: false,
        error: "No se pudo obtener el email de Google",
      });
    }

    console.log(`[Customer OAuth] Cliente autenticado: ${googleEmail}`);

    // Buscar cliente(s) por email
    const [customersByEmail] = await pool.query(
      `SELECT c.id, c.name, c.phone_e164, c.email, c.documento, c.tenant_id, c.picture,
              t.name AS tenant_name, t.subdomain AS tenant_slug, t.status AS tenant_status
       FROM customer c
       JOIN tenant t ON t.id = c.tenant_id
       WHERE c.email = ? AND t.status = 'active'
       ORDER BY c.created_at DESC, c.id DESC`,
      [googleEmail]
    );

    let customer = null;
    let tenants = [];

    if (customersByEmail.length > 0) {
      tenants = customersByEmail.map((c) => ({
        tenant_id: c.tenant_id,
        tenant_name: c.tenant_name,
        tenant_slug: c.tenant_slug,
        customer_id: c.id,
        customer_name: c.name,
        customer_phone: c.phone_e164,
        customer_email: c.email,
        customer_dni: c.documento,
      }));

      if (tenants.length === 1) {
        const c = customersByEmail[0];
        customer = {
          customer_id: c.id,
          tenant_id: c.tenant_id,
          tenant_name: c.tenant_name,
          tenant_slug: c.tenant_slug,
          name: c.name,
          phone: c.phone_e164,
          email: c.email,
          dni: c.documento,
          picture: c.picture || googlePicture || null, // Priorizar foto del usuario sobre Google
        };

        if (googleName && !c.name) {
          await pool.query(
            `UPDATE customer SET name = ? WHERE id = ? AND tenant_id = ?`,
            [googleName, c.id, c.tenant_id]
          );
          customer.name = googleName;
        }
        
        // Actualizar foto de perfil solo si el usuario no tiene una foto configurada manualmente
        // Priorizar la foto que el usuario haya configurado sobre la de Google
        if (googlePicture && !c.picture) {
          await pool.query(
            `UPDATE customer SET picture = ? WHERE id = ? AND tenant_id = ?`,
            [googlePicture, c.id, c.tenant_id]
          );
          customer.picture = googlePicture;
        } else if (c.picture) {
          // Si el usuario ya tiene una foto, mantenerla (no sobrescribir con Google)
          customer.picture = c.picture;
        }
      }
    } else {
      // Cliente no existe - intentar crear automáticamente si se proporcionó tenant_id
      let tenantIdToUse = null;
      
      // Intentar obtener tenant_id del body o resolver tenant_code
      if (tenant_id) {
        tenantIdToUse = parseInt(tenant_id, 10);
      } else if (tenant_code) {
        // Resolver tenant_code a tenant_id
        const code = String(tenant_code).trim();
        let tenant = null;
        
        // Intentar como ID numérico
        if (/^\d+$/.test(code)) {
          try {
            const [rowsById] = await pool.query(
              `SELECT id, name, subdomain, status, business_code
               FROM tenant 
               WHERE id = ? AND status = 'active' 
               LIMIT 1`,
              [parseInt(code, 10)]
            );
            tenant = rowsById[0];
          } catch (dbError) {
            console.error("[Customer OAuth] Error consultando tenant por ID:", dbError.message);
            if (dbError.code === 'ECONNREFUSED' || dbError.code === 'PROTOCOL_CONNECTION_LOST' || dbError.code === 'ETIMEDOUT') {
              return res.status(503).json({
                ok: false,
                error: "Error de conexión con la base de datos. Por favor, intentá nuevamente en unos momentos.",
                errorCode: "DATABASE_CONNECTION_ERROR",
              });
            }
            throw dbError;
          }
        }
        
        // Si no se encontró, intentar como business_code (código para app móvil)
        if (!tenant) {
          try {
            const [rowsByBusinessCode] = await pool.query(
              `SELECT id, name, subdomain, status, business_code
               FROM tenant 
               WHERE business_code = ? AND status = 'active' 
               LIMIT 1`,
              [code.toLowerCase()]
            );
            tenant = rowsByBusinessCode[0];
          } catch (dbError) {
            // Si el campo business_code no existe, ignorar el error y continuar
            if (dbError.code === 'ER_BAD_FIELD_ERROR' && dbError.sqlMessage?.includes("Unknown column 'business_code'")) {
              // Campo no existe aún, continuar con la búsqueda por subdomain
            } else if (dbError.code === 'ECONNREFUSED' || dbError.code === 'PROTOCOL_CONNECTION_LOST' || dbError.code === 'ETIMEDOUT') {
              return res.status(503).json({
                ok: false,
                error: "Error de conexión con la base de datos. Por favor, intentá nuevamente en unos momentos.",
                errorCode: "DATABASE_CONNECTION_ERROR",
              });
            } else {
              throw dbError;
            }
          }
        }
        
        // Si no se encontró, intentar como subdomain/slug
        if (!tenant) {
          try {
            const [rowsBySlug] = await pool.query(
              `SELECT id, name, subdomain, status, business_code
               FROM tenant 
               WHERE subdomain = ? AND status = 'active' 
               LIMIT 1`,
              [code]
            );
            tenant = rowsBySlug[0];
          } catch (dbError) {
            console.error("[Customer OAuth] Error consultando tenant por slug:", dbError.message);
            if (dbError.code === 'ECONNREFUSED' || dbError.code === 'PROTOCOL_CONNECTION_LOST' || dbError.code === 'ETIMEDOUT') {
              return res.status(503).json({
                ok: false,
                error: "Error de conexión con la base de datos. Por favor, intentá nuevamente en unos momentos.",
                errorCode: "DATABASE_CONNECTION_ERROR",
              });
            }
            throw dbError;
          }
        }
        
        if (tenant) {
          tenantIdToUse = tenant.id;
        }
      }
      
      // Si tenemos tenant_id, crear el cliente automáticamente
      if (tenantIdToUse) {
        try {
          // Verificar que el tenant existe y está activo
          const [[tenant]] = await pool.query(
            `SELECT id, name, subdomain, status FROM tenant WHERE id = ? AND status = 'active' LIMIT 1`,
            [tenantIdToUse]
          );
          
          if (!tenant) {
            return res.status(404).json({
              ok: false,
              error: "Negocio no encontrado o inactivo",
              errorCode: "TENANT_NOT_FOUND",
            });
          }
          
          // Crear cliente con email de Google
          // Solo establecer picture si no existe (no sobrescribir si el usuario ya tiene una)
          await pool.query(
            `INSERT INTO customer (tenant_id, email, name, picture) 
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
               name = COALESCE(VALUES(name), name),
               email = COALESCE(VALUES(email), email),
               picture = COALESCE(customer.picture, VALUES(picture))`,
            [tenantIdToUse, googleEmail, googleName || null, googlePicture || null]
          );
          
          // Obtener el cliente creado
          const [newCustomers] = await pool.query(
            `SELECT c.id, c.name, c.phone_e164, c.email, c.documento, c.tenant_id, c.picture,
                    t.name AS tenant_name, t.subdomain AS tenant_slug, t.status AS tenant_status
             FROM customer c
             JOIN tenant t ON t.id = c.tenant_id
             WHERE c.email = ? AND c.tenant_id = ? AND t.status = 'active'
             LIMIT 1`,
            [googleEmail, tenantIdToUse]
          );
          
          if (newCustomers.length > 0) {
            const c = newCustomers[0];
            customer = {
              customer_id: c.id,
              tenant_id: c.tenant_id,
              tenant_name: c.tenant_name,
              tenant_slug: c.tenant_slug,
              name: c.name,
              phone: c.phone_e164,
              email: c.email,
              dni: c.documento,
              picture: c.picture || googlePicture || null, // Priorizar foto del usuario sobre Google
            };
            
            console.log(`[Customer OAuth] Cliente creado automáticamente en exchange-code: ${googleEmail} en tenant ${tenantIdToUse}`);
          }
        } catch (createError) {
          console.error("[Customer OAuth] Error creando cliente en exchange-code:", createError);
          if (createError.code === 'ECONNREFUSED' || createError.code === 'PROTOCOL_CONNECTION_LOST' || createError.code === 'ETIMEDOUT') {
            return res.status(503).json({
              ok: false,
              error: "Error de conexión con la base de datos. Por favor, intentá nuevamente en unos momentos.",
              errorCode: "DATABASE_CONNECTION_ERROR",
            });
          }
          return res.status(500).json({
            ok: false,
            error: "Error al crear el cliente",
            errorCode: "CREATE_CUSTOMER_ERROR",
            errorDetails: createError.message,
          });
        }
      } else {
        // No hay tenant_id - retornar error para que la app muestre selección de negocio
        console.log(`[Customer OAuth] Cliente no encontrado y no hay tenant_id: ${googleEmail}`);
        console.log(`[Customer OAuth] Retornando error con needsTenantSelection: true`);
        return res.json({
          ok: false,
          error: "Cliente no encontrado",
          errorCode: "CUSTOMER_NOT_FOUND",
          needsTenantSelection: true,
          message: "No se encontró una cuenta asociada a este email. Por favor, seleccioná el negocio donde querés registrarte.",
          email: googleEmail,
          name: googleName,
        });
      }
    }

    if (customer) {
      // Generar token JWT para el cliente
      const tokenPayload = {
        sub: customer.customer_id,
        type: 'customer',
        tenant_id: customer.tenant_id,
        email: customer.email,
      };
      
      const accessToken = jwt.sign(
        tokenPayload,
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '30d' } // Token válido por 30 días
      );
      
      console.log(`[Customer OAuth] Token generado para cliente ${customer.customer_id} (tenant ${customer.tenant_id})`);
      console.log(`[Customer OAuth] Token (primeros 30 chars): ${accessToken.substring(0, 30)}...`);
      
      const responseData = {
        ...customer,
        access_token: accessToken,
      };
      
      console.log(`[Customer OAuth] Enviando respuesta con token incluido`);
      
      return res.json({
        ok: true,
        data: responseData,
      });
    }

    if (tenants.length > 1) {
      return res.json({
        ok: true,
        multipleTenants: true,
        tenants,
        email: googleEmail,
        name: googleName,
      });
    }

    // Si no hay tenant asociado, el usuario necesita ingresar el código del negocio
    return res.json({
      ok: false,
      error: "No se encontraron negocios asociados",
      errorCode: "CUSTOMER_NOT_FOUND",
      needsTenantSelection: true,
      message: "No estás asociado a ningún negocio. Por favor, ingresá el código del negocio para continuar.",
      email: googleEmail,
      name: googleName,
    });
  } catch (err) {
    console.error("❌ [Customer OAuth] Error intercambiando código:", err);
    
    // Manejar errores de conexión a la base de datos
    if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({
        ok: false,
        error: "Error de conexión con la base de datos. Por favor, intentá nuevamente en unos momentos.",
        errorCode: "DATABASE_CONNECTION_ERROR",
      });
    }
    
    return res.status(500).json({
      ok: false,
      error: err.message || "Error en autenticación OAuth",
      errorDetails: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

/**
 * POST /api/public/customer/oauth/select-tenant
 * Selecciona un tenant cuando el cliente tiene múltiples
 * Body: { email, tenant_id }
 */
customerOAuth.post("/select-tenant", async (req, res) => {
  try {
    const { email, tenant_id } = req.body || {};

    if (!email || !tenant_id) {
      return res.status(400).json({
        ok: false,
        error: "Email y tenant_id requeridos",
      });
    }

    // Buscar cliente en el tenant específico
    const [customers] = await pool.query(
      `SELECT c.id, c.name, c.phone_e164, c.email, c.documento, c.tenant_id,
              t.name AS tenant_name, t.subdomain AS tenant_slug, t.status AS tenant_status
       FROM customer c
       JOIN tenant t ON t.id = c.tenant_id
       WHERE c.email = ? AND c.tenant_id = ? AND t.status = 'active'
       LIMIT 1`,
      [email.toLowerCase(), tenant_id]
    );

    if (customers.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Cliente no encontrado en este negocio",
      });
    }

    const c = customers[0];

    const customerData = {
      customer_id: c.id,
      tenant_id: c.tenant_id,
      tenant_name: c.tenant_name,
      tenant_slug: c.tenant_slug,
      name: c.name,
      phone: c.phone_e164,
      email: c.email,
      dni: c.documento,
    };

    return res.json({
      ok: true,
      data: customerData,
    });
  } catch (error) {
    console.error("[Customer OAuth] Error seleccionando tenant:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/public/customer/oauth/register
 * Registra un cliente nuevo después de autenticarse con Google OAuth
 * Body: { email, tenant_id o tenant_code, name? }
 */
customerOAuth.post("/register", async (req, res) => {
  try {
    const { email, tenant_id, tenant_code, name } = req.body || {};

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "Email requerido",
      });
    }

    if (!tenant_id && !tenant_code) {
      return res.status(400).json({
        ok: false,
        error: "tenant_id o tenant_code requerido",
      });
    }

    // Resolver tenant_id si se proporcionó tenant_code
    let resolvedTenantId = null;
    
    if (tenant_id) {
      resolvedTenantId = parseInt(tenant_id, 10);
    } else if (tenant_code) {
      const code = String(tenant_code).trim();
      let tenant = null;
      
      // Intentar como ID numérico
      if (/^\d+$/.test(code)) {
        const [rowsById] = await pool.query(
          `SELECT id, name, subdomain, status, business_code
           FROM tenant 
           WHERE id = ? AND status = 'active' 
           LIMIT 1`,
          [parseInt(code, 10)]
        );
        tenant = rowsById[0];
      }
      
      // Si no se encontró, intentar como business_code (código para app móvil)
      if (!tenant) {
        try {
          const [rowsByBusinessCode] = await pool.query(
            `SELECT id, name, subdomain, status, business_code
             FROM tenant 
             WHERE business_code = ? AND status = 'active' 
             LIMIT 1`,
            [code.toLowerCase()]
          );
          tenant = rowsByBusinessCode[0];
        } catch (dbError) {
          // Si el campo business_code no existe, ignorar el error y continuar
          if (dbError.code === 'ER_BAD_FIELD_ERROR' && dbError.sqlMessage?.includes("Unknown column 'business_code'")) {
            // Campo no existe aún, continuar con la búsqueda por subdomain
          } else {
            throw dbError;
          }
        }
      }
      
      // Si no se encontró, intentar como subdomain/slug
      if (!tenant) {
        const [rowsBySlug] = await pool.query(
          `SELECT id, name, subdomain, status, business_code
           FROM tenant 
           WHERE subdomain = ? AND status = 'active' 
           LIMIT 1`,
          [code]
        );
        tenant = rowsBySlug[0];
      }
      
      if (!tenant) {
        return res.status(404).json({
          ok: false,
          error: "Negocio no encontrado o inactivo",
          errorCode: "TENANT_NOT_FOUND",
        });
      }
      
      resolvedTenantId = tenant.id;
    }

    // Verificar que el tenant existe y está activo
    const [[tenant]] = await pool.query(
      `SELECT id, name, subdomain, status FROM tenant WHERE id = ? AND status = 'active' LIMIT 1`,
      [resolvedTenantId]
    );

    if (!tenant) {
      return res.status(404).json({
        ok: false,
        error: "Negocio no encontrado o inactivo",
        errorCode: "TENANT_NOT_FOUND",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    // Verificar si el cliente ya existe
    const [existingCustomers] = await pool.query(
      `SELECT c.id, c.name, c.phone_e164, c.email, c.documento, c.tenant_id,
              t.name AS tenant_name, t.subdomain AS tenant_slug, t.status AS tenant_status
       FROM customer c
       JOIN tenant t ON t.id = c.tenant_id
       WHERE c.email = ? AND c.tenant_id = ? AND t.status = 'active'
       LIMIT 1`,
      [normalizedEmail, resolvedTenantId]
    );

    if (existingCustomers.length > 0) {
      // Cliente ya existe, retornar datos con token
      const c = existingCustomers[0];
      
      // Generar token JWT para el cliente
      const tokenPayload = {
        sub: c.id,
        type: 'customer',
        tenant_id: c.tenant_id,
        email: c.email,
      };
      
      const accessToken = jwt.sign(
        tokenPayload,
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '30d' } // Token válido por 30 días
      );
      
      return res.json({
        ok: true,
        data: {
          customer_id: c.id,
          tenant_id: c.tenant_id,
          tenant_name: c.tenant_name,
          tenant_slug: c.tenant_slug,
          name: c.name,
          phone: c.phone_e164,
          email: c.email,
          dni: c.documento,
          access_token: accessToken,
        },
      });
    }

    // Crear cliente nuevo
    const customerName = name ? String(name).trim().slice(0, 80) : null;

    await pool.query(
      `INSERT INTO customer (tenant_id, email, name) 
       VALUES (?, ?, ?)`,
      [resolvedTenantId, normalizedEmail, customerName]
    );

    // Obtener el cliente creado
    const [newCustomers] = await pool.query(
      `SELECT c.id, c.name, c.phone_e164, c.email, c.documento, c.tenant_id,
              t.name AS tenant_name, t.subdomain AS tenant_slug, t.status AS tenant_status
       FROM customer c
       JOIN tenant t ON t.id = c.tenant_id
       WHERE c.email = ? AND c.tenant_id = ? AND t.status = 'active'
       LIMIT 1`,
      [normalizedEmail, resolvedTenantId]
    );

    if (newCustomers.length === 0) {
      return res.status(500).json({
        ok: false,
        error: "Error al crear el cliente",
      });
    }

    const c = newCustomers[0];

    console.log(`[Customer OAuth] Cliente registrado: ${normalizedEmail} en tenant ${resolvedTenantId}`);

    // Generar token JWT para el cliente
    const tokenPayload = {
      sub: c.id,
      type: 'customer',
      tenant_id: c.tenant_id,
      email: c.email,
    };
    
    const accessToken = jwt.sign(
      tokenPayload,
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: '30d' } // Token válido por 30 días
    );

    return res.json({
      ok: true,
      data: {
        customer_id: c.id,
        tenant_id: c.tenant_id,
        tenant_name: c.tenant_name,
        tenant_slug: c.tenant_slug,
        name: c.name,
        phone: c.phone_e164,
        email: c.email,
        dni: c.documento,
        access_token: accessToken,
      },
    });
  } catch (error) {
    console.error("[Customer OAuth] Error registrando cliente:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Error al registrar el cliente",
    });
  }
});

