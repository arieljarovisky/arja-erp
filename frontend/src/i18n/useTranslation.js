// src/i18n/useTranslation.js
import { useLanguage } from '../context/LanguageContext';
import { useMemo } from 'react';
import esTranslations from './translations/es.json';
import enTranslations from './translations/en.json';

// Verificar que las traducciones se cargaron correctamente (solo en desarrollo)
if (import.meta.env.DEV) {
  console.log('[i18n] Translations loaded - ES keys:', Object.keys(esTranslations || {}).length, 'EN keys:', Object.keys(enTranslations || {}).length);
}

const translations = {
  es: esTranslations || {},
  en: enTranslations || {},
};

export function useTranslation() {
  const { language } = useLanguage();

  const t = useMemo(() => {
    return (key, params = {}) => {
      const keys = key.split('.');
      let value = translations[language];
      
      // Debug - solo en desarrollo y para claves específicas
      if (import.meta.env.DEV && (key.includes('whatsapp') || key.includes('config'))) {
        console.log('[i18n] Translating:', key, '→ Language:', language);
      }

      // Navegar por las claves anidadas
      for (const k of keys) {
        if (value && typeof value === 'object') {
          value = value[k];
        } else {
          // Si no encuentra la traducción, intentar con español como fallback
          if (language !== 'es') {
            value = translations.es;
            for (const k2 of keys) {
              if (value && typeof value === 'object') {
                value = value[k2];
              } else {
                return key; // Devolver la clave si no encuentra traducción
              }
            }
          } else {
            return key; // Devolver la clave si no encuentra traducción
          }
          break;
        }
      }

      if (typeof value !== 'string') {
        return key;
      }

      // Reemplazar parámetros {name}, {count}, {year}, etc.
      let result = value.replace(/\{(\w+)\}/g, (match, paramKey) => {
        return params[paramKey] !== undefined ? params[paramKey] : match;
      });
      
      // Manejar plurales simples (español)
      if (language === 'es' && result.includes('{plural}')) {
        const count = params.count || 0;
        result = result.replace('{plural}', count !== 1 ? 's' : '');
      }
      
      return result;
    };
  }, [language]);

  return { t, language };
}

