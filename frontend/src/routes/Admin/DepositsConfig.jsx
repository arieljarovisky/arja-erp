import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { apiClient } from "../../api/client";

export default function DepositsConfig() {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm({
    defaultValues: {
      deposit_percentage: 50,
      hold_minutes: 30,
      expire_minutes: 120,
      auto_cancel: true,
      notify_expiring: true,
      notify_expired: true,
      notify_paid: true,
    },
  });

  useEffect(() => {
    (async () => {
      try {
        const cfg = await apiClient.getDepositConfig();
        reset({
          deposit_percentage: Number(cfg?.deposit_percentage ?? 50),
          hold_minutes: Number(cfg?.hold_minutes ?? 30),
          expire_minutes: Number(cfg?.expire_minutes ?? 120),
          auto_cancel: parseBool(cfg?.auto_cancel, true),
          notify_expiring: parseBool(cfg?.notify_expiring, true),
          notify_expired: parseBool(cfg?.notify_expired, true),
          notify_paid: parseBool(cfg?.notify_paid, true),
        });
      } catch {
        toast.error("No pude cargar la configuración de señas");
      }
    })();
  }, [reset]);

  const onSubmit = async (values) => {
    try {
      await apiClient.updateDepositConfig({
        ...values,
        deposit_percentage: Number(values.deposit_percentage || 0),
        hold_minutes: Number(values.hold_minutes || 0),
        expire_minutes: Number(values.expire_minutes || 0),
      });
      toast.success("Configuración guardada");
    } catch {
      toast.error("Error al guardar la configuración");
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Configuración de Señas</h1>
        <p className="text-slate-400 text-sm">Parámetros globales para reservas y vencimientos.</p>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Porcentaje de seña (%)">
            <input
              type="number" min="0" max="100" step="1"
              className="w-full rounded-lg bg-slate-900/50 border border-slate-700 px-3 py-2"
              {...register("deposit_percentage", { valueAsNumber: true })}
            />
          </Field>

          <Field label="Tiempo de hold (min)">
            <input
              type="number" min="0" step="1"
              className="w-full rounded-lg bg-slate-900/50 border border-slate-700 px-3 py-2"
              {...register("hold_minutes", { valueAsNumber: true })}
            />
          </Field>

          <Field label="Expira X min antes del turno">
            <input
              type="number" min="0" step="1"
              className="w-full rounded-lg bg-slate-900/50 border border-slate-700 px-3 py-2"
              {...register("expire_minutes", { valueAsNumber: true })}
            />
          </Field>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          {[
            ["auto_cancel", "Cancelar automáticamente al vencer el hold"],
            ["notify_expiring", "Notificar señas por vencer"],
            ["notify_expired", "Notificar señas vencidas"],
            ["notify_paid", "Notificar pagos confirmados"],
          ].map(([name, label]) => (
            <label key={name} className="flex items-center gap-3 bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2">
              <input type="checkbox" className="size-4" {...register(name)} />
              <span className="text-slate-200 text-sm">{label}</span>
            </label>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
          >
            {isSubmitting ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm text-slate-300">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function parseBool(v, def = false) {
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  if (v === false || v === 0 || v === "0" || v === "false") return false;
  return def;
}
