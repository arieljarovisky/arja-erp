import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiClient } from "../../api/client";

function Commissions() {
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const data = await apiClient.getCommissions();
      setRows(data.map(r => ({ ...r, _edit: r.percentage })));
    } catch {
      toast.error("No pude cargar las comisiones");
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (id) => {
    const row = rows.find(r => r.id === id);
    if (!row) return;
    const pct = Number(row._edit || 0);
    if (pct < 0 || pct > 100) return toast.error("La comisión debe estar entre 0% y 100%");
    try {
      setBusyId(id);
      await apiClient.updateCommission(id, pct);
      toast.success(`Comisión actualizada: ${pct}%`);
      await load();
    } catch {
      toast.error("Error al actualizar la comisión");
    } finally {
      setBusyId(null);
    }
  };

  const onChange = (id, value) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, _edit: value } : r)));
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Comisiones por Instructor</h1>
        <p className="text-slate-400 text-sm">Definí el porcentaje de comisión individual.</p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Instructor</th>
              <th className="px-3 py-2 text-right">Comisión (%)</th>
              <th className="px-3 py-2 w-36"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number" step="0.5" min="0" max="100"
                    value={r._edit}
                    onChange={e => onChange(r.id, e.target.value)}
                    className="w-28 text-right rounded bg-slate-900/50 border border-slate-700 px-2 py-1"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => save(r.id)}
                    disabled={busyId === r.id}
                    className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {busyId === r.id ? "Guardando..." : "Guardar"}
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td className="px-3 py-4 text-slate-400" colSpan={3}>No hay instructores activos.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Commissions;
