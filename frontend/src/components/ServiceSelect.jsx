import { Scissors } from "lucide-react";

export default function ServiceSelect({ services, value, onChange }) {
  return (
    <div className="relative h-12">
      <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
      </div>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="input h-12 w-full pl-11 pr-12 rounded-xl cursor-pointer appearance-none"
      >
        <option value="" disabled>
          Seleccioná un servicio
        </option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} • {s.duration_min}min • $
            {Number(s.price_decimal ?? 0).toLocaleString("es-AR")}
          </option>
        ))}
      </select>
    </div>
  );
}