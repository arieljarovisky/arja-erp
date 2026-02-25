import { useEffect, useMemo, useState } from "react";

const LABELS = {
    pending_deposit: "Programado (pend. seña)",
    scheduled: "Confirmado",
    completed: "Completado",
    cancelled: "Cancelado",
};

const fmt = (d) => new Date(d).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
const diffMin = (to) => Math.floor((new Date(to) - new Date()) / 60000);

export default function StatusControl({ appt, onReload }) {
  if (!appt) return <div className="text-xs text-gray-500">Cargando estado…</div>;

  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [localStatus, setLocalStatus] = useState(appt.status); // 👈 estado local

  useEffect(() => setLocalStatus(appt.status), [appt.status]); // sync cuando recargás
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(t); }, []);

  const holdLeftMin = useMemo(() => {
    if (!appt.hold_until || localStatus !== "pending_deposit") return null;
    return Math.floor((new Date(appt.hold_until) - new Date()) / 60000);
  }, [appt.hold_until, localStatus, now]);

  const canConfirmManually = localStatus === "pending_deposit";
  const canCancelByHold   = localStatus === "pending_deposit" && holdLeftMin !== null && holdLeftMin <= 0;
  const canComplete       = localStatus === "scheduled";

  async function updateStatus(next) {
    if (!appt?.id || pending) return;
    // 👇 Optimistic UI
    const prev = localStatus;
    setLocalStatus(next);
    setPending(true);
    try {
      const res = await fetch(`/api/appointments/${appt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "No se pudo actualizar el estado");
      onReload?.();
    } catch (err) {
      setLocalStatus(prev); // rollback
      alert(err.message || "No pude actualizar el estado.");
    } finally {
      setPending(false);
    }
  }

  const LABELS = {
    pending_deposit: "Programado (pend. seña)",
    scheduled: "Confirmado",
    completed: "Completado",
    cancelled: "Cancelado",
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Estado</span>
        <span className={`px-2 py-1 rounded-full text-xs
          ${localStatus==='scheduled' ? 'bg-green-100 text-green-700' :
            localStatus==='pending_deposit' ? 'bg-amber-100 text-amber-700' :
            localStatus==='completed' ? 'bg-primary/10 text-primary' :
            'bg-gray-100 text-gray-600'}`}>
          {LABELS[localStatus] || localStatus}
        </span>
      </div>

      {Number(appt.deposit_decimal) > 0 && (
        <div className="text-xs text-gray-600">
          Seña: <b>${Number(appt.deposit_decimal).toFixed(2)}</b>
          {appt.deposit_paid_at ? <> • pagada el {new Date(appt.deposit_paid_at).toLocaleString("es-AR")}</> : <> • <i>aún no pagada</i></>}
        </div>
      )}

      {localStatus === "pending_deposit" && appt.hold_until && (
        <div className={`text-xs ${holdLeftMin>0 ? 'text-amber-700' : 'text-red-600'}`}>
          {holdLeftMin > 0 ? `Tiempo para pagar la seña: ${holdLeftMin} min` : `Seña vencida`}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-2">
        {canConfirmManually && (
          <button disabled={pending} onClick={() => updateStatus("scheduled")}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50">
            Confirmar manualmente
          </button>
        )}

        {canCancelByHold && (
          <button disabled={pending} onClick={() => updateStatus("cancelled")}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm hover:bg-rose-700 disabled:opacity-50">
            Cancelar por seña vencida
          </button>
        )}

        {canComplete && (
          <button disabled={pending || localStatus==='completed'} onClick={() => updateStatus("completed")}
                  className={`px-3 py-1.5 rounded-lg text-white text-sm disabled:opacity-50
                    ${localStatus==='completed' ? 'bg-primary/60' : 'bg-primary hover:bg-primary-hover'}`}>
            {localStatus === "completed" ? "Completado ✓" : "Marcar como completado"}
          </button>
        )}
      </div>
    </div>
  );
}
