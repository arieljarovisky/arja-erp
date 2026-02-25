// src/components/SlotGrid.jsx
import { useMemo } from "react";
import { Clock, X, Check } from "lucide-react";

/** Devuelve "HH:MM" sin importar si entra ISO, "YYYY-MM-DD HH:MM:SS", "HH:MM" o Date */
function slotKey(v) {
  if (!v) return "";
  if (typeof v === "string") {
    const s = v.trim();
    // "HH:MM"
    if (/^\d{2}:\d{2}$/.test(s)) return s;
    // "YYYY-MM-DDTHH:MM(:SS)?Z?" | "YYYY-MM-DD HH:MM(:SS)?"
    const m = s.match(/T?(\d{2}):(\d{2})/);
    if (m) return `${m[1]}:${m[2]}`;
    // último recurso: Date parse
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }
    return "";
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const hh = String(v.getHours()).padStart(2, "0");
    const mm = String(v.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  return "";
}

function formatTime(v) {
  if (!v) return "—";
  // Si ya es "HH:MM", lo mostramos tal cual en locale
  if (typeof v === "string" && /^\d{2}:\d{2}$/.test(v)) {
    const [h, m] = v.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    // caemos a la key como hora
    const k = slotKey(v);
    return k || "—";
  }
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export default function SlotGrid({
  slots = [],
  busySlots = [],
  loading,
  selected,
  onSelect,
}) {
  // Set con "HH:MM" de ocupados
  const busySet = useMemo(() => new Set((busySlots || []).map(slotKey)), [busySlots]);

  // selected puede venir ISO; normalizamos para resaltar bien
  const selectedKey = useMemo(() => slotKey(selected), [selected]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-slate-700 border-t-indigo-500 rounded-full animate-spin"></div>
          <Clock className="absolute inset-0 m-auto w-6 h-6 text-indigo-400" />
        </div>
        <p className="text-sm text-slate-400">Buscando horarios disponibles...</p>
      </div>
    );
  }

  if (!Array.isArray(slots) || slots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 px-6 bg-amber-500/5 border border-amber-500/20 rounded-xl">
        <div className="p-4 bg-amber-500/10 rounded-full">
          <X className="w-8 h-8 text-amber-400" />
        </div>
        <div className="text-center">
          <p className="text-amber-300 font-medium mb-1">No hay horarios disponibles</p>
          <p className="text-sm text-slate-400">Intentá con otra fecha o estilista</p>
        </div>
      </div>
    );
  }

  const freeCount = slots.filter((s) => !busySet.has(slotKey(s))).length;

  return (
    <div className="space-y-4">
      {/* Leyenda */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/30 border border-slate-700/30">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-lg bg-slate-800 border-2 border-slate-600"></div>
            <span className="text-sm text-slate-300">Disponible ({freeCount})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-lg bg-red-500/20 border-2 border-red-500/40"></div>
            <span className="text-sm text-slate-300">Ocupado ({busySlots.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 border-2 border-indigo-400"></div>
            <span className="text-sm text-slate-300">Seleccionado</span>
          </div>
        </div>
        <div className="text-xs text-slate-500">
          <Clock className="inline w-3 h-3 mr-1" />
          {slots.length} horarios
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {slots.map((slot) => {
          const key = slotKey(slot);               // "HH:MM"
          const ocupado = busySet.has(key);
          const activo = selectedKey && selectedKey === key;

          return (
            <button
              key={`${typeof slot === "string" ? slot : key}`}
              onClick={() => !ocupado && onSelect?.(slot)}
              disabled={ocupado}
              className={`
                group relative px-4 py-4 rounded-xl font-medium text-sm transition-all duration-200
                ${ocupado
                  ? "bg-red-500/10 text-red-400 cursor-not-allowed border-2 border-red-500/20 opacity-60"
                  : activo
                  ? "bg-gradient-to-br from-indigo-600 to-purple-600 text-white border-2 border-indigo-400 shadow-lg shadow-indigo-500/25 scale-105"
                  : "bg-slate-800/50 hover:bg-slate-700/50 border-2 border-slate-700/50 hover:border-slate-600/50 text-slate-300 hover:text-slate-100 hover:shadow-lg hover:scale-105"
                }
              `}
              title={ocupado ? "Horario ocupado" : "Seleccionar horario"}
              aria-disabled={ocupado}
              aria-pressed={activo}
            >
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`
                    p-2 rounded-lg transition-all
                    ${ocupado ? "bg-red-500/10" : activo ? "bg-white/20" : "bg-slate-700/50 group-hover:bg-slate-600/50"}
                  `}
                >
                  {ocupado ? <X className="w-4 h-4" /> : activo ? <Check className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                </div>
                <span className={`text-base font-bold ${ocupado ? "line-through" : ""}`}>
                  {formatTime(slot)}
                </span>
                {ocupado && <span className="text-[10px] uppercase tracking-wider opacity-75">Ocupado</span>}
                {activo && <span className="text-[10px] uppercase tracking-wider opacity-90">Seleccionado</span>}
              </div>
              {!ocupado && !activo && (
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-500/0 via-purple-500/5 to-indigo-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </button>
          );
        })}
      </div>

      {freeCount > 0 && (
        <div className="mt-4 px-4 py-3 rounded-xl bg-indigo-500/5 border border-indigo-500/20 text-sm text-indigo-300">
          <strong>✨ Consejo:</strong> Los horarios se actualizan en tiempo real. Si no encontrás el ideal, probá otra fecha o estilista.
        </div>
      )}
    </div>
  );
}
