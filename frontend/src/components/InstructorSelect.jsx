// src/components/InstructorSelect.jsx - Versión mejorada modo oscuro
import { User } from "lucide-react";

export default function InstructorSelect({ instructors, value, onChange }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="input h-12 pr-12 w-full appearance-none cursor-pointer transition-all"
    >
      <option value="" disabled>Elegí instructor/a</option>
      {instructors.map((st) => (
        <option key={st.id} value={st.id}>
          {st.name}
        </option>
      ))}
    </select>
  );
}