// src/routes/GoogleOAuthCallback.jsx
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { setAccessToken, setUserData, setTenantId, setAuthEmail } from "../api/client";
import { toast } from "sonner";
import { logger } from "../utils/logger.js";

export default function GoogleOAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    const refresh = searchParams.get("refresh");
    const next = searchParams.get("next") || "/";
    const error = searchParams.get("error");

    if (error) {
      logger.error("[Google OAuth] Error en callback:", error);
      toast.error("Error al iniciar sesión con Google");
      navigate("/login");
      return;
    }

    if (!token) {
      logger.error("[Google OAuth] No se recibió token");
      toast.error("Error al iniciar sesión con Google");
      navigate("/login");
      return;
    }

    try {
      // Guardar token
      setAccessToken(token);
      
      // Decodificar el token para obtener información del usuario
      const payload = JSON.parse(atob(token.split(".")[1]));
      
      if (payload.email) {
        setAuthEmail(payload.email);
      }
      
      if (payload.tenant_id) {
        setTenantId(payload.tenant_id);
      }

      logger.log("[Google OAuth] Sesión iniciada exitosamente");
      toast.success("Sesión iniciada con Google");

      // Obtener información completa del usuario desde el backend
      import("../api/client").then(({ authApi }) => {
        authApi.me()
          .then((userData) => {
            if (userData?.ok && userData?.user) {
              setUserData(userData.user);
              if (userData.tenant?.id) {
                setTenantId(userData.tenant.id);
              }
            }
            
            // Determinar destino: si next es "/" o no es válido, ir al dashboard
            let destination = next;
            if (!destination || destination === "/" || destination === "") {
              // Si es super admin, ir a super-admin
              if (payload.is_super_admin) {
                destination = "/super-admin/tenants";
              } else if (payload.tenant_id) {
                // Intentar obtener el slug del tenant desde el token o userData
                const tenantSlug = userData?.tenant?.slug || userData?.user?.tenant?.slug;
                if (tenantSlug) {
                  destination = `/${tenantSlug}/dashboard`;
                } else {
                  // Si no hay slug, usar el tenant_id del payload (fallback)
                  destination = `/dashboard`;
                }
              } else {
                destination = "/dashboard";
              }
            } else if (!destination.startsWith("/")) {
              destination = `/${destination}`;
            }
            
            window.location.replace(destination);
          })
          .catch((meError) => {
            logger.warn("[Google OAuth] No se pudo obtener información completa del usuario:", meError);
            // Continuar de todas formas, el token ya está guardado
            // Usar información del token para redirigir
            let destination = next;
            if (!destination || destination === "/" || destination === "") {
              if (payload.is_super_admin) {
                destination = "/super-admin/tenants";
              } else if (payload.tenant_id) {
                destination = "/dashboard";
              } else {
                destination = "/dashboard";
              }
            } else if (!destination.startsWith("/")) {
              destination = `/${destination}`;
            }
            window.location.replace(destination);
          });
      }).catch((importError) => {
        logger.error("[Google OAuth] Error importando authApi:", importError);
        // Continuar de todas formas, el token ya está guardado
        let destination = next;
        if (!destination || destination === "/" || destination === "") {
          if (payload.is_super_admin) {
            destination = "/super-admin/tenants";
          } else if (payload.tenant_id) {
            destination = "/dashboard";
          } else {
            destination = "/dashboard";
          }
        } else if (!destination.startsWith("/")) {
          destination = `/${destination}`;
        }
        window.location.replace(destination);
      });
    } catch (err) {
      logger.error("[Google OAuth] Error procesando callback:", err);
      toast.error("Error al procesar la sesión");
      navigate("/login");
    }
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
        <p className="text-foreground-muted">Iniciando sesión...</p>
      </div>
    </div>
  );
}

