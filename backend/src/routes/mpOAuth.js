// src/routes/mpOAuth.js
import { Router } from "express";
import fetch from "node-fetch";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth/middlewares.js";
import { identifyTenant } from "../auth/tenant.js";
import crypto from "crypto";

export const mpOAuth = Router();

/* ========= Helpers ========= */
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function genCodeVerifier() {
  return base64url(crypto.randomBytes(64)); // 86 chars aprox
}
function codeChallengeS256(verifier) {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64url(hash);
}
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
  // ÚNICO origen de verdad: .env si está, sino lo inferimos
  const base = (process.env.MP_REDIRECT_URI && process.env.MP_REDIRECT_URI.replace(/\/mp\/oauth\/callback$/, "")) || baseUrlFromReq(req);
  return `${String(base).replace(/\/+$/, "")}/mp/oauth/callback`;
}

const authMiddlewares = [identifyTenant, requireAuth];
const pkceStore = new Map(); // state -> { verifier, expAt }


/* ========= GET /mp/oauth/connect ========= */
mpOAuth.get("/connect", authMiddlewares, async (req, res) => {
  try {
    const tenantId = req.tenant_id || req.tenant?.id || req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ ok:false, error:"No se pudo identificar el tenant" });
    if (!process.env.MP_CLIENT_ID) return res.status(500).json({ ok:false, error:"MP_CLIENT_ID ausente" });
    if (!process.env.MP_CLIENT_SECRET) return res.status(500).json({ ok:false, error:"MP_CLIENT_SECRET ausente" });

    const [[tenant]] = await pool.query("SELECT id, subdomain FROM tenant WHERE id=?", [tenantId]);
    if (!tenant) return res.status(404).json({ ok:false, error:"Tenant no encontrado" });

    const redirectUri = getRedirectUri(req);
    const fresh = String(req.query.fresh || "") === "1";
    const returnToQuery = req.query.return_to ? String(req.query.return_to) : null;
    let returnToDefault = `/${tenant.subdomain}/admin/config?tab=mercadopago`;
    if (returnToQuery && returnToQuery.startsWith("/")) {
      returnToDefault = returnToQuery;
    }

    // Log importante para debugging
    console.log("[MP OAuth] /connect - Configuración:");
    console.log(`  - Tenant ID: ${tenantId}`);
    console.log(`  - Redirect URI: ${redirectUri}`);
    console.log(`  - MP_CLIENT_ID configurado: ${!!process.env.MP_CLIENT_ID}`);
    console.log(`  - Fresh: ${fresh}`);

    const state = base64url(Buffer.from(JSON.stringify({
      tenantId: tenant.id,
      tenantSlug: tenant.subdomain,
      returnTo: returnToDefault,
      ts: Date.now(),
      fresh
    })));

    // PKCE
    const code_verifier = genCodeVerifier();
    const code_challenge = codeChallengeS256(code_verifier);
    pkceStore.set(state, { verifier: code_verifier, expAt: Date.now() + 5*60*1000 });

    const url = new URL("https://auth.mercadopago.com/authorization");
    url.searchParams.set("client_id", process.env.MP_CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("platform_id", "mp");
    url.searchParams.set("access_type", "offline");  // refresh_token
    url.searchParams.set("show_login", "true");      // SIEMPRE mostrar login/selector
    
    // Pre-seleccionar Argentina para evitar el selector de país
    // AR = Argentina (código ISO 3166-1 alpha-2)
    url.searchParams.set("country_id", "AR");

    // Si el front pide "fresh", forzamos re-autenticación real
    if (fresh) {
      url.searchParams.set("prompt", "login"); // no consent silencioso
      url.searchParams.set("max_age", "0");
      url.searchParams.set("nonce", Date.now().toString(36));
    } else {
      url.searchParams.set("prompt", "consent");
    }

    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", code_challenge);
    url.searchParams.set("code_challenge_method", "S256");

    console.log(`[MP OAuth] ✅ URL de autorización generada correctamente`);
    console.log(`  ⚠️  IMPORTANTE: Verifica que este redirect_uri esté configurado en tu aplicación de Mercado Pago:`);
    console.log(`     ${redirectUri}`);
    console.log(`  - Debe coincidir EXACTAMENTE (incluye protocolo, dominio, path y trailing slash si aplica)`);
    console.log(`  - Configuración en: https://www.mercadopago.com.ar/developers/panel/app/`);

    return res.json({ ok:true, authUrl: url.toString(), redirect_uri: redirectUri });
  } catch (err) {
    console.error("❌ [MP OAuth] /connect:", err);
    return res.status(500).json({ ok:false, error:"Error generando URL de autorización" });
  }
});

