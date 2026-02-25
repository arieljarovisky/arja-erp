// src/components/FeatureGate.jsx
import React from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/UseApp.js";

export default function FeatureGate({ featureKey, children }) {
  const { features, featuresLoading } = useApp();

  if (featuresLoading) {
    return (
      <div className="max-w-3xl mx-auto card p-12 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
        <p className="text-foreground-secondary mt-4">Cargando permisos…</p>
      </div>
    );
  }

  const allowed = features?.[featureKey] !== false;

  if (!allowed) {
    return (
      <div className="max-w-3xl mx-auto card p-8 text-center space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Funcionalidad deshabilitada</h2>
        <p className="text-sm text-foreground-secondary">
          Este módulo no está habilitado para tu negocio. Contactá al dueño del sistema si querés activarlo
          o revisá la configuración de funcionalidades disponibles.
        </p>
        <Link
          to="../dashboard"
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
        >
          Volver al panel
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}

