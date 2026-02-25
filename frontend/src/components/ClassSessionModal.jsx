import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/client";
import { logger } from "../utils/logger.js";
import { X, RefreshCw, Users, CalendarClock, DollarSign, AlertTriangle } from "lucide-react";

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(typeof value === "string" ? value.replace(" ", "T") : value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

const STATUS_BADGE = {
  reserved: { label: "Reservado", className: "bg-indigo-500/15 text-indigo-200 border-indigo-500/30" },
  attended: { label: "Asistió", className: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30" },
  cancelled: { label: "Cancelado", className: "bg-red-500/15 text-red-200 border-red-500/30" },
  noshow: { label: "No asistió", className: "bg-amber-500/15 text-amber-200 border-amber-500/30" },
};

export default function ClassSessionModal({ open, sessionId, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);

  const loadDetail = async (id) => {
    if (!id) return;
    try {
      setLoading(true);
      setError("");
      const detail = await apiClient.getClassSession(id);
      setSession(detail);
    } catch (e) {
      logger.error("❌ [ClassSessionModal] Error cargando clase:", e);
      setError(e?.message || "No se pudo cargar la información de la clase.");
      setSession(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && sessionId) {
      loadDetail(sessionId);
    } else {
      setSession(null);
      setError("");
    }
  }, [open, sessionId]);

  const occupancy = useMemo(() => {
    if (!session) return { enrolled: 0, capacity: 0 };
    const enrolled =
      (session.enrollments || []).filter((e) => e.status === "reserved" || e.status === "attended").length;
    return {
      enrolled,
      capacity: Number(session.capacity_max || 0),
    };
  }, [session]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-3xl border border-indigo-500/20 bg-slate-950 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-indigo-500/10 px-6 py-5">
          <div className="space-y-1">
            <p className="text-sm text-indigo-300 uppercase tracking-wide font-semibold">Detalle de clase</p>
            <h2 className="text-2xl font-bold text-white">
              {session?.activity_type || "Clase grupal"}
            </h2>
            {session?.status === "cancelled" && (
              <div className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-200">
                <AlertTriangle className="h-4 w-4" />
                Clase cancelada
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadDetail(sessionId)}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 hover:border-indigo-500/40 hover:text-white transition"
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </button>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="rounded-full border border-slate-700/60 bg-slate-900/60 p-2 text-slate-300 hover:border-indigo-500/40 hover:text-white transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center justify-center gap-3 p-10 text-indigo-200">
            <RefreshCw className="h-5 w-5 animate-spin" />
            Cargando información…
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-200 text-sm">{error}</div>
        ) : !session ? (
          <div className="p-8 text-center text-slate-300 text-sm">
            No encontramos información de esta clase.
          </div>
        ) : (
          <div className="grid gap-6 overflow-y-auto px-6 py-6 sm:grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <section className="space-y-4">
              <div className="rounded-2xl border border-indigo-500/20 bg-slate-900/60 p-5 shadow-inner shadow-indigo-500/10">
                <div className="flex flex-wrap items-center gap-3 text-sm text-indigo-200">
                  <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 font-medium text-xs uppercase tracking-wide">
                    #{session.id}
                  </div>
                  {session.template_name && (
                    <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/50 bg-slate-800/70 px-3 py-1 text-xs text-slate-200">
                      Basada en {session.template_name}
                    </div>
                  )}
                </div>

                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="flex items-start gap-3">
                    <CalendarClock className="mt-1 h-5 w-5 text-indigo-300" />
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-indigo-200/80">Horario</dt>
                      <dd className="text-sm font-medium text-slate-100">
                        {formatDateTime(session.starts_at)}
                      </dd>
                      <dd className="text-xs text-slate-400">
                        Finaliza: {formatDateTime(session.ends_at)}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Users className="mt-1 h-5 w-5 text-indigo-300" />
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-indigo-200/80">Profesor</dt>
                      <dd className="text-sm font-medium text-slate-100">
                        {session.instructor_name || "Sin asignar"}
                      </dd>
                      <dd className="text-xs text-slate-400">
                        Cupo {occupancy.enrolled}/{occupancy.capacity || "—"}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <DollarSign className="mt-1 h-5 w-5 text-indigo-300" />
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-indigo-200/80">Precio</dt>
                      <dd className="text-sm font-medium text-slate-100">
                        {formatCurrency(session.price_decimal)}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Users className="mt-1 h-5 w-5 text-indigo-300" />
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-indigo-200/80">Estado</dt>
                      <dd className="text-sm font-medium capitalize text-slate-100">
                        {session.status}
                      </dd>
                    </div>
                  </div>
                </dl>

                {session.notes && (
                  <div className="mt-4 rounded-xl border border-slate-700/40 bg-slate-900/80 p-4 text-sm text-slate-200">
                    <p className="font-semibold text-indigo-200">Notas</p>
                    <p className="mt-1 leading-relaxed">{session.notes}</p>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-indigo-200">
                  Inscriptos
                </h3>
                <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
                  {occupancy.enrolled} / {occupancy.capacity || "—"} lugares ocupados
                </span>
              </div>

              {session.enrollments?.length ? (
                <ul className="space-y-3">
                  {session.enrollments.map((enrollment) => {
                    const badge = STATUS_BADGE[enrollment.status] || STATUS_BADGE.reserved;
                    return (
                      <li
                        key={enrollment.id}
                        className="rounded-2xl border border-slate-700/40 bg-slate-900/80 p-4 text-sm text-slate-200"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-100">
                              {enrollment.customer_name || "Cliente sin nombre"}
                            </p>
                            <p className="text-xs text-slate-400">
                              {enrollment.customer_phone || "Sin teléfono"}
                            </p>
                          </div>
                          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${badge.className}`}>
                            {badge.label}
                          </span>
                        </div>
                        {enrollment.notes && (
                          <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                            {enrollment.notes}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-2xl border border-slate-700/40 bg-slate-900/80 p-6 text-center text-sm text-slate-300">
                  No hay alumnos inscriptos todavía.
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}


