// src/routes/googleOAuth.js
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pool } from "../db.js";
import { ensureSuperAdminFlag, buildUserPayload, signAccessToken, signRefreshToken, cookieOpts, enforceSessionLimit } from "./auth.js";

export const googleOAuth = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.FRONTEND_URL_HTTPS || "https://arjaerp.com";

// NOTA: El nombre de la aplicación que aparece en la pantalla de Google OAuth
// se configura en Google Cloud Console, no aquí. Para cambiarlo:
// 1. Ve a https://console.cloud.google.com/apis/credentials/consent
// 2. Selecciona tu proyecto OAuth
// 3. En "OAuth consent screen", edita el campo "Application name"
// 4. Cambia el nombre a "ARJA ERP" o el nombre que desees
// 5. Guarda los cambios

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
  return `${String(base).replace(/\/+$/, "")}/auth/google/callback`;
}

/* ========= GET /auth/google =========
   Inicia el flujo OAuth de Google
*/
googleOAuth.get("/", async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "Google OAuth no está configurado. Faltan credenciales.",
      });
    }

    const client = new OAuth2Client(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      getRedirectUri(req)
    );

    // Obtener el parámetro 'next' para redirigir después del login
    const next = req.query.next || "/";
    const state = Buffer.from(JSON.stringify({ next })).toString("base64url");

    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
      state,
      prompt: "consent", // Forzar consent para obtener refresh_token
      // Nota: El nombre de la aplicación se configura en Google Cloud Console
      // en la sección "OAuth consent screen" > "Application name"
    });

    console.log(`[Google OAuth] URL de autorización generada`);
    console.log(`  Redirect URI: ${getRedirectUri(req)}`);

    return res.json({ ok: true, authUrl });
  } catch (err) {
    console.error("❌ [Google OAuth] Error generando URL:", err);
    return res.status(500).json({
      ok: false,
      error: "Error generando URL de autorización",
    });
  }
});

