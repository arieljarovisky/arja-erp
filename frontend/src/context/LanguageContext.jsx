// src/context/LanguageContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    // Obtener idioma guardado en localStorage o usar español por defecto
    const saved = localStorage.getItem('app_language');
    return saved || 'en';
  });

  useEffect(() => {
    // Guardar idioma en localStorage cuando cambie
    localStorage.setItem('app_language', language);
    console.log('[LanguageContext] Language changed to:', language);
  }, [language]);

  const value = {
    language,
    setLanguage,
    isEnglish: language === 'en',
    isSpanish: language === 'es',
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