/* ========= GET /mp/oauth/callback =========
   Intercambia code -> tokens (usa el MISMO redirect_uri)
*/
mpOAuth.get("/callback", async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  let back = "/admin/config?tab=mercadopago";
  let stateData = null;

  // helper para decodificar base64url
  const fromBase64Url = (s) => {
    if (!s) return "";
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    // padding
    while (s.length % 4 !== 0) s += "=";
    return Buffer.from(s, "base64").toString();
  };

  try {
    // Decodificar state (base64url)
    try {
      stateData = JSON.parse(fromBase64Url(state || ""));
      const tenantSlug = stateData?.tenantSlug || null;
      back = stateData?.returnTo || (tenantSlug ? `/${tenantSlug}/admin/config?tab=mercadopago` : back);
    } catch (e) {
      console.error("[MP OAuth] State inválido:", e);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
    }

    if (oauthError === "access_denied") {
      return res.redirect(`${process.env.FRONTEND_URL}${back}${back.includes("?") ? "&" : "?"}error=cancelled`);
    }
    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL}${back}${back.includes("?") ? "&" : "?"}error=invalid`);
    }
    const { tenantId } = stateData || {};
    if (!tenantId) {
      return res.redirect(`${process.env.FRONTEND_URL}${back}${back.includes("?") ? "&" : "?"}error=invalid_state`);
    }

    // Recuperar y validar PKCE
    const cached = pkceStore.get(state);
    if (!cached || cached.expAt < Date.now()) {
      return res.redirect(`${process.env.FRONTEND_URL}${back}${back.includes("?") ? "&" : "?"}error=invalid_state`);
    }
    const code_verifier = cached.verifier;
    pkceStore.delete(state);

    const redirectUri = getRedirectUri(req); // MISMO que en /connect

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.MP_CLIENT_ID,
      client_secret: process.env.MP_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code_verifier,
    });

    const mpResp = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });

    const mpData = await mpResp.json();
    console.log("[MP OAuth] token status:", mpResp.status);
    console.log("[MP OAuth] token response:", JSON.stringify(mpData, null, 2));

    if (!mpResp.ok || !mpData.access_token) {
      console.error("[MP OAuth] ❌ Error obteniendo token:");
      console.error(`  - Status: ${mpResp.status}`);
      console.error(`  - Error: ${mpData.error || "unknown"}`);
      console.error(`  - Description: ${mpData.error_description || "no description"}`);
      console.error(`  - Redirect URI usado: ${redirectUri}`);
      console.error(`  ⚠️  Posibles causas:`);
      console.error(`     1. El redirect_uri no está configurado en tu aplicación de Mercado Pago`);
      console.error(`     2. El redirect_uri no coincide EXACTAMENTE con el configurado`);
      console.error(`     3. El code_verifier no coincide (problema con PKCE)`);
      console.error(`     4. Las credenciales (CLIENT_ID, CLIENT_SECRET) son incorrectas`);
      
      const e = encodeURIComponent(mpData.error || "");
      const d = encodeURIComponent(mpData.error_description || "");
      return res.redirect(
        `${process.env.FRONTEND_URL}${back}${back.includes("?") ? "&" : "?"}error=auth_failed&mp=${e}&desc=${d}`
      );
    }

    // === NUEVO: validar dueño del token ===
    const meResp = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${mpData.access_token}` },
    });
    const me = await meResp.json();
    if (!me?.id) {
      return res.redirect(`${process.env.FRONTEND_URL}${back}${back.includes("?") ? "&" : "?"}error=whoami_failed`);
    }

    // Bloquear si es la cuenta de la plataforma (opcional, si seteás PLATFORM_MP_USER_ID)
    if (process.env.PLATFORM_MP_USER_ID && String(me.id) === String(process.env.PLATFORM_MP_USER_ID)) {
      return res.redirect(`${process.env.FRONTEND_URL}${back}${back.includes("?") ? "&" : "?"}error=same_account_platform`);
    }

    // Si el tenant ya tenía un user_id igual, no grabar (sigue siendo la misma cuenta)
    const [[prev]] = await pool.query(
      "SELECT mp_user_id FROM tenant_payment_config WHERE tenant_id = ?",
      [tenantId]
    );
    if (prev?.mp_user_id && String(prev.mp_user_id) === String(me.id)) {
      const triedFresh = !!(stateData && stateData.fresh);
      const err = triedFresh ? "same_account_forced" : "same_account";
      return res.redirect(`${process.env.FRONTEND_URL}${back}${back.includes("?") ? "&" : "?"}error=${err}`);
    }

    // Guardar / actualizar tokens
    const expiresAt = new Date(Date.now() + Math.max(0, (mpData.expires_in || 3600) - 300) * 1000);

    await pool.query(
      `INSERT INTO tenant_payment_config
        (tenant_id, mp_user_id, mp_access_token, mp_refresh_token, mp_public_key,
         mp_token_expires_at, mp_live_mode, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         mp_user_id = VALUES(mp_user_id),
         mp_access_token = VALUES(mp_access_token),
         mp_refresh_token = VALUES(mp_refresh_token),
         mp_public_key = VALUES(mp_public_key),
         mp_token_expires_at = VALUES(mp_token_expires_at),
         mp_live_mode = VALUES(mp_live_mode),
         is_active = 1,
         updated_at = NOW()`,
      [
        tenantId,
        me.id || null,
        mpData.access_token,
        mpData.refresh_token || null,
        mpData.public_key || null,
        expiresAt,
        mpData.live_mode ? 1 : 0,
      ]
    );

    return res.redirect(`${process.env.FRONTEND_URL}${back}${back.includes("?") ? "&" : "?"}success=true`);
  } catch (err) {
    console.error("❌ [MP OAuth] callback error:", err);
    return res.redirect(`${process.env.FRONTEND_URL}${back}${back.includes("?") ? "&" : "?"}error=server_error`);
  }
});


