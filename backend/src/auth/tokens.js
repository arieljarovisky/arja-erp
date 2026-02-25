// src/auth/middlewares.js
import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  if (req.method === "OPTIONS") return next();

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "Falta token" });

  try {
    // ✅ Verificar con el mismo secret de firma
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    if (!payload.tenant_id)
      return res.status(401).json({ ok: false, error: "Token inválido (sin tenant_id)" });

    // ⚠️ Si el tenant ya fue identificado, cruzar valores
    if (req.tenant_id && Number(payload.tenant_id) !== Number(req.tenant_id))
      return res.status(403).json({ ok: false, error: "Acceso denegado: tenant inválido" });

    req.user = {
      id: payload.sub,
      tenant_id: payload.tenant_id,
      role: payload.role,
      email: payload.email,
    };
    next();
  } catch (err) {
    console.error("[requireAuth] Token inválido:", err.message);
    return res.status(401).json({ ok: false, error: "Token inválido o expirado" });
  }
}
