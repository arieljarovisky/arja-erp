// src/routes/Admin/MobileAppPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../api/client";
import { useApp } from "../../context/UseApp";
import { logger } from "../../utils/logger";
import { toast } from "sonner";

const EMPTY_SETTINGS = {
  theme: { primary: "", secondary: "", text: "", background: "" },
  notifications: {
    push: true,
    inApp: true,
    features: {
      routines: false,
      classes: false,
      qr: false,
      notifications: false,
    },
  },
  pricing: null,
  schedule: null,
  logoUrl: "",
};

function ColorField({ label, name, value, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-foreground">
      <span className="text-foreground-secondary">{label}</span>
      <input
        type="color"
        name={name}
        value={value || "#13b5cf"}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-16 p-0 bg-transparent border border-border rounded"
      />
    </label>
  );
}

function TextInput({ label, value, onChange, placeholder }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-foreground">
      <span className="text-foreground-secondary">{label}</span>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input"
      />
    </label>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        className="checkbox"
      />
      <span className="text-foreground-secondary">{label}</span>
    </label>
  );
}

export default function MobileAppPage() {
  const { features } = useApp();
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [message, setMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [businessCode, setBusinessCode] = useState("");
  const [loadingBusinessCode, setLoadingBusinessCode] = useState(false);
  const [savingBusinessCode, setSavingBusinessCode] = useState(false);
  const mobileAppEnabled = useMemo(() => features?.mobile_app !== false, [features]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoadingCustomers(true);
        const { data, pagination } = await apiClient.listCustomers("", undefined, { limit: 50 });
        const list = data || pagination?.data || data || [];
        setCustomers(list);
        // Autoseleccionar el primer cliente del negocio (sin permitir cambiar)
        if (list.length > 0) {
          setSelectedCustomerId(String(list[0].id));
        }
      } catch (error) {
        logger.error("❌ [MobileAppPage] Error cargando clientes:", error);
        setErrorMsg(error?.response?.data?.error || "No se pudieron cargar clientes");
      } finally {
        setLoadingCustomers(false);
      }
    };
    load();
    loadBusinessCode();
  }, []);

  const loadBusinessCode = async () => {
    try {
      setLoadingBusinessCode(true);
      const response = await apiClient.get("/api/config/tenant/business-code");
      if (response.data?.ok && response.data?.data?.business_code) {
        setBusinessCode(response.data.data.business_code);
      }
    } catch (error) {
      logger.error("❌ [MobileAppPage] Error cargando código del negocio:", error);
      // Si el campo no existe aún, no es un error crítico
    } finally {
      setLoadingBusinessCode(false);
    }
  };

  const handleSaveBusinessCode = async () => {
    if (!businessCode.trim()) {
      toast.error("El código del negocio no puede estar vacío");
      return;
    }
    setSavingBusinessCode(true);
    try {
      await apiClient.put("/api/config/tenant/business-code", { business_code: businessCode.trim() });
      toast.success("Código del negocio actualizado correctamente");
    } catch (error) {
      logger.error("❌ [MobileAppPage] Error guardando código del negocio:", error);
      const errorMessage = error?.response?.data?.error || error?.message || "Error al actualizar el código";
      toast.error("Error al actualizar el código", {
        description: errorMessage,
      });
    } finally {
      setSavingBusinessCode(false);
    }
  };

  useEffect(() => {
    if (!selectedCustomerId) return;
    const loadSettings = async () => {
      try {
        setLoadingSettings(true);
        setErrorMsg("");
        const data = await apiClient.getCustomerAppSettings(selectedCustomerId);
        setSettings({
          theme: {
            primary: data?.theme?.primary || "",
            secondary: data?.theme?.secondary || "",
            text: data?.theme?.text || "",
            background: data?.theme?.background || "",
          },
          notifications: {
            push: data?.notifications?.push ?? true,
            inApp: data?.notifications?.inApp ?? true,
            features: {
              routines: data?.notifications?.features?.routines ?? false,
              classes: data?.notifications?.features?.classes ?? false,
              qr: data?.notifications?.features?.qr ?? false,
              notifications: data?.notifications?.features?.notifications ?? false,
            },
          },
          pricing: data?.pricing || null,
          schedule: data?.schedule || null,
          logoUrl: data?.logoUrl || "",
        });
      } catch (error) {
        logger.error("❌ [MobileAppPage] Error cargando settings:", error);
        const status = error?.response?.status;
        if (status === 403) {
          setErrorMsg("Tu plan no incluye la app móvil. Necesitás plan Pro o habilitación del super admin.");
        } else if (status === 404) {
          setErrorMsg("El cliente no pertenece a este negocio o no existe.");
        } else {
          setErrorMsg(error?.response?.data?.error || "No se pudo cargar la configuración.");
        }
      } finally {
        setLoadingSettings(false);
      }
    };
    loadSettings();
  }, [selectedCustomerId]);

  const handleSave = async () => {
    if (!selectedCustomerId) {
      setMessage("Seleccioná un cliente primero.");
      return;
    }
    try {
      setSaving(true);
      setMessage("");
      setErrorMsg("");
      const payload = {
        theme: {
          primary: settings.theme.primary || undefined,
          secondary: settings.theme.secondary || undefined,
          text: settings.theme.text || undefined,
          background: settings.theme.background || undefined,
        },
        notifications: {
          push: settings.notifications?.push ?? true,
          inApp: settings.notifications?.inApp ?? true,
          features: {
            routines: settings.notifications?.features?.routines ?? false,
            classes: settings.notifications?.features?.classes ?? false,
            qr: settings.notifications?.features?.qr ?? false,
            notifications: settings.notifications?.features?.notifications ?? false,
          },
        },
        pricing: settings.pricing || null,
        schedule: settings.schedule || null,
        logoUrl: settings.logoUrl || null,
      };
      await apiClient.updateCustomerAppSettings(selectedCustomerId, payload);
      setMessage("Configuración guardada.");
    } catch (error) {
      logger.error("❌ [MobileAppPage] Error guardando settings:", error);
      const status = error?.response?.status;
      if (status === 403) {
        setErrorMsg("Tu plan no incluye la app móvil. Necesitás plan Pro o habilitación del super admin.");
      } else if (status === 404) {
        setErrorMsg("El cliente no pertenece a este negocio o no existe.");
      } else {
        setErrorMsg(error?.response?.data?.error || "No se pudo guardar la configuración.");
      }
    } finally {
      setSaving(false);
    }
  };

  const primary = settings.theme?.primary || "#13b5cf";
  const secondary = settings.theme?.secondary || "#0d8ba1";
  const textColor = settings.theme?.text || "#0f172a";
  const background = settings.theme?.background || "#ffffff";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">App móvil</h1>
        <p className="text-sm text-foreground-secondary">
          Configurá el branding, notificaciones y datos específicos para cada cliente. Solo disponible en plan Pro.
        </p>
        {!mobileAppEnabled && (
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
            Tu plan no incluye la app móvil. Actualizá al plan Pro para habilitarla.
          </div>
        )}
        {errorMsg && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-900">
            {errorMsg}
          </div>
        )}
      </header>

      {/* Código del negocio */}
      <div className="card p-4 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Código del negocio</h2>
        <p className="text-sm text-foreground-secondary">
          Este código se usa para acceder a tu negocio desde la app móvil. Solo letras, números y guiones.
        </p>
        <div className="flex gap-2">
          <TextInput
            label=""
            value={businessCode}
            onChange={(value) => {
              // Solo permitir letras, números y guiones
              const normalized = value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
              setBusinessCode(normalized);
            }}
            placeholder="codigo-negocio"
            disabled={loadingBusinessCode || savingBusinessCode}
          />
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleSaveBusinessCode}
              disabled={savingBusinessCode || loadingBusinessCode || !mobileAppEnabled}
              className="btn-primary whitespace-nowrap"
            >
              {savingBusinessCode ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>

      <div className="card p-4 space-y-2">
        <p className="text-sm text-foreground">
          Configurando la app del negocio actual.
        </p>
        {selectedCustomerId && (
          <p className="text-xs text-foreground-secondary">
            Cliente base usado para guardar la configuración:{" "}
            <strong>
              {customers.find((c) => String(c.id) === String(selectedCustomerId))?.name ||
                customers.find((c) => String(c.id) === String(selectedCustomerId))?.full_name ||
                `ID ${selectedCustomerId}`}
            </strong>
          </p>
        )}
        {loadingSettings && selectedCustomerId ? (
          <div className="text-sm text-foreground-secondary">Cargando configuración…</div>
        ) : null}
      </div>

      {selectedCustomerId && (
        <>
          <div className="card p-4 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Branding</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ColorField
                label="Color primario"
                name="primary"
                value={settings.theme?.primary}
                onChange={(v) => setSettings((s) => ({ ...s, theme: { ...s.theme, primary: v } }))}
                disabled={!mobileAppEnabled}
              />
              <ColorField
                label="Color secundario"
                name="secondary"
                value={settings.theme?.secondary}
                onChange={(v) => setSettings((s) => ({ ...s, theme: { ...s.theme, secondary: v } }))}
                disabled={!mobileAppEnabled}
              />
              <ColorField
                label="Texto"
                name="text"
                value={settings.theme?.text}
                onChange={(v) => setSettings((s) => ({ ...s, theme: { ...s.theme, text: v } }))}
                disabled={!mobileAppEnabled}
              />
              <ColorField
                label="Fondo"
                name="background"
                value={settings.theme?.background}
                onChange={(v) => setSettings((s) => ({ ...s, theme: { ...s.theme, background: v } }))}
                disabled={!mobileAppEnabled}
              />
            </div>
            <TextInput
              label="Logo (URL)"
              value={settings.logoUrl}
              onChange={(v) => setSettings((s) => ({ ...s, logoUrl: v }))}
              placeholder="https://tusitio.com/logo.png"
              disabled={!mobileAppEnabled}
            />

            <div className="p-4 border border-border rounded-lg space-y-2" style={{ backgroundColor: background }}>
              <p className="text-sm font-medium" style={{ color: textColor }}>
                Vista previa
              </p>
              <div className="flex gap-3">
                <button
                  className="px-4 py-2 rounded-lg text-white text-sm font-semibold"
                  style={{ background: primary }}
                  type="button"
                >
                  Botón primario
                </button>
                <button
                  className="px-4 py-2 rounded-lg text-white text-sm font-semibold"
                  style={{ background: secondary }}
                  type="button"
                >
                  Botón secundario
                </button>
              </div>
              <p className="text-sm" style={{ color: textColor }}>
                Texto de ejemplo
              </p>
            </div>
          </div>

          <div className="card p-4 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Notificaciones</h2>
            <div className="flex flex-col md:flex-row gap-4">
              <Checkbox
                label="Push"
                checked={settings.notifications?.push}
                onChange={(v) => setSettings((s) => ({ ...s, notifications: { ...s.notifications, push: v } }))}
                disabled={!mobileAppEnabled}
              />
              <Checkbox
                label="In-app"
                checked={settings.notifications?.inApp}
                onChange={(v) => setSettings((s) => ({ ...s, notifications: { ...s.notifications, inApp: v } }))}
                disabled={!mobileAppEnabled}
              />
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Funcionalidades de la app</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <Checkbox
                label="Rutinas"
                checked={settings.notifications?.features?.routines}
                onChange={(v) =>
                  setSettings((s) => ({
                    ...s,
                    notifications: {
                      ...s.notifications,
                      features: { ...s.notifications.features, routines: v },
                    },
                  }))
                }
                disabled={!mobileAppEnabled}
              />
              <Checkbox
                label="Clases"
                checked={settings.notifications?.features?.classes}
                onChange={(v) =>
                  setSettings((s) => ({
                    ...s,
                    notifications: {
                      ...s.notifications,
                      features: { ...s.notifications.features, classes: v },
                    },
                  }))
                }
                disabled={!mobileAppEnabled}
              />
              <Checkbox
                label="QR"
                checked={settings.notifications?.features?.qr}
                onChange={(v) =>
                  setSettings((s) => ({
                    ...s,
                    notifications: {
                      ...s.notifications,
                      features: { ...s.notifications.features, qr: v },
                    },
                  }))
                }
                disabled={!mobileAppEnabled}
              />
              <Checkbox
                label="Notificaciones in-app"
                checked={settings.notifications?.features?.notifications}
                onChange={(v) =>
                  setSettings((s) => ({
                    ...s,
                    notifications: {
                      ...s.notifications,
                      features: { ...s.notifications.features, notifications: v },
                    },
                  }))
                }
                disabled={!mobileAppEnabled}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !mobileAppEnabled}
              className="btn-primary"
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
            {message && <span className="text-sm text-foreground-secondary">{message}</span>}
          </div>
        </>
      )}
    </div>
  );
}