/* ========= GET /mp/oauth/redirect-uri =========
   Devuelve el redirect_uri que debe configurarse en Mercado Pago
*/
mpOAuth.get("/redirect-uri", authMiddlewares, async (req, res) => {
  try {
    const redirectUri = getRedirectUri(req);
    return res.json({
      ok: true,
      redirect_uri: redirectUri,
      instructions: [
        "1. Ve a https://www.mercadopago.com.ar/developers/panel/app/",
        "2. Selecciona tu aplicación",
        "3. En 'URLs de redirección', agrega exactamente:",
        redirectUri,
        "4. Guarda los cambios",
        "5. Intenta conectar nuevamente"
      ]
    });
  } catch (err) {
    console.error("❌ [MP OAuth] /redirect-uri:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ========= GET /mp/oauth/status ========= */
mpOAuth.get("/status", authMiddlewares, async (req, res) => {
  try {
    const tenantId = req.tenant_id || req.user?.tenant_id;
    if (!tenantId) return res.json({ ok: true, connected: false, reason: "no_tenant" });

    const [[config]] = await pool.query(
      `SELECT mp_user_id, mp_access_token, mp_token_expires_at, mp_live_mode, is_active, mp_public_key,
              CASE WHEN mp_access_token IS NOT NULL THEN TRUE ELSE FALSE END as has_token
         FROM tenant_payment_config WHERE tenant_id = ?`,
      [tenantId]
    );

    if (!config || !config.has_token) return res.json({ ok: true, connected: false });

    const isExpired =
      config.mp_token_expires_at && new Date(config.mp_token_expires_at) < new Date();

    const baseStatus = {
      ok: true,
      connected: config.is_active && config.has_token && !isExpired,
      userId: config.mp_user_id,
      expiresAt: config.mp_token_expires_at,
      liveMode: config.mp_live_mode === 1,
      publicKey: config.mp_public_key,
      isExpired,
    };

    // Si el token está expirado o no hay token, retornar solo el estado base
    if (isExpired || !config.mp_access_token) {
      return res.json({
        ...baseStatus,
        accountInfo: null,
        accountError: "Token expirado o no disponible. Reconecta tu cuenta.",
      });
    }

    // Obtener información detallada de la cuenta desde Mercado Pago
    try {
      const meResp = await fetch("https://api.mercadopago.com/users/me", {
        headers: {
          Authorization: `Bearer ${config.mp_access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!meResp.ok) {
        const errorText = await meResp.text();
        console.error(`[MP OAuth] Error obteniendo info de cuenta: ${meResp.status}`, errorText);
        return res.json({
          ...baseStatus,
          accountInfo: null,
          accountError: `Error al obtener información de la cuenta (${meResp.status})`,
        });
      }

      const accountData = await meResp.json();
      
      // Extraer información relevante de la cuenta
      const accountInfo = {
        userId: accountData.id,
        email: accountData.email,
        nickname: accountData.nickname,
        firstName: accountData.first_name,
        lastName: accountData.last_name,
        countryId: accountData.country_id,
        // Información de verificación (si está disponible)
        siteId: accountData.site_id,
        permalink: accountData.permalink,
        registrationDate: accountData.registration_date,
        // Estados de la cuenta
        // Nota: Mercado Pago puede tener diferentes campos según la versión de la API
        accountType: accountData.account_type || null,
        // Verificar si hay información de estado de cuenta
        status: accountData.status || "unknown",
      };

      // Determinar si la cuenta está verificada y habilitada
      // Esto puede variar según la estructura de la respuesta de MP
      const isVerified = accountData.site_id === "MLA" || accountData.country_id === "AR";
      const canReceivePayments = config.mp_live_mode === 1 && !isExpired;

      return res.json({
        ...baseStatus,
        accountInfo,
        accountStatus: {
          verified: isVerified,
          canReceivePayments,
          mode: config.mp_live_mode === 1 ? "LIVE (Producción)" : "SANDBOX (Pruebas)",
          status: canReceivePayments && isVerified ? "ready" : "needs_attention",
          message: config.mp_live_mode === 1
            ? isVerified
              ? "Cuenta conectada y habilitada para recibir pagos"
              : "Cuenta conectada. Verifica que esté completamente verificada en Mercado Pago"
            : "Cuenta en modo PRUEBAS. Cambia a modo PRODUCCIÓN para recibir pagos reales",
        },
      });
    } catch (accountError) {
      console.error("[MP OAuth] Error obteniendo información de cuenta:", accountError);
      return res.json({
        ...baseStatus,
        accountInfo: null,
        accountError: accountError.message || "Error al obtener información de la cuenta",
      });
    }
  } catch (error) {
    console.error("❌ [MP OAuth] /status:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* ========= POST /mp/oauth/disconnect ========= */
mpOAuth.post("/disconnect", authMiddlewares, async (req, res) => {
  try {
    const tenantId = req.tenant_id || req.user?.tenant_id;
    if (!tenantId) return res.status(400).json({ ok: false, error: "Tenant no identificado" });

    await pool.query(
      `UPDATE tenant_payment_config
         SET mp_access_token = NULL,
             mp_refresh_token = NULL,
             mp_public_key = NULL,
             is_active = 0,
             updated_at = NOW()
       WHERE tenant_id = ?`,
      [tenantId]
    );

    res.json({ ok: true, message: "Mercado Pago desconectado exitosamente" });
  } catch (error) {
    console.error("❌ [MP OAuth] /disconnect:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/* ========= GET /mp/oauth/connected-accounts =========
   Listar todas las cuentas de Mercado Pago conectadas (solo para super admin)
*/
mpOAuth.get("/connected-accounts", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    // Obtener todas las cuentas conectadas con información del tenant
    const [accounts] = await pool.query(
      `SELECT 
        tpc.tenant_id,
        tpc.mp_user_id,
        tpc.mp_live_mode,
        tpc.is_active,
        tpc.mp_token_expires_at,
        tpc.created_at,
        tpc.updated_at,
        t.name AS tenant_name,
        t.subdomain AS tenant_slug
      FROM tenant_payment_config tpc
      INNER JOIN tenant t ON t.id = tpc.tenant_id
      WHERE tpc.mp_access_token IS NOT NULL
        AND tpc.is_active = 1
      ORDER BY tpc.updated_at DESC`
    );

    // Para cada cuenta, intentar obtener información detallada de MP
    const accountsWithInfo = await Promise.all(
      accounts.map(async (acc) => {
        const isExpired = acc.mp_token_expires_at && new Date(acc.mp_token_expires_at) < new Date();
        
        let accountInfo = null;
        let accountError = null;

        // Solo intentar obtener info si el token no está expirado
        if (!isExpired) {
          try {
            // Necesitamos el access_token, pero no lo exponemos en la respuesta
            // Solo usamos para obtener info
            const [[config]] = await pool.query(
              `SELECT mp_access_token FROM tenant_payment_config WHERE tenant_id = ? LIMIT 1`,
              [acc.tenant_id]
            );

            if (config?.mp_access_token) {
              const meResp = await fetch("https://api.mercadopago.com/users/me", {
                headers: {
                  Authorization: `Bearer ${config.mp_access_token}`,
                  "Content-Type": "application/json",
                },
              });

              if (meResp.ok) {
                const accountData = await meResp.json();
                accountInfo = {
                  email: accountData.email,
                  nickname: accountData.nickname,
                  firstName: accountData.first_name,
                  lastName: accountData.last_name,
                  countryId: accountData.country_id,
                };
              } else {
                accountError = `Error ${meResp.status}`;
              }
            }
          } catch (err) {
            accountError = err.message;
          }
        } else {
          accountError = "Token expirado";
        }

        return {
          tenantId: acc.tenant_id,
          tenantName: acc.tenant_name,
          tenantSlug: acc.tenant_slug,
          mpUserId: acc.mp_user_id,
          liveMode: acc.mp_live_mode === 1,
          mode: acc.mp_live_mode === 1 ? "LIVE (Producción)" : "SANDBOX (Pruebas)",
          isActive: acc.is_active === 1,
          isExpired,
          accountInfo,
          accountError,
          connectedAt: acc.created_at,
          lastUpdated: acc.updated_at,
        };
      })
    );

    res.json({
      ok: true,
      count: accountsWithInfo.length,
      accounts: accountsWithInfo,
    });
  } catch (error) {
    console.error("❌ [MP OAuth] /connected-accounts:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});
