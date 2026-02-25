// src/utils/logger.js
// Utilidad para logs que solo funcionan en desarrollo

// Detectar si estamos en desarrollo de manera más robusta
const isDev = 
  import.meta.env.DEV === true ||
  import.meta.env.MODE === 'development' ||
  import.meta.env.PROD === false ||
  (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname.includes('localhost')));

// En producción, funciones vacías (los logs se eliminan en el build de todas formas)
export const logger = {
  log: isDev ? (...args) => {
    try {
      console.log(...args);
    } catch (e) {
      // Ignorar errores de logging
    }
  } : () => {},
  error: isDev ? (...args) => {
    try {
      console.error(...args);
    } catch (e) {
      // Ignorar errores de logging
    }
  } : () => {},
  warn: isDev ? (...args) => {
    try {
      console.warn(...args);
    } catch (e) {
      // Ignorar errores de logging
    }
  } : () => {},
  info: isDev ? (...args) => {
    try {
      console.info(...args);
    } catch (e) {
      // Ignorar errores de logging
    }
  } : () => {},
};