/* ========= GET /auth/google/callback =========
   Maneja el callback de Google OAuth
*/
googleOAuth.get("/callback", async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.error(`[Google OAuth] Error en callback: ${oauthError}`);
      return res.redirect(`${FRONTEND_URL}/login?error=oauth_cancelled`);
    }

    if (!code) {
      return res.redirect(`${FRONTEND_URL}/login?error=no_code`);
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.redirect(`${FRONTEND_URL}/login?error=oauth_not_configured`);
    }

    const client = new OAuth2Client(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      getRedirectUri(req)
    );

    // Intercambiar code por tokens
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Obtener información del usuario de Google
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const googleEmail = payload.email?.toLowerCase();
    const googleName = payload.name;
    const googlePicture = payload.picture;

    if (!googleEmail) {
      return res.redirect(`${FRONTEND_URL}/login?error=no_email`);
    }

    console.log(`[Google OAuth] Usuario autenticado: ${googleEmail} (${googleId})`);

    // Buscar usuario existente por google_id o email
    const [usersByGoogleId] = await pool.query(
      `SELECT u.id, u.email, u.role, u.is_active, u.is_super_admin, 
              u.current_branch_id, u.branch_access_mode, u.permissions,
              u.tenant_id, t.subdomain AS slug, t.status AS tenant_status,
              t.name AS tenant_name, t.is_system, t.activation_token,
              u.two_factor_enabled, u.remember_2fa_until
       FROM users u
       JOIN tenant t ON t.id = u.tenant_id
       WHERE u.google_id = ?`,
      [googleId]
    );

    const [usersByEmail] = await pool.query(
      `SELECT u.id, u.email, u.role, u.is_active, u.is_super_admin,
              u.current_branch_id, u.branch_access_mode, u.permissions,
              u.tenant_id, t.subdomain AS slug, t.status AS tenant_status,
              t.name AS tenant_name, t.is_system, t.activation_token,
              u.two_factor_enabled, u.remember_2fa_until
       FROM users u
       JOIN tenant t ON t.id = u.tenant_id
       WHERE u.email = ?`,
      [googleEmail]
    );

    let users = usersByGoogleId.length > 0 ? usersByGoogleId : usersByEmail;

    // Si no existe usuario, crear sesión de onboarding para que elija plan
    if (users.length === 0) {
      // Verificar si ya existe una sesión de onboarding para este email
      const [existingSessions] = await pool.query(
        `SELECT public_id FROM onboarding_session 
         WHERE email = ? AND status = 'draft' 
         ORDER BY created_at DESC LIMIT 1`,
        [googleEmail]
      );

      let sessionId;
      if (existingSessions.length > 0) {
        sessionId = existingSessions[0].public_id;
      } else {
        // Crear nueva sesión de onboarding
        const { randomUUID } = await import("crypto");
        sessionId = randomUUID();
        await pool.query(
          `INSERT INTO onboarding_session (public_id, email, owner_name, phone, status)
           VALUES (?, ?, ?, ?, 'draft')`,
          [sessionId, googleEmail, googleName || "", ""]
        );
      }

      // Guardar información de Google en la sesión para usar después
      await pool.query(
        `UPDATE onboarding_session 
         SET business_data = JSON_SET(COALESCE(business_data, '{}'), '$.google_id', ?, '$.google_email', ?, '$.google_name', ?)
         WHERE public_id = ?`,
        [googleId, googleEmail, googleName || "", sessionId]
      );

      console.log(`[Google OAuth] Usuario nuevo detectado: ${googleEmail}. Redirigiendo a onboarding.`);
      
      // Redirigir al onboarding con la sesión
      const stateData = state ? JSON.parse(Buffer.from(state, "base64url").toString()) : {};
      const next = stateData.next || "/";
      return res.redirect(
        `${FRONTEND_URL}/onboarding?session=${sessionId}&google_oauth=1&next=${encodeURIComponent(next)}`
      );
    } else {
      // Actualizar google_id si no estaba vinculado
      const user = users[0];
      if (!user.google_id) {
        await pool.query(
          `UPDATE users SET google_id = ?, google_email = ? WHERE id = ?`,
          [googleId, googleEmail, user.id]
        );
        console.log(`[Google OAuth] Usuario vinculado a Google: ${googleEmail}`);
      }
    }

    // Filtrar usuarios activos
    const activeUsers = users.filter((u) => {
      if (!u.is_active) return false;
      const status = String(u.tenant_status || "").toLowerCase();
      return status === "active" || status === "trial";
    });

    if (activeUsers.length === 0) {
      return res.redirect(
        `${FRONTEND_URL}/login?error=account_inactive&message=Tu cuenta está desactivada o el tenant está inactivo.`
      );
    }

    // Si hay múltiples tenants, redirigir a selección
    if (activeUsers.length > 1) {
      const stateData = state ? JSON.parse(Buffer.from(state, "base64url").toString()) : {};
      const next = stateData.next || "/";
      
      // Guardar información temporal en sesión o cookie para la selección de tenant
      // Por ahora, redirigimos con los datos en la URL (en producción usar sesión)
      const tenantsData = activeUsers.map((u) => ({
        tenantId: u.tenant_id,
        slug: u.slug,
        role: u.role,
        name: u.tenant_name,
      }));

      return res.redirect(
        `${FRONTEND_URL}/login?google_oauth=multi_tenant&tenants=${encodeURIComponent(JSON.stringify(tenantsData))}&next=${encodeURIComponent(next)}`
      );
    }

    // Un solo tenant: autenticar directamente
    const user = activeUsers[0];
    const isSuperAdmin = await ensureSuperAdminFlag(user);

    // Verificar 2FA (si está habilitado y el dispositivo no está recordado)
    if (user.two_factor_enabled) {
      const now = new Date();
      const rememberUntil = user.remember_2fa_until ? new Date(user.remember_2fa_until) : null;
      const isRemembered = rememberUntil && rememberUntil > now;

      if (!isRemembered) {
        // Requiere 2FA - redirigir a página de 2FA
        const stateData = state ? JSON.parse(Buffer.from(state, "base64url").toString()) : {};
        const next = stateData.next || "/";
        return res.redirect(
          `${FRONTEND_URL}/login?google_oauth=requires_2fa&email=${encodeURIComponent(googleEmail)}&next=${encodeURIComponent(next)}`
        );
      }
    }

    // Construir payload del usuario
    const userPayload = await buildUserPayload(user, { 
      isSuperAdmin,
      tenantName: user.tenant_name 
    });

    if (!userPayload) {
      return res.redirect(`${FRONTEND_URL}/login?error=user_not_found`);
    }

    // Obtener información completa del tenant
    const [[tenantInfo]] = await pool.query(
      `SELECT id, subdomain AS slug, name, is_system, status, created_at FROM tenant WHERE id = ? LIMIT 1`,
      [user.tenant_id]
    );

    const accessToken = signAccessToken({
      userId: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      email: user.email,
      isSuperAdmin,
    });

    const refreshToken = signRefreshToken({
      userId: user.id,
      tenantId: user.tenant_id
    });

    // Guardar refresh token
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, tenant_id, token, created_at)
       VALUES (?, ?, ?, NOW())`,
      [user.id, user.tenant_id, refreshToken]
    );

    // Actualizar last_login
    await pool.query(
      "UPDATE users SET last_login = NOW() WHERE id = ? AND tenant_id = ?",
      [user.id, user.tenant_id]
    );

    await enforceSessionLimit(user.id, user.tenant_id, 1);

    // Decodificar state para obtener 'next'
    const stateData = state ? JSON.parse(Buffer.from(state, "base64url").toString()) : {};
    const tenantSlug = tenantInfo?.slug || user.slug;
    // Si next es "/" o no está definido, usar el dashboard del usuario
    let next = stateData.next;
    if (!next || next === "/" || next === "") {
      next = isSuperAdmin ? "/super-admin/tenants" : `/${tenantSlug}/dashboard`;
    }

    // Setear cookie HttpOnly con refresh para persistir sesión cross-site
    res.cookie("rt", refreshToken, cookieOpts(true));

    // Redirigir al frontend con access token (el refresh queda en cookie)
    return res.redirect(
      `${FRONTEND_URL}/auth/google/success?token=${encodeURIComponent(accessToken)}&next=${encodeURIComponent(next)}`
    );
  } catch (err) {
    console.error("❌ [Google OAuth] Error en callback:", err);
    return res.redirect(`${FRONTEND_URL}/login?error=oauth_error&message=${encodeURIComponent(err.message)}`);
  }
});
