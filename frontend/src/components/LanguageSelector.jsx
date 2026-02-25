// src/components/LanguageSelector.jsx
import { useLanguage } from '../context/LanguageContext';
import { Languages } from 'lucide-react';

export default function LanguageSelector() {
  const { language, setLanguage } = useLanguage();

  const handleLanguageChange = (e) => {
    const newLanguage = e.target.value;
    console.log('[LanguageSelector] Changing language from', language, 'to', newLanguage);
    setLanguage(newLanguage);
    // Forzar re-render del componente
    window.dispatchEvent(new Event('languagechange'));
  };

  return (
    <div className="relative">
      <select
        value={language}
        onChange={handleLanguageChange}
        className="appearance-none bg-background-secondary border border-border rounded-lg px-3 py-2 pr-8 text-sm text-foreground cursor-pointer hover:bg-background-secondary/80 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
        aria-label="Select language"
      >
        <option value="es">Español</option>
        <option value="en">English</option>
      </select>
      <Languages className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted pointer-events-none" />
    </div>
  );
}

