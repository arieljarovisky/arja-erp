import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, QrCode, CheckCircle2, XCircle, AlertCircle, Copy, Lock } from "lucide-react";
import { authApi } from "../api/client";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { logger } from "../utils/logger.js";

export default function TwoFactorAuthPage() {
  const navigate = useNavigate();
  const { tenantSlug } = useParams();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupLoading, setSetupLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [disableLoading, setDisableLoading] = useState(false);
  
  // Setup state
  const [qrCode, setQrCode] = useState(null);
  const [secret, setSecret] = useState(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [backupCodes, setBackupCodes] = useState([]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  
  // Disable state
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const resp = await authApi.get2FAStatus();
      if (resp?.ok) {
        setStatus(resp);
      } else {
        toast.error(resp?.error || "Error al cargar estado de 2FA");
      }
    } catch (err) {
      logger.error("Error cargando estado 2FA:", err);
      toast.error("Error al cargar estado de 2FA");
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async () => {
    try {
      setSetupLoading(true);
      const resp = await authApi.setup2FA();
      if (resp?.ok) {
        setQrCode(resp.qrCode);
        setSecret(resp.secret);
        toast.success("QR code generado. Escaneálo con tu app de autenticación");
      } else {
        toast.error(resp?.error || "Error al generar QR code");
      }
    } catch (err) {
      logger.error("Error en setup 2FA:", err);
      toast.error("Error al generar QR code");
    } finally {
      setSetupLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (verificationCode.length !== 6) {
      toast.error("El código debe tener 6 dígitos");
      return;
    }

    try {
      setVerifyLoading(true);
      const resp = await authApi.verify2FA(verificationCode);
      if (resp?.ok) {
        setBackupCodes(resp.backupCodes || []);
        setShowBackupCodes(true);
        setQrCode(null);
        setSecret(null);
        setVerificationCode("");
        await loadStatus();
        toast.success("2FA activado correctamente");
      } else {
        toast.error(resp?.error || "Código inválido");
      }
    } catch (err) {
      logger.error("Error verificando código 2FA:", err);
      toast.error("Error al verificar código");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleDisable = async (e) => {
    e.preventDefault();
    if (!disablePassword) {
      toast.error("Ingresá tu contraseña para desactivar 2FA");
      return;
    }

    try {
      setDisableLoading(true);
      const resp = await authApi.disable2FA(disablePassword);
      if (resp?.ok) {
        toast.success("2FA desactivado correctamente");
        setShowDisableForm(false);
        setDisablePassword("");
        await loadStatus();
      } else {
        toast.error(resp?.error || "Contraseña incorrecta");
      }
    } catch (err) {
      logger.error("Error desactivando 2FA:", err);
      toast.error("Error al desactivar 2FA");
    } finally {
      setDisableLoading(false);
    }
  };

  const copyBackupCodes = () => {
    const codesText = backupCodes.join("\n");
    navigator.clipboard.writeText(codesText);
    toast.success("Códigos copiados al portapapeles");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-foreground-muted">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-8 space-y-6"
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Autenticación de doble factor
                </h1>
                <p className="text-sm text-foreground-muted">
                  Protegé tu cuenta con un código adicional
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                if (tenantSlug) {
                  navigate(`/${tenantSlug}/admin/config?tab=security`);
                } else {
                  navigate(-1);
                }
              }}
              className="text-foreground-muted hover:text-foreground transition-colors"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          {/* Status */}
          {status?.enabled ? (
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    2FA está activado
                  </p>
                  {status.remembered && (
                    <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                      Este dispositivo está recordado hasta {new Date(status.rememberUntil).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  2FA no está activado. Activálo para mayor seguridad.
                </p>
              </div>
            </div>
          )}

          {/* Setup Flow */}
          {!status?.enabled && !qrCode && !showBackupCodes && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-foreground">¿Cómo funciona 2FA?</h2>
                <ul className="text-sm text-foreground-muted space-y-1 list-disc list-inside">
                  <li>Después de ingresar tu contraseña, necesitarás un código de 6 dígitos</li>
                  <li>El código se genera en tu app de autenticación (Google Authenticator, Authy, etc.)</li>
                  <li>Podés recordar este dispositivo para no requerir el código por 30 días</li>
                </ul>
              </div>

              <button
                onClick={handleSetup}
                disabled={setupLoading}
                className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {setupLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Generando QR code...
                  </>
                ) : (
                  <>
                    <QrCode className="w-5 h-5" />
                    Activar 2FA
                  </>
                )}
              </button>
            </div>
          )}

          {/* QR Code and Verification */}
          {qrCode && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <h2 className="text-lg font-semibold text-foreground">
                  Escaneá el código QR
                </h2>
                <p className="text-sm text-foreground-muted">
                  Usá tu app de autenticación para escanear este código
                </p>
              </div>

              <div className="flex justify-center">
                <div className="p-4 bg-white rounded-lg border-2 border-border">
                  <img src={qrCode} alt="QR Code" className="w-64 h-64" />
                </div>
              </div>

              {secret && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">
                    O ingresá esta clave manualmente:
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background-secondary rounded border border-border font-mono text-sm">
                      {secret}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(secret);
                        toast.success("Clave copiada");
                      }}
                      className="p-2 hover:bg-border rounded transition-colors"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              <form onSubmit={handleVerify} className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">
                    Ingresá el código de 6 dígitos de tu app
                  </label>
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setVerificationCode(value);
                    }}
                    className="input text-center text-2xl tracking-widest font-mono"
                    placeholder="000000"
                    maxLength={6}
                    required
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  disabled={verifyLoading || verificationCode.length !== 6}
                  className="w-full btn-primary py-3 disabled:opacity-50"
                >
                  {verifyLoading ? "Verificando..." : "Verificar y activar"}
                </button>
              </form>
            </div>
          )}

          {/* Backup Codes */}
          {showBackupCodes && backupCodes.length > 0 && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
                      Guardá estos códigos de respaldo
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      Estos códigos te permitirán acceder a tu cuenta si perdés acceso a tu app de autenticación. Solo se mostrarán una vez.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-foreground">
                    Códigos de respaldo
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={copyBackupCodes}
                      className="text-xs text-primary hover:text-primary-hover flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      Copiar todos
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 p-4 bg-background-secondary rounded border border-border">
                  {backupCodes.map((code, idx) => (
                    <code key={idx} className="text-sm font-mono text-center py-2">
                      {code}
                    </code>
                  ))}
                </div>
              </div>

              <button
                onClick={() => {
                  setShowBackupCodes(false);
                  setBackupCodes([]);
                }}
                className="w-full btn-primary py-3"
              >
                Continuar
              </button>
            </div>
          )}

          {/* Disable 2FA */}
          {status?.enabled && !showDisableForm && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
                      Desactivar 2FA
                    </p>
                    <p className="text-xs text-red-700 dark:text-red-300">
                      Desactivar 2FA reducirá la seguridad de tu cuenta. Solo hacelo si es absolutamente necesario.
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowDisableForm(true)}
                className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <XCircle className="w-5 h-5" />
                Desactivar 2FA
              </button>
            </div>
          )}

          {/* Disable Form */}
          {showDisableForm && (
            <form onSubmit={handleDisable} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Confirmá tu contraseña para desactivar 2FA
                </label>
                <div className="input-group">
                  <span className="input-group__icon">
                    <Lock />
                  </span>
                  <input
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    className="input input--with-icon"
                    placeholder="Tu contraseña"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowDisableForm(false);
                    setDisablePassword("");
                  }}
                  className="flex-1 py-2 px-4 border border-border rounded-lg hover:bg-border transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={disableLoading || !disablePassword}
                  className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 transition-colors"
                >
                  {disableLoading ? "Desactivando..." : "Desactivar"}
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}

