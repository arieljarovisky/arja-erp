import { useEffect, useMemo, useState, useCallback } from "react";
import { useApp } from "../context/UseApp";
import { apiClient } from "../api/client";
import Button from "./ui/Button";
import { Field } from "./ui/Field";
import { Users, CalendarClock, RefreshCw, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { logger } from "../utils/logger.js";

function formatSessionLabel(session) {
  if (!session) return "Clase";
  const start = session.starts_at ? new Date(session.starts_at.replace(" ", "T")) : null;
  const end = session.ends_at ? new Date(session.ends_at.replace(" ", "T")) : null;
  const fmt = (date) =>
    date?.toLocaleString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const base = session.activity_type || "Clase";
  return `${base} — ${fmt(start) || ""}${end ? ` a ${end.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : ""}`;
}

export default function ClassEnrollForm({ defaultName = "", defaultPhone = "" }) {
  const { classesEnabled } = useApp();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    sessionId: "",
    customerName: defaultName || "",
    customerPhone: defaultPhone || "",
    notes: "",
    repeatEnabled: false,
    repeatCount: 4,
    repeatUntil: "",
  });
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!classesEnabled) {
      setSessions([]);
      return;
    }
    try {
      setLoading(true);
      setError("");
      const now = new Date();
      const from = new Date(now.getTime() - 60 * 60 * 1000);
      const to = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);
      const data = await apiClient.listClassSessions({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const available = (Array.isArray(data) ? data : []).filter((session) => session.status === "scheduled");
      setSessions(available);
    } catch (e) {
      logger.error("❌ [ClassEnrollForm] Error cargando clases:", e);
      setError(e?.message || "No se pudieron obtener las clases disponibles.");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [classesEnabled]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      customerName: defaultName || "",
      customerPhone: defaultPhone || "",
    }));
  }, [defaultName, defaultPhone]);

  const handleChange = (key) => (evt) => {
    const value = evt?.target?.value ?? "";
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCancelSeries = useCallback(async () => {
    if (!summary?.seriesId) return;
    try {
      setCancelling(true);
      const resp = await apiClient.cancelClassSeriesEnrollments(summary.seriesId, {
        customerId: summary.customerId,
        customerPhone: summary.customerPhone,
        scope: "upcoming",
      });
      const cancelled = Number(resp?.cancelled || 0);
      toast.success(
        cancelled > 0
          ? `Se cancelaron ${cancelled} inscripciones futuras de la serie`
          : "No había inscripciones futuras para cancelar"
      );
      setSummary(null);
      loadSessions();
    } catch (err) {
      const errorMsg =
        err?.response?.data?.error || err?.message || "No se pudieron cancelar las inscripciones";
      toast.error("Error al cancelar la serie", { description: errorMsg });
    } finally {
      setCancelling(false);
    }
  }, [summary, loadSessions]);

  const handleSubmit = async (evt) => {
    evt.preventDefault();
    if (!form.sessionId) {
      setError("Seleccioná una clase para inscribir al cliente.");
      return;
    }
    if (!form.customerPhone) {
      setError("Ingresá un teléfono para inscribir en la clase.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const payload = {
        customerName: form.customerName || null,
        customerPhone: form.customerPhone,
        notes: form.notes || null,
      };
      if (form.repeatEnabled) {
        payload.repeat = {
          enabled: true,
          count: form.repeatUntil ? null : Number(form.repeatCount) || 4,
          until: form.repeatUntil || null,
        };
      }
      const response = await apiClient.createClassEnrollment(Number(form.sessionId), payload);
      if (response?.ok === false) {
        throw new Error(response?.error || "No se pudo inscribir al cliente");
      }

      const createdSessions = Array.isArray(response?.data) ? response.data : [];
      const total = createdSessions.length || 1;
      toast.success(
        total > 1 ? `Cliente inscripto en ${total} clases de la serie` : "Cliente inscripto en la clase seleccionada"
      );

      const selectedSession = sessions.find((session) => String(session.id) === String(form.sessionId));
      setSummary({
        total,
        sessions: createdSessions,
        seriesId: response?.meta?.seriesId ?? selectedSession?.series_id ?? null,
        customerId: response?.meta?.customerId ?? null,
        customerPhone: form.customerPhone,
      });

      setForm((prev) => ({
        ...prev,
        notes: "",
        sessionId: "",
        repeatEnabled: false,
        repeatCount: 4,
        repeatUntil: "",
      }));

      loadSessions();
    } catch (e) {
      const errorMsg = e?.response?.data?.error || e?.message || "Error al inscribir en la clase";
      setError(errorMsg);
      toast.error("No se pudo inscribir al cliente", { description: errorMsg });
    } finally {
      setSaving(false);
    }
  };

  const upcoming = useMemo(() => sessions.slice(0, 3), [sessions]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-foreground-secondary">
          Inscribí al cliente actual en una clase grupal. Podés hacerlo después de confirmar el turno.
        </div>
        <button
          type="button"
          onClick={loadSessions}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 py-1.5 text-xs text-foreground hover:border-primary/40 hover:text-foreground transition disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {summary && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 space-y-3">
          <div className="text-sm text-emerald-700 font-semibold">
            Se confirmaron {summary.total} {summary.total === 1 ? "inscripción" : "inscripciones"}.
          </div>
          {summary.sessions?.length ? (
            <ul className="space-y-1 text-xs text-emerald-800">
              {summary.sessions.slice(0, 5).map((item) => {
                const date = item.startsAt ? new Date(item.startsAt.replace(" ", "T")) : null;
                const label = date
                  ? date.toLocaleString("es-AR", {
                      weekday: "short",
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : `Sesión #${item.sessionId}`;
                return (
                  <li key={`summary-${item.enrollmentId}-${item.sessionId}`} className="flex items-center gap-2">
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
                    <span>{label}</span>
                  </li>
                );
              })}
              {summary.sessions.length > 5 && (
                <li className="text-emerald-200/70">…y {summary.sessions.length - 5} clases más.</li>
              )}
            </ul>
          ) : null}

          {summary.seriesId && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancelSeries}
              disabled={cancelling}
                className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 hover:border-red-500/60 hover:text-red-800 transition disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
              {cancelling ? "Cancelando…" : "Cancelar todas las inscripciones futuras"}
            </Button>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Clase" hint="Mostramos las próximas clases con cupo disponible.">
          <select
            value={form.sessionId}
            onChange={handleChange("sessionId")}
            disabled={loading || sessions.length === 0}
            className="w-full rounded-xl border border-border bg-background-secondary px-4 py-3 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
          >
            <option value="">Seleccioná una clase</option>
            {sessions.map((session) => {
              const occupied = Number(session.enrolled_count ?? 0);
              const capacity = Number(session.capacity_max ?? 0);
              const full = capacity > 0 && occupied >= capacity;
              return (
                <option key={session.id} value={session.id} disabled={full}>
                  {formatSessionLabel(session)} • {occupied}/{capacity || "∞"}{" "}
                  {full ? "(Completa)" : ""}
                </option>
              );
            })}
          </select>
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nombre del alumno" hint="Opcional, usamos el del turno si lo dejás vacío.">
            <input
              value={form.customerName}
              onChange={handleChange("customerName")}
              placeholder="Nombre del alumno"
              className="input px-4 py-3 text-sm"
            />
          </Field>
          <Field label="Teléfono" hint="Formato internacional, ej. +54911..." required>
            <input
              value={form.customerPhone}
              onChange={handleChange("customerPhone")}
              placeholder="+54911..."
              className="input px-4 py-3 text-sm"
            />
          </Field>
        </div>

        <Field label="Notas" hint="Información adicional para el profesor (opcional).">
          <textarea
            value={form.notes}
            onChange={handleChange("notes")}
            rows={3}
            placeholder="Notas sobre el alumno…"
            className="w-full rounded-xl border border-border bg-background-secondary px-4 py-3 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
        </Field>

        <div className="rounded-xl border border-border bg-background-secondary px-4 py-4">
          <label className="flex items-center justify-between text-sm font-medium text-foreground">
            <span className="flex items-center gap-2">
              <Repeat className="w-4 h-4 text-indigo-400" />
              Inscribir en todas las clases de la serie
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border bg-background-secondary text-primary focus:ring-primary"
              checked={form.repeatEnabled}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  repeatEnabled: e.target.checked,
                }))
              }
            />
          </label>

          {form.repeatEnabled && (
            <div className="mt-4 grid gap-4 md:grid-cols-2 text-sm text-foreground">
              <div>
                <label className="block text-xs uppercase tracking-wide text-foreground-muted mb-1">
                  Cantidad máxima
                </label>
                <input
                  type="number"
                  min={2}
                  max={26}
                  value={form.repeatCount}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      repeatCount: e.target.value ? Number(e.target.value) : "",
                    }))
                  }
                  className="w-full rounded-lg border border-border bg-background-secondary px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                />
                <p className="mt-1 text-xs text-foreground-muted">
                  Si usás fecha límite, se ignora esta cantidad.
                </p>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide text-foreground-muted mb-1">
                  Fecha límite (opcional)
                </label>
                <input
                  type="date"
                  value={form.repeatUntil}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      repeatUntil: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-border bg-background-secondary px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                />
                <p className="mt-1 text-xs text-foreground-muted">
                  Inscribiremos al cliente hasta esa fecha inclusive.
                </p>
              </div>
              <div className="md:col-span-2 rounded-lg bg-background-secondary border border-border px-3 py-2 text-xs text-foreground leading-relaxed">
                Vamos a reservar cupo en cada clase de la misma serie. Si alguna está completa, frenamos el proceso y no se guardan cambios.
              </div>
            </div>
          )}
        </div>

        <Button
          type="submit"
          disabled={saving || loading || !sessions.length}
          className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-slate-700 disabled:to-slate-700 disabled:opacity-50 text-white font-semibold py-3 flex items-center justify-center gap-2"
        >
          <Users className="w-5 h-5" />
          {saving ? "Inscribiendo…" : "Inscribir en clase"}
        </Button>
      </form>

      <div className="rounded-xl border border-border bg-background-secondary px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">
          <CalendarClock className="w-4 h-4" />
          Próximas clases
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-foreground text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Cargando…
          </div>
        ) : upcoming.length === 0 ? (
          <div className="text-sm text-foreground-secondary">No hay clases agendadas dentro de los próximos días.</div>
        ) : (
          <ul className="space-y-2 text-sm text-foreground">
            {upcoming.map((session) => {
              const occupied = Number(session.enrolled_count ?? 0);
              const capacity = Number(session.capacity_max ?? 0);
              return (
                <li key={`upcoming-${session.id}`} className="flex items-center justify-between gap-2">
                  <span>{formatSessionLabel(session)}</span>
                  <span className="text-xs text-foreground-secondary">
                    Cupo {occupied}/{capacity || "∞"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}


