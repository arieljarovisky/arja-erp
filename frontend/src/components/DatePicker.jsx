// src/components/DatePicker.jsx - Versión mejorada modo oscuro
import { useMemo } from "react";
import { Calendar } from "lucide-react";
import { toast } from "sonner";

export default function DatePicker({ value, onChange }) {
  const minDate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.toISOString().split('T')[0];
  }, []);

  const maxDate = useMemo(() => {
    const future = new Date();
    future.setDate(future.getDate() + 90);
    return future.toISOString().split('T')[0];
  }, []);

  const handleChange = (e) => {
    const selected = e.target.value;
    
    if (selected < minDate) {
      toast.warning("⚠️ No podés seleccionar fechas pasadas");
      return;
    }
    
    onChange(selected);
  };

  return (
    <div className="flex-1">
      <input
        type="date"
        value={value}
        onChange={handleChange}
        min={minDate}
        max={maxDate}
        className="input h-12 pr-12 w-full cursor-pointer transition-all [color-scheme:light]"
        aria-label="Seleccionar fecha"
      />
    </div>
  );
}