// src/shared/ui.jsx
import React from "react";
import { Search } from "lucide-react";

export function Card({ title, value, hint }) {
  return (
    <div className="card p-6 hover:scale-[1.02] transition-transform">
      <div className="space-y-2">
        <p className="text-sm text-dark-600 font-medium">{title}</p>
        <p className="text-3xl font-bold text-dark-900">{value}</p>
        {hint && <p className="text-xs text-dark-500">{hint}</p>}
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, onSubmit, placeholder = "Buscar…", width = "100%" }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(value);
      }}
      className="input-search"
      style={{ width }}
    >
      <div className="input-group">
        <span className="input-group__icon">
          <Search />
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="input input--with-icon input--with-icon-right"
        />
        <button type="submit" className="input-group__action" aria-label="Buscar">
          <Search />
        </button>
      </div>
    </form>
  );
}

export function initials(name) {
  const n = String(name || "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

export function formatPhone(p) {
  const digits = String(p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("54")) return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`;
  return digits;
}

export function formatDateTime(iso) {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("es-AR", { 
      weekday: "short", 
      day: "2-digit", 
      month: "short" 
    });
    const time = d.toLocaleTimeString("es-AR", { 
      hour: "2-digit", 
      minute: "2-digit" 
    });
    return `${date}, ${time}`;
  } catch {
    return iso ?? "";
  }
}

export function StatusPill({ status }) {
  const configs = {
    scheduled: { label: "Programado", className: "badge-primary" },
    confirmed: { label: "Confirmado", className: "badge-success" },
    pending_deposit: { label: "Pendiente", className: "badge-warning" },
    deposit_paid: { label: "Pagado", className: "badge-success" },
    completed: { label: "Completado", className: "badge-primary" },
    cancelled: { label: "Cancelado", className: "badge-gray" },
    done: { label: "Realizado", className: "badge-success" },
  };

  const config = configs[String(status).toLowerCase()] || configs.scheduled;

  return (
    <span className={config.className}>
      {config.label}
    </span>
  );
}

export function Avatar({ name, size = "md" }) {
  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-12 h-12 text-base",
    xl: "w-16 h-16 text-lg"
  };

  return (
    <div 
      className={`
        ${sizeClasses[size]} 
        rounded-full bg-gradient-primary 
        flex items-center justify-center 
        text-white font-semibold
        shadow-lg
      `}
    >
      {initials(name)}
    </div>
  );
}

export function LoadingSpinner({ size = "md" }) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-8 h-8",
    lg: "w-12 h-12"
  };

  return (
    <div className="flex items-center justify-center py-12">
      <div 
        className={`
          ${sizeClasses[size]} 
          animate-spin rounded-full 
          border-2 border-dark-300 
          border-t-primary-500
        `} 
      />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="py-16 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-dark-200/50 mb-4">
        {Icon && <Icon className="w-8 h-8 text-dark-500" />}
      </div>
      <h3 className="text-lg font-semibold text-dark-800 mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-dark-600 max-w-sm mx-auto mb-6">{description}</p>
      )}
      {action}
    </div>
  );
}

export function AlertBox({ type = "info", title, children, onClose }) {
  const configs = {
    info: {
      container: "bg-primary-600/10 border-primary-600/30 text-primary-400",
      icon: "ℹ️"
    },
    success: {
      container: "bg-emerald-600/10 border-emerald-600/30 text-emerald-400",
      icon: "✅"
    },
    warning: {
      container: "bg-amber-600/10 border-amber-600/30 text-amber-400",
      icon: "⚠️"
    },
    error: {
      container: "bg-red-600/10 border-red-600/30 text-red-400",
      icon: "❌"
    }
  };

  const config = configs[type] || configs.info;

  return (
    <div className={`rounded-xl border p-4 ${config.container}`}>
      <div className="flex items-start gap-3">
        <span className="text-xl">{config.icon}</span>
        <div className="flex-1">
          {title && <h4 className="font-semibold mb-1">{title}</h4>}
          <div className="text-sm opacity-90">{children}</div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-current opacity-60 hover:opacity-100 transition-opacity"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}